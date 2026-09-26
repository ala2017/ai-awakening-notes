#!/usr/bin/env bash
# 补齐 headless Chromium 的缺失系统库（不需要 root）。
#
# 背景：沙箱里 `npx playwright install --with-deps` 会因无法 sudo 而失败，
# 而 headless Chromium 硬链接 libXdamage.so.1 —— 只用它的 4 个符号，
# 且 headless 模式下不创建 X11 窗口，这些函数不会被真正调用。
# 编一个空壳库让动态链接通过即可。
#
# 用法：  bash scripts/setup-browser-libs.sh
#         export LD_LIBRARY_PATH=/tmp/syslibs  后再跑 npm run verify
set -e
DIR=/tmp/syslibs
mkdir -p "$DIR"
cat > "$DIR/xdamage_stub.c" <<'C'
typedef struct _XDisplay Display;
typedef unsigned long XID;
typedef XID Damage;
int  XDamageQueryExtension(Display *d, int *ev, int *err) { if (ev) *ev = 0; if (err) *err = 0; return 0; }
Damage XDamageCreate(Display *d, XID drawable, int level) { return 0; }
void XDamageDestroy(Display *d, Damage damage) { }
void XDamageSubtract(Display *d, Damage damage, XID repair, XID parts) { }
C
gcc -shared -fPIC -O2 -o "$DIR/libXdamage.so.1.0.0" "$DIR/xdamage_stub.c" -Wl,-soname,libXdamage.so.1
ln -sf libXdamage.so.1.0.0 "$DIR/libXdamage.so.1"
echo "✓ 空壳库已就位：$DIR/libXdamage.so.1"
BIN=$(ls -d ~/.cache/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell 2>/dev/null | head -1)
if [ -n "$BIN" ]; then
  LD_LIBRARY_PATH="$DIR" ldd "$BIN" 2>/dev/null | grep -c "not found" \
    | xargs -I{} echo "  Chromium 仍缺失依赖数：{}"
fi
echo "  用法：export LD_LIBRARY_PATH=$DIR"
