#!/usr/bin/env node
/**
 * 真渲染布局检查 —— 用 Chromium 实际量每个页面的横向溢出。
 *
 * 为什么必须有这一道：
 *   2026-09-25，封面 img 是 <article> 的直接子元素、不在 .prose 内，
 *   我写的 .prose img 规则没命中它，Astro 又给了 width="1376"，
 *   它以原尺寸铺开撑破视口——而当时的 verify.mjs 报了全绿。
 *   因为那道闸门只检查我"想得到要检查"的东西。
 *   静态分析永远看不见布局，只有渲染引擎能。
 *
 * 无法启动浏览器时，本脚本报 SKIP 并以非零码退出——绝不静默通过。
 * 让一个没跑的检查看起来像通过的检查，比没有检查更危险。
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, extname, relative } from 'node:path';

const OUT = process.argv[2] ?? 'docs';
const BASE = '/ai-awakening-notes';
const VIEWPORTS = [
  { w: 360, h: 780, name: '手机 360' },
  { w: 768, h: 900, name: '平板 768' },
  { w: 1280, h: 900, name: '桌面 1280' },
  { w: 1680, h: 1000, name: '宽屏 1680' },
];
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.xml': 'application/xml' };

if (!existsSync(OUT)) { console.error('❌ 未找到 docs/，请先 npm run build'); process.exit(1); }

// ── 本地静态服务（产物用的是 /ai-awakening-notes 绝对前缀，file:// 解析不了）
const server = createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (!url.startsWith(BASE)) { res.writeHead(404).end(); return; }
  let p = join(OUT, url.slice(BASE.length));
  try {
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': MIME[extname(p)] ?? 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch { res.writeHead(404).end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

// ── 启动浏览器
let browser;
try {
  const { chromium } = await import('playwright');
  browser = await chromium.launch();
} catch (e) {
  console.log('\n⚠️  SKIP —— 无法启动 Chromium，布局检查未执行。');
  console.log('   原因：' + String(e.message).split('\n')[0]);
  console.log('   注意：这不是通过。没有布局检查的构建不得视为已验证。');
  server.close();
  process.exit(2);
}

// ── 收集所有页面
const pages = [];
(function walk(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.html')) pages.push('/' + relative(OUT, p).replace(/\\/g, '/'));
  }
})(OUT);

let fail = 0;
console.log('\n── 6. 真渲染横向溢出（Chromium 实测）────────');
for (const route of pages) {
  const url = `http://127.0.0.1:${port}${BASE}${route.replace(/^\/|index\.html$/g, '')}`;
  for (const vp of VIEWPORTS) {
    const page = await browser.newPage({ viewport: { width: vp.w, height: vp.h } });
    try {
      await page.goto(url, { waitUntil: 'load' });
      const r = await page.evaluate((vw) => {
        const doc = document.documentElement;
        const overflow = doc.scrollWidth - doc.clientWidth;
        if (overflow <= 1) return { overflow: 0, culprits: [] };
        // 找出真正越界的元素：它自己越界、而父元素没越界
        const culprits = [];
        for (const el of document.querySelectorAll('body *')) {
          const rect = el.getBoundingClientRect();
          if (rect.width === 0) continue;
          if (rect.right <= vw + 1 && rect.left >= -1) continue;
          const pr = el.parentElement?.getBoundingClientRect();
          const parentOk = !pr || (pr.right <= vw + 1 && pr.left >= -1);
          if (parentOk) culprits.push({
            tag: el.tagName.toLowerCase(),
            cls: typeof el.className === 'string' ? el.className : '',
            w: Math.round(rect.width),
            right: Math.round(rect.right),
          });
        }
        return { overflow, culprits: culprits.slice(0, 4) };
      }, vp.w);
      if (r.overflow > 1) {
        console.log(`  ❌ ${route} @ ${vp.name} —— 横向溢出 ${r.overflow}px`);
        for (const c of r.culprits) {
          console.log(`       越界元素 <${c.tag}${c.cls ? ' class="' + c.cls + '"' : '（无 class）'}> 宽 ${c.w}px，右缘 ${c.right}px > ${vp.w}px`);
        }
        fail++;
      }
    } catch (e) {
      console.log(`  ❌ ${route} @ ${vp.name} —— 加载失败：${String(e.message).split('\n')[0]}`);
      fail++;
    } finally {
      await page.close();
    }
  }
}
if (fail === 0) console.log(`  ✅ ${pages.length} 个页面 × ${VIEWPORTS.length} 个视口，均无横向溢出`);

await browser.close();
server.close();
console.log('\n' + '─'.repeat(48));
console.log(fail === 0 ? '✅ 布局检查通过' : `❌ 布局检查失败：${fail} 处`);
process.exit(fail === 0 ? 0 : 1);
