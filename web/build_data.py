#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把 Input/ 下 5 个 CSV 的 (Date, Close) 抽取出来，生成纯前端用的 data.js。

前端回测只需要每日收盘价，所以这里只保留 Date -> Close，
以「日期升序数组 + 收盘价数组」形式存储，体积最小、加载最快。
生成结果写入 web/data.js，浏览器直接 <script> 引入即可（无需服务器）。
"""
import os
import csv
import json

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INPUT_DIR = os.path.join(BASE_DIR, "Input")
OUT_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data.js")

# key -> csv 文件名
FILES = {
    "SMH": "SMH_full_history.csv",
    "SOXL": "SOXL_full_history.csv",
    "QQQ": "QQQ_full_history.csv",
    "TQQQ": "TQQQ_full_history.csv",
    "USD": "USD_full_history.csv",
}


def load_series(path):
    dates, closes = [], []
    with open(path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        rows = []
        for r in reader:
            d = (r.get("Date") or "").strip()
            c = (r.get("Close") or "").strip()
            if not d or not c:
                continue
            try:
                rows.append((d, round(float(c), 4)))
            except ValueError:
                continue
    rows.sort(key=lambda x: x[0])
    for d, c in rows:
        dates.append(d)
        closes.append(c)
    return {"dates": dates, "closes": closes}


def main():
    data = {}
    for key, fname in FILES.items():
        path = os.path.join(INPUT_DIR, fname)
        if not os.path.exists(path):
            print(f"跳过缺失文件: {fname}")
            continue
        data[key] = load_series(path)
        print(f"{key}: {len(data[key]['dates'])} 条 "
              f"({data[key]['dates'][0]} ~ {data[key]['dates'][-1]})")

    with open(OUT_FILE, "w", encoding="utf-8") as f:
        f.write("// 自动生成，勿手改。由 build_data.py 从 Input/*.csv 抽取收盘价而来。\n")
        f.write("window.PRICE_DATA = ")
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    size_kb = os.path.getsize(OUT_FILE) / 1024
    print(f"已写入 {OUT_FILE} ({size_kb:.1f} KB)")


if __name__ == "__main__":
    main()