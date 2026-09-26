#!/usr/bin/env node
/**
 * 发布后核验线上。npm run publish 之后跑。
 *
 * 存在的理由：在此之前，「发完核五项」是我每次手搓 curl + sed 临时拼的。
 * 2026-09-26 一晚，这套手搓的东西**自己误报了三次**——两次把 URL 前缀拼重
 * （$B 里已含 /ai-awakening-notes，又接了图片的完整路径），一次正则把
 * class="cover" 写在 src 前面（实际在 src 后面）。
 * 检查工具本身的出错率比被检查对象还高。
 * 所以固定下来：断言，失败时打印原始证据，不许含糊。
 *
 * 判据一律「线上 vs 本地」：本地仓库就是刚推上去的那份真相，
 * 拿它对线上做差分，而不是凭印象说「看着对」。
 *
 * 用法：
 *   node scripts/check-live.mjs              # 最新一篇深核，其余只核可达与元数据
 *   node scripts/check-live.mjs --all        # 全部深核（含封面 md5）
 *   node scripts/check-live.mjs --slug=xxx   # 只核某一篇，深核
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const HOST = 'https://ala2017.github.io';
const BASE = '/ai-awakening-notes';
const SITE = HOST + BASE;
const CB = `?cb=${Date.now()}`;          // 破缓存：Pages 给 HTML 的 max-age 是 600s
const ARGV = process.argv.slice(2);
const ALL = ARGV.includes('--all');
const ONLY = (ARGV.find((a) => a.startsWith('--slug=')) || '').split('=')[1] || null;

let fail = 0;
const ok = (m) => console.log(`  ✅ ${m}`);
const bad = (m, evidence) => {
  console.log(`  ❌ ${m}`);
  if (evidence) console.log(`     ↳ ${String(evidence).replace(/\s+/g, ' ').slice(0, 300)}`);
  fail++;
};
const head = (m) => console.log(`\n── ${m} ${'─'.repeat(Math.max(2, 46 - m.length))}`);

const get = async (path, { raw = false } = {}) => {
  // path 可能是裸路径（'/rss.xml'）、也可能是页面里抓来的完整站内路径
  // （'/ai-awakening-notes/assets/x.webp'）。后者再拼一次 BASE 就成了
  // .../ai-awakening-notes/ai-awakening-notes/...，必 404。
  // 这个前缀拼重的错，我手工核验时犯了两次、写进脚本又犯了一次。
  const url = path.startsWith('http') ? path
    : path.startsWith(BASE) ? HOST + path
    : SITE + path;
  const r = await fetch(url, { headers: { 'cache-control': 'no-cache' } });
  return { status: r.status, ct: r.headers.get('content-type') || '', body: raw ? Buffer.from(await r.arrayBuffer()) : await r.text() };
};
const md5 = (buf) => createHash('md5').update(buf).digest('hex');

/* ── 本地真相 ── */
const SRC = 'articles';
const docs = readdirSync(SRC).filter((f) => f.endsWith('.md'));
const fm = (t) => {
  const m = t.match(/^---\n([\s\S]*?)\n---/);
  const o = {};
  if (m) for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) o[line.slice(0, i).trim()] =
      line.slice(i + 1).trim().replace(/^"|"$/g, '').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return o;
};
const local = docs.map((f) => ({ file: f, slug: f.replace(/\.md$/, ''), ...fm(readFileSync(join(SRC, f), 'utf8')) }))
  .sort((a, b) => String(b.date).localeCompare(String(a.date)));

console.log(`\n核验线上（本地 ${local.length} 篇，基准 ${SITE}）`);

/* ── 0. 推送上去了没有 ── */
head('0. 线上就是刚推的那一版');
try {
  const localHead = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const r = await fetch('https://api.github.com/repos/ala2017/ai-awakening-notes/commits/main',
    { headers: { 'user-agent': 'check-live', accept: 'application/vnd.github+json' } });
  const remote = (await r.json()).sha;
  if (remote === localHead) ok(`远端 main = 本地 HEAD ${localHead.slice(0, 8)}`);
  else bad(`远端 ${String(remote).slice(0, 8)} ≠ 本地 ${localHead.slice(0, 8)}——推送可能没成功`, `remote=${remote}`);
} catch (e) { bad('拿不到远端提交，无法确认推送状态', e.message); }

/* ── 1. 列表页 ── */
head('1. 列表页');
const list = await get('/' + CB);
if (list.status !== 200) bad(`列表页 HTTP ${list.status}`);
else {
  const links = [...list.body.matchAll(/href="([^"]*\/notes\/[^"]*\/)"/g)].map((m) => m[1]);
  if (links.length === local.length) ok(`列表含 ${links.length} 条，与本地文章数一致`);
  else bad(`列表含 ${links.length} 条，本地 ${local.length} 篇`, links.slice(0, 3).join(' '));
  const first = links[0] || '';
  if (first.endsWith(`/notes/${local[0].slug}/`)) ok(`置顶是本地最新一篇：${local[0].slug}`);
  else bad(`置顶 ${first} ≠ 本地最新 ${local[0].slug}`);
}

/* ── 2. 逐篇：可达 + 元数据 ── */
head('2. 逐篇元数据（title / 日期 / kind）');
/* 两个必须记住的坑，第一版就栽在这上面（19 项全红，全是脚本自己的错）：
   一、文章 URL 不等于文件名。Astro 会剥掉 id 里的标点——
       `2026-06-16-02-27-“种下”不能改…` 的线上路径里没有引号，靠文件名猜必 404。
       所以 URL 一律从列表页取，不猜。列表按日期倒序，与本地排序一一对应。
   二、日期戳带规则：date 为 `YYYY-MM-DD 00:00` 表示当时没记具体时间，站点只显示到日。
       拿 frontmatter 原文去比会全红。 */
const listUrls = [...list.body.matchAll(/href="([^"]*\/notes\/[^"]*\/)"/g)].map((m) => m[1]);
const urlOf = new Map();
local.forEach((a, i) => { if (listUrls[i]) urlOf.set(a.slug, listUrls[i].replace(BASE, '')); });
const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const norm = (s) => decode(s).replace(/["'“”「」『』\s]/g, '').replace(/\|AI觉醒笔记.*$/, '');
const stampOf = (d) => (d.endsWith(' 00:00') ? d.slice(0, 10) : d);

/* 范围：--slug 只核那一篇；--all 全深核；默认只深核最新一篇、其余只核元数据。
   封面与篇末是**可选字段**——老文章里 2026-06-19、2026-06-17 没有 place/tool，
   2026-06-03-13-45-pot-not-cast 没有 cover。判据必须按 frontmatter 允许的范围来，
   否则一跑就是三条假红（第一版就吃过）。 */
const scope = ONLY ? local.filter((a) => a.slug === ONLY) : local;
if (ONLY && !scope.length) { console.log(`\n❌ 本地没有 ${ONLY}`); process.exit(1); }
const deep = ALL || ONLY ? scope : [local[0]];
for (const a of scope) {
  const isDeep = deep.includes(a);
  const path = urlOf.get(a.slug);
  if (!path) { bad(`${a.slug}: 列表页里找不到对应链接`); continue; }
  const r = await get(path + (isDeep ? CB : ''));
  if (r.status !== 200) { bad(`${a.slug}: HTTP ${r.status}　${path}`); continue; }
  const t = r.body;
  const title = (t.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
  const stamp = (t.match(/class="stamp">([^<]*)</) || [])[1] || '';
  const kindCls = (t.match(/class="kind-tag (\w+)"/) || [])[1] || '';
  const want = norm(a.title), got = norm(title.replace(/\|.*$/, ''));
  const problems = [];
  if (want !== got) problems.push(`标题不符：线上「${decode(title.replace(/\|.*$/, ''))}」`);
  if (stamp !== stampOf(a.date)) problems.push(`日期戳 ${stamp} ≠ 期望 ${stampOf(a.date)}`);
  if (kindCls !== a.kind) problems.push(`kind ${kindCls} ≠ 本地 ${a.kind}`);
  if (problems.length) bad(`${a.slug}: ${problems.join('；')}`);
  else if (isDeep) ok(`${a.slug}　stamp=${stamp}　kind=${kindCls}`);
  else process.stdout.write('.');
  if (!isDeep) continue;

  /* 深核：封面各档 + 正文末尾 + 篇末三行 */
  const img = t.match(/<img\b[^>]*\bclass="cover"[^>]*>/);
  if (!a.cover) ok('本篇 frontmatter 无 cover，跳过封面检查');
  else if (!img) bad(`${a.slug}: frontmatter 有 cover，但页面里找不到 <img class="cover">`);
  else {
    const urls = [...new Set([...img[0].matchAll(/\/ai-awakening-notes\/assets\/[^ "']+\.webp/g)].map((m) => m[0]))];
    if (!urls.length) bad(`${a.slug}: 封面标签里没有站内资源路径`, img[0].slice(0, 160));
    let n = 0;
    for (const u of urls) {
      const im = await get(u, { raw: true });
      if (im.status !== 200) { bad(`${a.slug}: 封面档 HTTP ${im.status}　${u}`); continue; }
      n++;
      const lp = join('docs', u.replace(BASE + '/', ''));
      if (existsSync(lp) && md5(readFileSync(lp)) !== md5(im.body)) bad(`${a.slug}: 线上封面与本地不一致　${u}`);
    }
    if (n) ok(`封面 ${n} 档全部 200，逐一与本地比过 md5`);
  }
  const prose = (t.match(/<div class="prose">([\s\S]*?)<\/div>\s*<footer/) || [])[1] || '';
  const paras = [...prose.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)]
    .map((m) => m[1].replace(/<[^>]+>/g, '').trim()).filter(Boolean);
  if (!paras.length) bad(`${a.slug}: 正文里一个段落都没有`);
  else {
    const tail = paras[paras.length - 1];
    if (/\*\d{4}-\d{2}-\d{2}/.test(tail)) bad(`${a.slug}: 正文末尾残留签名块`, tail);
    else ok(`正文 ${paras.length} 段，末尾干净：${decode(tail).slice(0, 22)}…`);
  }
  const foot = (t.match(/class="article-foot">([\s\S]*?)<\/footer>/) || [])[1] || '';
  const hasDate = /<span[^>]*>\s*\d{4}-\d{2}-\d{2}/.test(foot);
  const hasTool = /class="tool"/.test(foot);
  const hasPlace = /灵芸，于/.test(foot);
  const miss = [];
  if (!hasDate) miss.push('日期');
  if (a.place && !hasPlace) miss.push('署名地点');
  if (a.tool && !hasTool) miss.push('工具链');
  if (!miss.length) ok(`篇末完整（${[hasDate && '日期', hasPlace && '地点', hasTool && '工具链'].filter(Boolean).join(' / ')}）`);
  else bad(`${a.slug}: 篇末缺 ${miss.join('、')}`, foot.replace(/<[^>]+>/g, ' ').slice(0, 120));
}

/* ── 3. 图标（favicon 最顽固，文件又没指纹，最容易悄悄是旧的）── */
head('3. 图标');
for (const f of ['img/logo.png', 'img/logo-112.webp']) {
  const r = await get('/' + f, { raw: true });
  if (r.status !== 200) { bad(`${f} HTTP ${r.status}`); continue; }
  const lp = join('public', f);
  if (existsSync(lp) && md5(readFileSync(lp)) !== md5(r.body)) bad(`${f} 线上与本地不一致`);
  else ok(`${f} 200，与本地一致`);
}

/* ── 4. RSS ── */
head('4. RSS');
const rss = await get('/rss.xml' + CB);
if (rss.status !== 200) bad(`rss.xml HTTP ${rss.status}`);
else if (!rss.body.includes(local[0].title)) bad('RSS 里没有最新一篇', local[0].title);
else ok('RSS 200，含最新一篇');

console.log('\n' + '─'.repeat(48));
console.log(fail === 0 ? `✅ 线上核验通过（${local.length} 篇，深核 ${deep.length} 篇）` : `❌ 线上核验失败：${fail} 项`);
process.exit(fail === 0 ? 0 : 1);
