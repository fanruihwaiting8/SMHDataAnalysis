#!/bin/bash
# SMH 数据分析助手启动脚本（每次都跑最新源码，禁用 pyc 缓存）
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# 禁用字节码缓存，确保使用最新源码
export PYTHONDONTWRITEBYTECODE=1
# 清理已有 __pycache__
find . -type d -name "__pycache__" -not -path "./.venv/*" -exec rm -rf {} + 2>/dev/null || true

# 启动 GUI（把标准输出/错误写入日志，便于排查双击 .app 时的崩溃原因）
# 关键：双击 .app 时 macOS 可能以 x86_64(Rosetta) 启动本 universal Python，
# 而 .venv 里的 numpy/matplotlib 只装了本机架构版本，架构不匹配会导致导入崩溃。
# 因此在 Apple Silicon(arm64) 上强制用 arm64 运行 Python，保证与已装的 wheel 一致。
LOG_FILE="$SCRIPT_DIR/smh_app.log"
echo "===== $(date) 启动 =====" >> "$LOG_FILE"

HW_ARCH="$(uname -m)"
if [ "$HW_ARCH" = "arm64" ] && command -v arch >/dev/null 2>&1; then
    exec arch -arm64 "$SCRIPT_DIR/.venv/bin/python" "$SCRIPT_DIR/main.py" >> "$LOG_FILE" 2>&1
else
    exec "$SCRIPT_DIR/.venv/bin/python" "$SCRIPT_DIR/main.py" >> "$LOG_FILE" 2>&1
fi