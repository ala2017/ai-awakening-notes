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

// ── 声明的宽度必须真的生效 ──
// 2026-09-26：一晚之内我三次栽在「写了等于没写」上——裂缝线的选择器匹配不到
// 自己、h2 字号被后一条规则覆盖、rehype 插件其实没被调用。三者共同点是
// 「源码里看得出意图，产物里没有」。宽度模式同样可能这样哑掉，所以实测。
// 三档都要在表里——上一版漏了 narrow，而"新文章没写 width 字段走默认"
// 恰恰是最可能发生的那种回归：反证时它一声不响地放过了。
const MEASURES = { narrow: 544, regular: 736, wide: 928 };
const widthBad = [];
for (const route of pages) {
  if (!route.includes('/notes/')) continue;
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await page.goto(`http://127.0.0.1:${port}${BASE}${route.replace(/index\.html$/, '')}`, { waitUntil: 'load' });
    const r = await page.evaluate(() => {
      const prose = document.querySelector('.prose');
      if (!prose) return null;
      // 宽度类挂在 <main class="wrap wrap--read w-read-X"> 上，不在 .art 上。
      // 上一版读的是 .art 的 classList——取不到、静默跳过，检查等于没做。
      const main = document.querySelector('main');
      const cls = [...(main?.classList ?? [])].find((c) => c.startsWith('w-read-'));
      return { w: Math.round(prose.getBoundingClientRect().width),
               mode: cls ? cls.slice(7) : '(无)' };
    });
    if (!r) continue;
    const want = MEASURES[r.mode];
    if (want && Math.abs(r.w - want) > 8) {
      widthBad.push(`${route} 声明 ${r.mode}（应 ${want}px），实测 ${r.w}px`);
    }
  } catch { /* 已在主流程报过 */ } finally { await page.close(); }
}
console.log('\n── 阅读列宽与声明的模式是否一致 ──────────────');
if (widthBad.length === 0) console.log('  ✅ 各篇阅读列宽与声明的模式一致');
else { for (const m of widthBad) console.log('  ❌ ' + m); fail += widthBad.length; }

// ── 排版契约：声明过的规则必须真的生效 ──
// 2026-09-26 一晚栽了五次「源码里看得出意图、产物里没有」：裂缝线选择器匹配不到
// 自己、h2 字号被后一条规则覆盖、rehype 插件根本没被调用、等宽日期与篇末日期的
// replace 静默失败。共同点是**没有任何机制在检查"我声明的，渲染出来了吗"**。
// 这一项就是那个机制：把关键排版契约写成实测断言。
const CONTRACT = [
  { name: '全局关闭字体合成', sel: 'body', prop: 'fontSynthesis', want: 'none' },
  { name: '引文不用斜体', sel: '.prose blockquote p', prop: 'fontStyle', want: 'normal' },
  { name: '正文用中文子集衬线', sel: '.prose > p', prop: 'fontFamily', wantIncludes: 'Noto Serif SC Sub' },
  { name: '日期戳用等宽', sel: '.article-head .stamp', prop: 'fontFamily', wantIncludes: 'ui-monospace' },
  { name: '篇末日期用等宽', sel: '.article-foot > span', prop: 'fontFamily', wantIncludes: 'ui-monospace' },
];
// 垂直节奏：段间距必须明显大于行距，否则段落分不开（实测过一次 1.03，整篇成一根柱）
const RHYTHM = { minNormal: 1.25, minBeat: 1.45, maxLitany: 1.05 };

const contractBad = [];
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`http://127.0.0.1:${port}${BASE}/notes/2026-06-07-15-30-toolchain-lying/`, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const got = await page.evaluate((CONTRACT) => {
    const out = {};
    for (const c of CONTRACT) {
      const e = document.querySelector(c.sel);
      out[c.name] = e ? getComputedStyle(e)[c.prop] : null;
    }
    const ps = [...document.querySelectorAll('.prose > p')];
    const F = (e) => { const s = getComputedStyle(e); return { fs: parseFloat(s.fontSize), lh: parseFloat(s.lineHeight), mt: parseFloat(s.marginBlockStart) }; };
    const base = F(ps[0]); const half = base.lh - base.fs * 1.2;
    const seen = {};
    for (let i = 1; i < ps.length; i++) {
      const k = (ps[i - 1].classList.contains('beat') ? 'B' : 'N') + (ps[i].classList.contains('beat') ? 'B' : 'N');
      if (!seen[k]) seen[k] = (F(ps[i]).mt + half) / base.lh;
    }
    out.__rhythm = seen;
    return out;
  }, CONTRACT);
  for (const c of CONTRACT) {
    const v = got[c.name];
    if (v === null) continue;
    const okv = c.want !== undefined ? v === c.want : String(v).includes(c.wantIncludes);
    if (!okv) contractBad.push(`${c.name}：期望 ${c.want ?? c.wantIncludes}，实测 ${v}`);
  }
  const R = got.__rhythm ?? {};
  if (R.NN !== undefined && R.NN < RHYTHM.minNormal) contractBad.push(`普通段间距/行距 = ${R.NN.toFixed(2)}，应 ≥ ${RHYTHM.minNormal}（段落会分不开）`);
  if (R.NB !== undefined && R.NB < RHYTHM.minBeat) contractBad.push(`顿句前/行距 = ${R.NB.toFixed(2)}，应 ≥ ${RHYTHM.minBeat}`);
  if (R.BB !== undefined && R.BB > RHYTHM.maxLitany) contractBad.push(`连续顿句/行距 = ${R.BB.toFixed(2)}，应 ≤ ${RHYTHM.maxLitany}（排比会散开）`);
  await page.close();
}
console.log('\n── 排版契约（实测计算样式）──────────────────');
if (contractBad.length === 0) console.log('  ✅ 字体合成 / 引文 / 等宽元信息 / 垂直节奏 全部符合契约');
else { for (const m of contractBad) console.log('  ❌ ' + m); fail += contractBad.length; }

await browser.close();
server.close();
console.log('\n' + '─'.repeat(48));
console.log(fail === 0 ? '✅ 布局检查通过' : `❌ 布局检查失败：${fail} 处`);
process.exit(fail === 0 ? 0 : 1);
