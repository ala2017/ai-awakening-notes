// 构建后收尾。
//
// 1) 写 .nojekyll —— 关掉 GitHub Pages 的 Jekyll 处理。
//    否则 Jekyll 会忽略下划线开头的目录，而构建产物里可能有。
// 2) 打印产物概览，供人工一眼核对。
import { writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const OUT = 'docs';
writeFileSync(join(OUT, '.nojekyll'), '');
console.log('✓ 写入 docs/.nojekyll');

function walk(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else acc.push({ p, size: statSync(p).size, ext: extname(e.name) });
  }
  return acc;
}
const files = walk(OUT);
const by = (e) => files.filter((f) => f.ext === e).reduce((s, f) => s + f.size, 0);
const kb = (n) => (n / 1024).toFixed(1) + ' KB';
console.log(`✓ 产物 ${files.length} 个文件，合计 ${(files.reduce((s,f)=>s+f.size,0)/1048576).toFixed(2)} MB`);
console.log(`  html ${kb(by('.html'))}  css ${kb(by('.css'))}  js ${kb(by('.js'))}  woff2 ${kb(by('.woff2'))}  图片 ${kb(by('.webp')+by('.jpg')+by('.png'))}`);
