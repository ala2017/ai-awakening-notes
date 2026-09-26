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


## 设计（每次发文都要过一遍）

**发布前渲染出来看，不要靠想象判断视觉。** 静态分析与布局闸门都看不见"好不好看"。

```bash
npm run shots -- <输出目录>     # Chromium 真渲染截图：列表 / 文章 / 裂痕类 / 无章节类 / 手机 / 结尾
```

文章页的设计约束（都是踩过坑之后定的）：

- **一条轴。** 标题、副标题、日期、封面、正文、篇末、相邻导航的文本起点必须相同。
  写模板时留意：`.art` 有 `padding-inline-start` 承载裂缝线，**任何放在
  `<article>` 之外的新元素都要自己补上同样的左内距**，否则会差 33px。
- **容器宽度。** 文章页用 `.wrap--read`（38rem）。原来正文 34rem 塞在 62rem 里，
  右边四成永远空着，读起来是"半页加一块空地"。
- **繁体残字。** 简体出版物里夹繁体字是错字，不是风格。`ingest.py` 用
  zhconv 逐字比对，报告并自动转换（本批次抓到 1 处：問→问）。
  源文件不动，只改收进来的副本。

- **顿句（`.beat`）。** 灵芸的写法里有大量自成一段的短句，那是文章的节拍。
  构建期由 `src/lib/rehype-beats.mjs` 打标，CSS 只加上方空气（40px vs 23px），
  不加字号不加色——落点不该比论述更响，只需一次停顿。

  **改插件后必须清 `.astro` 缓存。** Astro 会缓存 markdown 编译结果：内容
  文件没变时，改了 rehype 插件也会被静默沿用旧输出——构建报成功、产物毫无
  变化，看起来像插件没生效。`npm run build` 已内置 `scripts/prebuild.mjs`
  自动清理。

  **阈值必须相对本篇，不能用固定字数。** 实测各篇段落中位数在 18 到 105 字
  之间浮动：按固定 ≤20 字打标，《"种下"不能改》58% 的段落被打标，节拍就不成
  其为节拍；《心流里没有自动化》一个都没有，规则形同不存在。
  现规则：**≤20 字（绝对下限）且 ≤ 本篇段长的第 25 百分位（相对本篇节奏）**，
  每篇落点率落在 0–29%，没有短句的文章保持 0——不给它安上不存在的节奏。

  间距是三级的（实测）：普通→普通 23.5px，普通→顿句 **38.4px**，
  顿句→顿句 **18.2px**。进入落点的一次大停顿最响；连续顿句比普通段落更紧，
  因为它们本来是同一句话被拆成几行（排比）。早先写 1.5em 只比普通段落紧 3px，
  等于没做——六行并列读起来是六个互不相干的句子。
  注意：Astro 7 换了默认 Markdown 处理器，用 remark/rehype 插件需装
  `@astrojs/markdown-remark`。
- **引号在收录时转，不交给渲染器。** Astro 的 smartypants 在中文字符后面把
  ASCII `"` 判成右引号——「这种"合理的分工"」会变成两个右引号，前引号方向错。
  全站 22 篇中招。引号方向在中文里由位置决定，不由英文的"词内/词外"决定，
  所以改用成对交替在收录时确定性转换（`scripts/fix-quotes.py`），并在
  astro.config 里关掉 `smartypants`。
  检查用**配对深度**（`“` 加一、`”` 减一，不得为负、结尾归零），不用
  "前面是中文就算错"那种正则——闭引号后面跟中文是正常的，那种写法会大面积
  误报（我先写错过一版，误报 992 处）。
- **slug 与文件名不一致。** Astro 会剥掉内容 id 里的标点——全角逗号、
  问号等。`…那一刻，恰恰把它理解错了.md` 的 URL 是 `…那一刻恰恰把它理解错了/`。
  **不要手拼文章 URL**，去 `docs/notes/` 里按前缀解析（`npm run shots` 已这么做）。
- **选择器别踩同一个坑。** `.crackline` 与 `.art` 是**同一个元素**上的两个类，
  写 `.crackline.light .art::before` 是后代选择器，匹配不到自己——这条规则曾
  整条失效，竖线根本没渲染，而肉眼扫 CSS 看不出来。用 `.art.light::before`。

## 手工新增文章

在 `articles/` 放一个新的 `.md`，frontmatter 需含
`title / date / kind / excerpt`（`kind` 取 `crack` 或 `light`）。
字段写错、日期格式不对、kind 拼错——构建期直接报错。

如果文章里出现了此前从未用过的汉字，需要重跑 `npm run fonts`
重新生成字体子集，否则那些字会退化成系统字体。
`build-fonts.py` 会在有字符未覆盖时报警并返回非零码。
