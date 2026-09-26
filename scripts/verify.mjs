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
import { execFileSync } from 'node:child_process';
import { join, extname, basename, dirname } from 'node:path';

const OUT = process.argv[2] ?? 'docs';  // 可传目录，便于把 bug 注入副本反证闸门
const SRC = process.env.SRC_DIR ?? 'articles';
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

console.log('\n── 7. 元数据不得在正文中重复 ────────────────');
/* 2026-09-25：ingest 脚本里把副标题从正文剥掉的那段逻辑被后续分支覆盖，
   结果副标题同时出现在标题下方和正文开头。溢出、404、阻塞一个都没触发，
   所有结构检查全绿——这类"看起来对但重复了"的错误只有语义检查能抓。

   判据收窄到「标题元素」而非纯文本：像「脑袋清醒的时候」这种短语本来
   就会在正文里自然出现，按文本包含判断会大面积误报。 */
const stripTags = (h) => h.replace(/<[^>]+>/g, '').replace(/\s+/g, '');
let dup = 0;
for (const f of notePages) {
  const t = readFileSync(f, 'utf8');
  const name = basename(dirname(f));
  const m = t.match(/<div class="prose">([\s\S]*?)<\/div>\s*<footer/);
  if (!m) { soft(`${name}: 找不到正文区，跳过重复检查`); continue; }
  const inner = m[1];
  const headings = [...inner.matchAll(/<h([1-4])[^>]*>([\s\S]*?)<\/h\1>/gi)].map((x) => stripTags(x[2]));
  const meta = [];
  const h1 = t.match(/<h1>([\s\S]*?)<\/h1>/);
  if (h1) meta.push(['标题', stripTags(h1[1])]);
  const sub = t.match(/<p class="subtitle">([\s\S]*?)<\/p>/);
  if (sub) meta.push(['副标题', stripTags(sub[1])]);
  for (const [label, text] of meta) {
    if (text && headings.includes(text)) { bad(`${name}: ${label}在正文中作为标题重复出现`); dup++; }
  }
  if (/<h1[\s>]/i.test(inner)) { bad(`${name}: 正文内出现第二个 <h1>`); dup++; }
}
if (!dup) ok(`${notePages.length} 篇文章页：标题与副标题均未在正文中重复`);

console.log('\n── 8. 图片必须指向站内资源 ──────────────────');
/* 2026-09-25：ingest 脚本没剥掉正文里的 ![封面](cover-01.png)，它会渲染成
   一个相对路径的破图——文件实际在 articles/covers/ 下，而页面在 /notes/xx/。
   与"副标题重复"同一类：看着对、结构检查全绿、上线才是坏的。 */
const BASE = '/ai-awakening-notes/';
let badSrc = 0;
for (const f of htmls) {
  const t = readFileSync(f, 'utf8');
  for (const m of t.matchAll(/<img\b[^>]*?\bsrc\s*=\s*"([^"]*)"/gi)) {
    const src = m[1];
    if (src.startsWith(BASE) || src.startsWith('data:')) continue;
    bad(`${basename(f)}: 图片使用了非站内路径 "${src}"`);
    badSrc++;
  }
}
if (!badSrc) ok(`${htmls.length} 个页面：所有 <img src> 均指向站内资源`);

console.log('\n── 9. 引号方向与配对 ────────────────────────');
/* 2026-09-25：Astro 的 smartypants 在中文字符后面把 ASCII " 判成右引号，
   「这种"合理的分工"」被转成两个右引号，全站普遍中招，而我看了很多次
   截图都没看出来——直到把字符码位打出来。
   判据用配对深度，不用"前面是中文就算错"那种正则：闭引号后面跟中文是正常的，
   那种写法会大面积误报（我先写错过一版，误报 992 处）。 */
let qbad = 0;
for (const f of notePages) {
  const raw = readFileSync(f, 'utf8');
  const m = raw.match(/<div class="prose">([\s\S]*?)<\/div>\s*<footer/);
  if (!m) continue;
  // 先摘掉代码块与行内代码——里面的引号是代码的一部分，不该转换也不该检查
  const text = m[1]
    .replace(/<pre[\s\S]*?<\/pre>/gi, '')
    .replace(/<code[\s\S]*?<\/code>/gi, '')
    .replace(/<[^>]+>/g, '');
  let depth = 0, opens = 0, closes = 0, err = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\u201c') { depth++; opens++; }
    else if (ch === '\u201d') { closes++; if (depth === 0) { err = `第 ${i} 字处出现无配对的闭引号`; break; } depth--; }
    else if (ch === '"') { err = `第 ${i} 字处仍有未转换的直引号`; break; }
  }
  if (!err && depth !== 0) err = `余 ${depth} 个开引号未闭合`;
  if (err) { bad(`${basename(dirname(f))}: ${err}`); qbad++; }
}
if (!qbad) ok(`${notePages.length} 篇文章页：引号方向正确、全部配对`);

console.log('\n── 10. 源稿的围栏嵌套 ──────────────────────');
/* 2026-09-26：给长文加结构目录时发现 agent-bi-chat-ruo 的「4. 路径 2」整节
   被吞成了代码块——上线三个月没人看见。
   成因：源稿用 ```markdown 包一段示例，里面又嵌了 ```bash。Markdown 的围栏
   不能这样嵌套（内层带 info 的围栏不闭合外层），后面的围栏语意整体错位。
   改法是外层用四个反引号。

   判据只看**同长度且带 info** 的围栏出现在开着的围栏里——那才是嵌套误用。
   不要用"<pre> 里出现 # 行"来判断：bash 注释、python 注释、示例 markdown
   本来就长那样，实测会误报 5 处、真问题只有 1 处。 */
let fenceBad = 0;
for (const f of readdirSync(SRC).filter((x) => x.endsWith('.md'))) {
  const lines = readFileSync(join(SRC, f), 'utf8').split('\n');
  let open = null;
  lines.forEach((l, i) => {
    const m = l.match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (!m) return;
    const len = m[1].length, info = m[2].trim();
    if (open === null) { open = len; return; }
    if (!info && len >= open) { open = null; return; }      // 合法闭合
    if (info && len === open) {                              // 同长度 + 带 info → 嵌套误用
      bad(`${f}:${i + 1} 开着的 ${open} 反引号围栏里又出现带 info 的围栏「${info}」`);
      fenceBad++;
    }
  });
  if (open !== null) { bad(`${f}: 围栏未闭合（余 ${open} 个反引号开着）`); fenceBad++; }
}
if (!fenceBad) ok(`${readdirSync(SRC).filter((x) => x.endsWith('.md')).length} 篇源稿：围栏配对正常、无嵌套误用`);

console.log('\n── 11. 文本文件不得被 NUL 污染 ──────────────');
/* 2026-09-26：仓库里的 md_to_wechat_html.py 被追加了 136 个尾随 NUL，
   Python 直接 "source code string cannot contain null bytes"——脚本是死的，
   而没人发现，因为它不在主管道上。同类事故此前还发生在文章文件上
   （2026-06-06-xiangtou-buyao-xiezi.md 尾部 20 个 NUL）。
   成因是 FUSE/写入链路上的截断填充，静默、无报错。
   只查文本类文件——二进制文件（字体/图片）本来就有 0x00，不能一概而论。 */
const TEXT_EXT = ['.md', '.py', '.mjs', '.js', '.json', '.css', '.html', '.astro', '.ts', '.txt', '.sh', '.yml', '.yaml'];
let nulBad = 0;
(function scan(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) { scan(p); continue; }
    if (!TEXT_EXT.some((x) => e.name.toLowerCase().endsWith(x))) continue;
    const raw = readFileSync(p);
    if (raw.includes(0)) {
      bad(`${p}: 含 ${raw.filter((b) => b === 0).length} 个 NUL 字节（文本文件被污染，多半无法解析）`);
      nulBad++;
    }
  }
})('.');
if (!nulBad) ok('文本文件全部干净，无 NUL 污染');

console.log('\n── 12. 字体子集的覆盖 ───────────────────────');
/* 2026-09-26：新增项目说明页时，标题里 16 个字掉到备用字体，而所有检查全绿。
   成因是 build-fonts.py 的取字口径只扫 articles/*.md 的标题行，.astro 页面没进过；
   更阴的是表格里那些英文层级名在源码里写作 {name}，正则永远看不到真实值。

   为什么必须在这里查、不能在建字体时查：建字体跑在 astro build 之前，那一刻
   产物还不存在；唯一能回答"到底渲染了什么字"的只有构建产物。而"这个字在不在
   字体里"只能问字体文件本身——node 解不了 woff2，所以借构建本来就要用的
   python3 + fontTools 读一次真实 cmap。读不到就显式 SKIP，绝不静默通过。

   判据分两层：
     · 900 字重（h1-h3 与 strong）用到的字，必须在 head-900 里——缺了会掉到
       备用字体，而 font-synthesis:none 禁掉假粗，标题会一块一块地变细。
     · 页面上的全部文字，必须在 head-900 ∪ body-400 里。
   范围只算 CJK 表意区（U+2E80-9FFF）与可打印 ASCII，与 build-fonts 的 codes()
   一致：**标点不在子集里是全站的既有取舍**，不在这里报。两者要一起改。 */
const FONT_PY = `
import sys, json
from fontTools.ttLib import TTFont
out = {}
for p in sys.argv[1:]:
    out[p] = sorted(TTFont(p).getBestCmap().keys())
json.dump(out, sys.stdout)
`;
const HEAD_FONT = join(OUT, 'fonts', 'head-900.woff2');
const BODY_FONT = join(OUT, 'fonts', 'body-400.woff2');
let cmaps = null;
if (!existsSync(HEAD_FONT) || !existsSync(BODY_FONT)) {
  soft('找不到字体产物，跳过覆盖检查');
} else {
  try {
    const raw = execFileSync('python3', ['-c', FONT_PY, HEAD_FONT, BODY_FONT],
                             { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] });
    cmaps = JSON.parse(raw);
  } catch (e) {
    soft(`读不到字体 cmap（需要 python3 + fontTools），跳过覆盖检查 —— 这不是通过`);
  }
}
if (cmaps) {
  const headSet = new Set(cmaps[HEAD_FONT]);
  const bodySet = new Set(cmaps[BODY_FONT]);
  const decode = (s) => s.replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ');
  // 与 build-fonts.py 的 codes() 保持同一范围
  const inScope = (cp) => (cp >= 0x2E80 && cp <= 0x9FFF) || (cp >= 0x20 && cp < 0x7F);
  const need900 = new Set(), need400 = new Set();
  for (const f of htmls) {
    const t = readFileSync(f, 'utf8');
    for (const m of t.matchAll(/<(h1|h2|h3|strong)\b[^>]*>([\s\S]*?)<\/\1>/gi))
      for (const ch of decode(m[2])) if (inScope(ch.codePointAt(0))) need900.add(ch);
    for (const ch of decode(t)) if (inScope(ch.codePointAt(0))) need400.add(ch);
  }
  const miss900 = [...need900].filter((c) => !headSet.has(c.codePointAt(0)));
  const miss400 = [...need400].filter((c) => !headSet.has(c.codePointAt(0)) && !bodySet.has(c.codePointAt(0)));
  if (miss900.length) bad(`900 字重缺字 ${miss900.length} 个（会掉到备用字体）：${miss900.join('')}`);
  else ok(`900 字重 ${need900.size} 字全部覆盖（h1-h3 与 strong）`);
  if (miss400.length) bad(`正文缺字 ${miss400.length} 个：${miss400.join('')}`);
  else ok(`正文 ${need400.size} 字全部覆盖`);
}

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
