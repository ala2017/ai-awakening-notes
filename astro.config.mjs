import { defineConfig } from 'astro/config';
import rehypeShape from './src/lib/rehype-shape.mjs';

// AI 觉醒笔记 —— 构建期静态生成
//
// 部署约定：产物输出到仓库根的 docs/，GitHub Pages 的 Source 保持
// "Deploy from a branch → main / docs" 不变。因此这次迁移不触碰任何仓库
// 设置，回滚只需一次 git revert。
//
// 硬约束（2026-09-25 确立，源自这次事故）：
//   1. 产物内不得出现任何第三方域名。字体、脚本、图片全部同源。
//   2. 不得有渲染阻塞的外部 <script>。能在构建期做完的，绝不留给运行时。
// 两条都由 scripts/verify.mjs 在每次构建后自动检查。
export default defineConfig({
  site: 'https://ala2017.github.io',
  base: '/ai-awakening-notes',

  outDir: './docs',
  publicDir: './public',

  // 资源目录不用默认的 _astro —— Jekyll 会忽略下划线开头的目录。
  // postbuild 另写 .nojekyll 兜底。
  build: {
    assets: 'assets',
    inlineStylesheets: 'auto',
  },

  markdown: {
    syntaxHighlight: false,
    // 内容整形：短段落打 beat 标记；小标题自带编号时关掉自动编号（见该文件注释）
    rehypePlugins: [[rehypeShape, { absMax: 20, quantile: 0.25 }]],
  },

  compressHTML: true,
});
