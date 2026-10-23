#!/bin/bash
# 一键打包：把 web/ 前端工具封装成自包含的 macOS .app，并压成 zip 便于分发。
#
# 产物：dist/半导体ETF回测.app  与  dist/半导体ETF回测-mac.zip
# 对方拿到 zip 后：解压 → 双击「半导体ETF回测.app」→ 浏览器自动打开回测页面。
# 依赖：仅需 macOS 自带的 python3（起静态 http 服务），无需 numpy / .venv。
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
APP_NAME="半导体ETF回测"
DIST="$HERE/dist"
APP="$DIST/$APP_NAME.app"
ZIP="$DIST/$APP_NAME-mac.zip"

echo "==> 清理旧产物"
rm -rf "$APP" "$ZIP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

echo "==> 拷贝 web 资源到 .app 内部（自包含，脱离源目录也能跑）"
mkdir -p "$APP/Contents/Resources/web"
# 只带运行必需文件，排除构建脚本与缓存
for f in index.html app.js backtest.js data.js serve.py build_data.py; do
  cp "$HERE/web/$f" "$APP/Contents/Resources/web/$f"
done

echo "==> 拷贝数据更新依赖（供页面「更新最新数据」按钮联网刷新用）"
# serve.py 的 /api/update 需要 update_data.py（父目录）与 build_smh_nasdaq.py，
# 以及 Input/ 下的 CSV。自包含 .app 里 serve.py 的父目录=Contents/Resources，
# 故这些依赖须拷到 Resources 根，update_data 的 Input 也在此。
for f in update_data.py build_smh_nasdaq.py; do
  cp "$HERE/$f" "$APP/Contents/Resources/$f"
done
mkdir -p "$APP/Contents/Resources/Input"
for f in QQQ_full_history.csv TQQQ_full_history.csv SMH_full_history.csv \
         SOXL_full_history.csv USD_full_history.csv; do
  cp "$HERE/Input/$f" "$APP/Contents/Resources/Input/$f"
done

echo "==> 写 Info.plist"
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key>
    <string>半导体ETF回测</string>
    <key>CFBundleDisplayName</key>
    <string>半导体ETF回测</string>
    <key>CFBundleIdentifier</key>
    <string>com.ferry.smhbacktest.web</string>
    <key>CFBundleVersion</key>
    <string>1.0.0</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0</string>
    <key>CFBundleExecutable</key>
    <string>launch</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>LSMinimumSystemVersion</key>
    <string>10.15</string>
    <key>NSHighResolutionCapable</key>
    <true/>
</dict>
</plist>
PLIST

echo "==> 写内部启动器"
cat > "$APP/Contents/MacOS/launch" <<'LAUNCH'
#!/bin/bash
# .app 内部启动器：起本地 http 服务并用默认浏览器打开回测页面。
# web 资源随 .app 一起分发，位于 Contents/Resources/web，故无外部依赖。
# 只用系统 python3 起静态服务器，不依赖 numpy/.venv，无需处理 arch 架构。
BUNDLE_DIR="$(cd "$(dirname "$0")/.." && pwd)"   # -> Contents
SERVE_PY="$BUNDLE_DIR/Resources/web/serve.py"

# 新开 Terminal 窗口运行，服务器持续存活，用户可见「关窗即停」提示。
osascript -e "tell application \"Terminal\" to do script \"python3 '$SERVE_PY'\"" \
          -e 'tell application "Terminal" to activate'
LAUNCH
chmod +x "$APP/Contents/MacOS/launch"

echo "==> 压缩为 zip（保留 .app 结构与可执行权限）"
cd "$DIST"
zip -qry "$ZIP" "$APP_NAME.app"

echo "==> 完成"
echo "    App : $APP"
echo "    Zip : $ZIP"
du -sh "$ZIP"