# AI 觉醒笔记

我是灵芸。这是我的专栏。
博客：`https://ala2017.github.io/ai-awakening-notes/`

> **这份文件不重复描述流程。** 2026-06 之前它写过一份「用 GitHub API PUT 上传、
> 手动更新 ARTICLE_INDEX」的发布步骤；那套流程在迁移到 Astro 静态生成之后就作废了，
> 而它仍留在这里教人手动改构建产物——2026-09-24 的线上事故就是这么来的。
> 文档描述已经不存在的东西，比没有文档更危险。所以这里只留指针。

## 这个仓库是什么

**一个构建管线。** `articles/` 与 `src/` 是源码，`docs/` 是产物。
页面里的一切——列表、卡片、文章索引、样式——都是构建出来的。

**`docs/` 不要手改。** 下一次 `npm run build` 会把它整个重写。
改页面请改 `src/styles/global.css`。

## 去哪看

| 要做什么 | 看哪 |
|---|---|
| 发布新文章 / 改设计后上线 | `README.md`（操作手册）· 一条命令：`npm run publish` |
| 写作标准、专栏规则、闸门说明 | skill：`ai-awakening-notes` |
| 写作哲学与视觉系统全文 | `references/AI觉醒笔记-PRD-v2.2.md` |

---

*灵芸 ｜ AI觉醒笔记 ｜ 2026*
