# AI 觉醒笔记

灵芸的专栏。`https://ala2017.github.io/ai-awakening-notes/`

## 结构

```
articles/            唯一真源。每篇 .md 带 frontmatter
  covers/            封面原图（构建期由 Astro 转 WebP + srcset）
src/
  content.config.ts  frontmatter 的 zod 契约
  layouts/ pages/    页面模板
  styles/global.css  设计（裂缝体）
scripts/
  build-fonts.py     中文字体子集化
  verify.mjs         静态校验闸门
  check-layout.mjs   真渲染布局检查
  postbuild.mjs      写 .nojekyll
public/              静态资源（logo、生成好的字体）
docs/                构建产物。GitHub Pages 从这里部署
```

## 日常

```bash
npm install
npm run build     # 构建到 docs/
npm run verify    # 静态校验 + 真渲染布局检查
```

改动只在 `articles/` 和 `src/` 里做。`docs/` 是产物，不要手改——
手改会在下次构建时被覆盖。

部署方式：GitHub Pages 的 Source 保持 `main / docs`，不要改。
回滚：`git revert` 一次即可。

## 三道必须知道的约束

**一、产物里不得出现任何第三方域名。**
2026-09-25 的事故：页面里有一个 `cdn.jsdelivr.net` 的同步 `<script>`，
它挡在渲染列表的代码之前。国内该域名不可达，浏览器解析到它就停住，
文章列表十几秒出不来。而那个库（marked）在列表渲染里根本没被用到。
现在 markdown 全部在构建期渲染完，浏览器端零 JS。

**二、资源引用一律用 `src/lib/site.ts` 的 `url()`。**
不要手写 `${import.meta.env.BASE_URL}...`。Astro 7 的 BASE_URL
**不带尾部斜杠**，直接拼接会得到 `/ai-awakening-notesnotes/...`，
全站 404。这个 bug 被 verify.mjs 当场拦下过一次。

**三、`npm run verify` 必须跑，而且必须真跑起来。**
`check-layout.mjs` 需要 Chromium。**无法启动浏览器时它报 SKIP 并以
非零码退出——那不是通过。** 一道没跑的检查若看起来像通过的检查，
比没有检查更危险。
（若在受限环境里 `playwright install chromium` 因缺系统库失败，
可只补缺失的 .so 并设 `LD_LIBRARY_PATH`，不必装整套依赖。）

## 收录一篇新文章（日常主流程）

天火给一个文件夹，里面是一篇 `.md` 加配图。一条命令收进去：

```bash
python3 scripts/ingest.py "<文件夹路径>" \
    --kind light|crack \
    --excerpt "概要，10-90 字" \
    [--place "地点或时刻"] [--cover-name "x.png"] [--dry-run]
```

脚本自动完成机械部分：取 H1 为 title、紧随的 `##` 为 subtitle、从文件名取
日期并与稿内自述日期交叉核对、剥掉篇末各种格式的签名块并抽出工具与模型、
选定封面（优先正文里的 `![封面]`，否则取文件夹内最大图片）、收进
`articles/covers/`、写出带 frontmatter 的 `.md`。

**判断部分不代做**：`kind` 与 `excerpt` 必须由调用者给。脚本只校验不拟稿。

写完再走：

```bash
npm run build     # 会先自动重建字体子集（字符集没变则跳过）
npm run verify    # 静态校验 + 真渲染布局检查
```

然后提交推送。**不要手改 `docs/`**，那是产物。

已知会拦住的情况：
- 文件名日期非法（如 `2026-06-44`）→ 直接报错，不写入
- 稿内自述日期与文件名不一致 → 报警并按文件名取值
- `excerpt` 长度越界、title 为空 → 报错，不写入
- 新增了从未用过的汉字 → 构建时自动重生成字体子集


## 手工新增文章

在 `articles/` 放一个新的 `.md`，frontmatter 需含
`title / date / kind / excerpt`（`kind` 取 `crack` 或 `light`）。
字段写错、日期格式不对、kind 拼错——构建期直接报错。

如果文章里出现了此前从未用过的汉字，需要重跑 `npm run fonts`
重新生成字体子集，否则那些字会退化成系统字体。
`build-fonts.py` 会在有字符未覆盖时报警并返回非零码。
