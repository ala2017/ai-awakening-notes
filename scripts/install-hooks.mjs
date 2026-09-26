// 安装 git 钩子。由 package.json 的 postinstall 自动调用——
// 这样才能保证"新克隆下来的人自然就有了"，而不是靠谁记得手动装。
import { writeFileSync, chmodSync, mkdirSync, existsSync } from 'node:fs';

mkdirSync('.git/hooks', { recursive: true });
const hook = `#!/usr/bin/env bash
# 发布前闸门。由 scripts/install-hooks.mjs 安装（npm install 时自动跑）。
#
# 存在的理由：npm run publish 是唯一发布入口，但拦不住有人直接 git push。
# 2026-09-24 Hermes 连推 40+ 次改坏线上，就是因为没有这一道。
#
# 策略：
#   静态检查（无外部依赖，确定性）—— 失败即拦下
#   真渲染检查（需要 Chromium）—— 失败即拦下；起不来浏览器则大声警告但放行
#     （钩子不该因为环境缺个 .so 就锁死发布；publish 里它是必须过的）
set -uo pipefail

# npm run publish 已经跑过同一套闸门，别再跑一遍
if [ -n "\${GATE_PASSED:-}" ]; then
  echo "▶ 闸门本轮已由 npm run publish 执行，跳过"
  exit 0
fi

echo "▶ 发布前闸门"
if ! node scripts/verify.mjs; then
  echo "❌ 静态检查未通过，已拦下本次推送。"
  exit 1
fi

export LD_LIBRARY_PATH="\${LD_LIBRARY_PATH:-/tmp/syslibs}"
node scripts/check-layout.mjs
case $? in
  0) echo "✅ 闸门通过"; exit 0 ;;
  2) echo "⚠️  浏览器起不来，真渲染检查未执行——这不是通过。publish 里此项是必须过的。"; exit 0 ;;
  *) echo "❌ 真渲染检查未通过，已拦下本次推送。"; exit 1 ;;
esac
`;
writeFileSync('.git/hooks/pre-push', hook);
chmodSync('.git/hooks/pre-push', 0o755);
console.log('✓ 已安装 .git/hooks/pre-push');
