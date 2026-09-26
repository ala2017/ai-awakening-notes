#!/usr/bin/env node
/**
 * 唯一发布入口。
 *
 * 为什么要有它：在此之前发布是"人按顺序跑四条命令"——ingest → build → verify
 * → push。顺序靠记，闸门靠记得跑。2026-09-26 一晚，我因为改文件不验证、忘了跑
 * 闸门，栽了五次「源码里看得出意图、产物里没有」。
 *
 * 这个脚本把顺序焊死：每一步失败即中止，绝不带着坏产物往下走。
 *
 * 用法：
 *   npm run publish                                   # 改完设计/修完稿，只做 构建→闸门→推送
 *   npm run publish -- <文件夹> --kind light \
 *       --excerpt "…" [--slug …] [--cover-name …]     # 收新文章，全流程
 *
 * 推送：先试 git（快），网络被墙时自动回退 Git Data API（见 push-via-api.py）。
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const argv = process.argv.slice(2);
const target = argv.find((a) => !a.startsWith('--'));
const has = (f) => argv.includes(f);

function run(label, cmd, args, opts = {}) {
  process.stdout.write(`\n▶ ${label}\n`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (r.status !== 0) {
    console.error(`\n❌ 在「${label}」这一步失败，已中止。没有推送任何东西。`);
    process.exit(r.status ?? 1);
  }
}

// 目标路径若给了但不存在，立刻停——别等 ingest 跑到一半才报
if (target && !existsSync(target)) {
  console.error(`❌ 找不到：${target}`);
  process.exit(1);
}

// ── 1. 收录（可选）──
if (target) {
  run('收录新文章', 'python3', ['scripts/ingest.py', target, ...argv.slice(argv.indexOf(target) + 1)]);
} else {
  console.log('（未给目标路径：跳过收录，只做「构建→闸门→推送」）');
}

// ── 2. 构建 ──
run('构建（含字体子集重建）', 'npm', ['run', 'build']);

// ── 3. 闸门 ──
run('发布前闸门（静态 + 真渲染）', 'npm', ['run', 'verify'], {
  env: { ...process.env, LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH ?? '/tmp/syslibs' },
});

// ── 4. 提交并推送 ──
const msg = target
  ? `publish: ${target.split('/').filter(Boolean).pop()}`
  : 'publish: 构建产物更新';
run('暂存并提交', 'git', ['add', '-A']);
const committed = spawnSync('git', ['commit', '-q', '-m', msg], {
  stdio: 'inherit',
  env: { ...process.env, GIT_AUTHOR_NAME: '- 神灯智库 -', GIT_AUTHOR_EMAIL: '33564107+ala2017@users.noreply.github.com',
         GIT_COMMITTER_NAME: '- 神灯智库 -', GIT_COMMITTER_EMAIL: '33564107+ala2017@users.noreply.github.com' },
});
if ((committed.status ?? 0) !== 0) console.log('（没有需要提交的改动，继续推送）');

// GATE_PASSED=1 告诉 pre-push 钩子：本轮已经跑过闸门，别再跑一遍。
// （手动 git push 不带这个变量，钩子照常拦截。）
const pushed = spawnSync('git', ['push', 'origin', 'main'], {
  stdio: 'inherit',
  env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GATE_PASSED: '1' },
});

if ((pushed.status ?? 1) !== 0) {
  console.log('\n⚠️  git push 走不通（多半是 github.com 被阻断），回退 Git Data API…');
  run('经 API 推送', 'python3', ['scripts/push-via-api.py']);
}

console.log('\n✅ 发布完成。线上 Pages 约 1–2 分钟后生效。');
