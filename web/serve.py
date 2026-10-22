#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
本地预览启动器：在 web/ 目录起一个静默 http 服务器，并自动用默认浏览器打开页面。

为什么要起服务器而不是直接双击 index.html：
  index.html 通过 <script src="data.js"> 引入本地脚本，若用 file:// 直接打开，
  部分浏览器会因同源/本地文件策略拒绝加载，页面会空白。走 http://127.0.0.1 最稳。

端口自动探测：从 8777 起逐个尝试，避免被占用时启动失败。
关闭方式：关掉弹出的终端窗口，或按 Ctrl+C。
"""
import os
import sys
import json
import socket
import threading
import webbrowser
import http.server
from functools import partial

WEB_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(WEB_DIR)  # 上层目录含 update_data.py / Input/
# 让 import update_data（父目录）与 import build_data（本目录）都可用
for p in (PROJECT_DIR, WEB_DIR):
    if p not in sys.path:
        sys.path.insert(0, p)


def find_free_port(start=8777, tries=50):
    for p in range(start, start + tries):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(("127.0.0.1", p)) != 0:
                return p
    return start


class Handler(http.server.SimpleHTTPRequestHandler):
    """在静态文件服务基础上，额外提供 POST /api/update 触发数据更新。"""

    def end_headers(self):
        # 本地预览工具无需缓存：所有响应都禁缓存，避免更新后浏览器仍读旧
        # index.html / data.js / app.js，导致看不到新按钮或新数据。
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def do_POST(self):
        if self.path.split("?")[0].rstrip("/") == "/api/update":
            self._handle_update()
        else:
            self.send_error(404, "Not Found")

    def _handle_update(self):
        logs = []

        def log(msg):
            logs.append(str(msg))

        try:
            from update_data import update_all
            results = update_all(log=log)
            # 重建前端用的 data.js（从最新的 Input/*.csv 抽收盘价）
            import importlib
            import build_data
            importlib.reload(build_data)
            build_data.main()

            summary = {}
            for sym, (ok, skipped, n, a, b) in results.items():
                state = ("已最新(跳过)" if skipped
                         else ("已更新" if ok else "失败"))
                summary[sym] = {"state": state, "n": n,
                             "first": a, "last": b}
            payload = {"ok": True, "summary": summary, "logs": logs}
        except Exception as e:  # noqa: BLE001
            payload = {"ok": False, "error": str(e), "logs": logs}

        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)


def main():
    os.chdir(WEB_DIR)
    port = find_free_port()
    handler = partial(Handler, directory=WEB_DIR)
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    url = f"http://127.0.0.1:{port}/index.html"

    # 延迟 0.6s 再开浏览器，确保服务器已就绪
    threading.Timer(0.6, lambda: webbrowser.open(url)).start()

    print("=" * 48)
    print("  SMH 回撤补仓策略回测 · 本地预览已启动")
    print(f"  浏览器地址： {url}")
    print("  关闭本窗口即可停止预览。")
    print("=" * 48)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()