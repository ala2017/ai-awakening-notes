// 构建前置：清掉 .astro 缓存。
//
// 踩过的坑（2026-09-25）：Astro 会把 markdown 的编译结果缓存在 .astro/。
// 改了 rehype 插件（例如调整顿句阈值）但内容文件没变时，Astro 会静默沿用
// 缓存的旧输出——构建报成功、产物毫无变化，看起来像插件没生效。
// 当时我以为是插件写错了，查了半天。构建总共 1 秒多，缓存省不下什么。
import { rmSync } from 'node:fs';
rmSync('.astro', { recursive: true, force: true });
console.log('✓ 已清 .astro 缓存');
