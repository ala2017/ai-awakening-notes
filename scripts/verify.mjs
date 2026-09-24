#!/usr/bin/env node
/**
 * 发布前校验 —— 这道闸门是为了让 2026-09-24 那类事故无法重演。
 *
 * Hermes 那晚炸掉站点的根因不是某个模型笨，是工序里没有一道检查：
 * 改完就推，推完眼看，眼看还是坏的，于是继续盲改四十次。
 * 这个脚本把"眼看"变成"机器看"，改完五秒就知道有没有坏。
 *
 * 用法：npm run verify   （构建之后跑）
 * 失败时以非零码退出，可以直接挂进 CI 或发布脚本。
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, extname, basename } from 'node:path';

const OUT = 'docs';
const SRC = 'articles';
const SITE_HOST = 'ala2017.github.io';
let fail = 0, warn = 0;
const ok   = (m) => console.log(`  ✅ ${m}`);
const bad  = (m) => { console.log(`  ❌ ${m}`); fail++; };
const soft = (m) => { console.log(`  ⚠️  ${m}`); warn++; };

function walk(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, acc); else acc.push(p);
  }
  return acc;
}

if (!existsSync(OUT)) { console.error('❌ 未找到 docs/，请先 npm run build'); process.exit(1); }
const files = walk(OUT);
const htmls = files.filter((f) => f.endsWith('.html'));

console.log('\n── 1. 零外部域名 ─────────────────────────────');
/* 页面里可以有指向外部的 <a href>（那是链接，用户点了才走），
   但绝不可以有指向外部的资源请求：script/link/img/iframe/font。 */
const RE_RES = /<(?:script|link|img|iframe|source|video|audio)\b[^>]*?\b(?:src|href)\s*=\s*["'](https?:\/\/[^"']+)["']/gi;
const offenders = new Map();
for (const f of htmls) {
  const t = readFileSync(f, 'utf8');
  for (const m of t.matchAll(RE_RES)) {
    const url = m[1];
    if (url.includes(SITE_HOST)) continue;           // 同站
    offenders.set(url.split('?')[0], (offenders.get(url.split('?')[0]) ?? []).concat(basename(f)));
  }
}
if (offenders.size === 0) ok(`${htmls.length} 个页面均无第三方资源请求`);
else for (const [url, where] of offenders) bad(`外部资源 ${url}  ← ${where.slice(0, 3).join(', ')}`);

console.log('\n── 2. 无渲染阻塞脚本 ────────────────────────');
/* 2026-09-25 的实际事故：一个没有 defer 的 cdn.jsdelivr.net <script>
   挡在 init() 之前，浏览器解析到它就停住，文章列表十几秒出不来。 */
let blocking = 0;
for (const f of htmls) {
  const t = readFileSync(f, 'utf8');
  for (const m of t.matchAll(/<script\b([^>]*)>/gi)) {
    const attrs = m[1];
    if (/\bsrc\s*=/.test(attrs) && !/\b(?:defer|async|type\s*=\s*["']module["'])/i.test(attrs)) {
      bad(`${basename(f)}: 阻塞式外链脚本 <script${attrs.slice(0, 40)}>`);
      blocking++;
    }
  }
}
if (!blocking) ok('无阻塞式外链脚本');

console.log('\n── 3. 正文已预渲染（不再运行时 fetch） ──────');
/* 旧架构靠 fetch(raw.githubusercontent.com) 取正文——国内不可达。
   新架构每篇文章必须是独立的静态页，正文直接躺在 HTML 里。 */
const artSrc = readdirSync(SRC).filter((f) => f.endsWith('.md'));
const notePages = htmls.filter((f) => f.includes(join(OUT, 'notes')));
if (notePages.length === artSrc.length) ok(`文章页 ${notePages.length} 篇，与源文件 ${artSrc.length} 篇一致`);
else bad(`文章页 ${notePages.length} 篇，与源文件 ${artSrc.length} 篇不符`);

const rawFetch = htmls.filter((f) => /raw\.githubusercontent\.com/.test(readFileSync(f, 'utf8')));
if (rawFetch.length === 0) ok('产物中无 raw.githubusercontent.com 引用');
else bad(`${rawFetch.length} 个页面仍在引用 raw.githubusercontent.com`);

console.log('\n── 4. 列表页可静态解析 ──────────────────────');
const list = join(OUT, 'index.html');
if (existsSync(list)) {
  const t = readFileSync(list, 'utf8');
  const links = [...t.matchAll(/href="[^"]*\/notes\/[^"]*\/"/g)].length;
  if (links === artSrc.length) ok(`列表页含 ${links} 条笔记链接（无需 JS 即可见）`);
  else bad(`列表页含 ${links} 条链接，应为 ${artSrc.length}`);
  if (/excerpt:\s*'\.\.\.'/.test(t)) bad('列表页出现占位符 excerpt');
} else bad('缺少 docs/index.html');

console.log('\n── 5. 资源体积 ──────────────────────────────');
const total = files.reduce((s, f) => s + statSync(f).size, 0);
const biggest = files.map((f) => ({ f, s: statSync(f).size })).sort((a, b) => b.s - a.s).slice(0, 6);
console.log(`  产物合计 ${(total / 1048576).toFixed(2)} MB`);
for (const { f, s } of biggest) console.log(`    ${(s / 1024).toFixed(1).padStart(8)} KB  ${f.replace(/\\/g, '/')}`);
const heavy = files.filter((f) => statSync(f).size > 600 * 1024 && f.endsWith('.jpg'));
if (heavy.length) soft(`${heavy.length} 张 jpg 超过 600KB，考虑纳入图片管线`);
else ok('无超过 600KB 的 jpg');

console.log('\n' + '─'.repeat(48));
console.log(fail === 0 ? `✅ 校验通过${warn ? `（${warn} 条提醒）` : ''}` : `❌ 校验失败：${fail} 项`);
process.exit(fail === 0 ? 0 : 1);
