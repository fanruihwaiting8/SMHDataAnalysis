#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
构建 SMH (VanEck Semiconductor UCITS ETF, 非杠杆) 全量历史行情。

与杠杆端 SOXL (3x 杠杆) 采用相同的存储格式。
数据源：FT markets 历史价格接口（网页方式）。
  https://markets.ft.com/data/equities/ajax/get-historical-prices
  一次限一年，需分年调用。SMH:LSE 原生 USD 计价，无需汇率换算。

处理：
  1. 分年抓取 2021-12-01 至今；
  2. 解析 HTML 表格 -> 日期 + OHLC + Volume；
  3. 按日期升序排序、去重；
  4. 计算 ChangePct = (Close - 前一日Close) / 前一日Close × 100%；
  5. 落盘 SMH_full_history.csv。
     表头：Date,Open,High,Low,Close,AdjClose,ChangePct,Volume
"""
import csv
import json
import os
import re
import ssl
import time
import urllib.request
from datetime import datetime

# macOS 自带 Python 常缺根证书，抓取网页时跳过校验
SSL_CTX = ssl.create_default_context()
SSL_CTX.check_hostname = False
SSL_CTX.verify_mode = ssl.CERT_NONE

XID = "632298522"                 # FT 内部标识符 (SMH:LSE, VanEck Semiconductor UCITS ETF)
BASE = "https://markets.ft.com/data/equities/ajax/get-historical-prices"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                   "..", "..", "..", "Input", "SMH_full_history.csv")

# 分年区间
YEAR_RANGES = [
    ("2021/12/01", "2022/11/30"),
    ("2022/12/01", "2023/11/30"),
    ("2023/12/01", "2024/11/30"),
    ("2024/12/01", "2025/11/30"),
    ("2025/12/01", "2026/08/02"),
]

HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                   "AppleWebKit/537.36 (KHTML, like Gecko) "
                   "Chrome/120.0 Safari/537.36"),
    "X-Requested-With": "XMLHttpRequest",
    "Referer": "https://markets.ft.com/data/equities/tearsheet/historical",
}


def fetch_year(start, end):
    """请求单个年份区间，返回解析后的 HTML 片段字符串。"""
    url = f"{BASE}?startDate={start}&endDate={end}&symbol={XID}"
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=30, context=SSL_CTX) as resp:
        raw = resp.read().decode("utf-8", errors="replace")
    data = json.loads(raw)
    frag = data.get("html", "")
    frag = frag.encode("utf-8").decode("unicode_escape")
    return frag


ROW_RE = re.compile(r"<tr>(.*?)</tr>", re.S)
DATE_RE = re.compile(
    r'mod-ui-table__cell--text.*?mod-ui-hide-small-below">([^<]+)</span>', re.S)
TD_RE = re.compile(r"<td>([\d.,]+)</td>")


def parse_rows(frag):
    """解析 HTML 片段，返回 [(date_obj, o, h, l, c, volume), ...]（USD）。"""
    out = []
    for row in ROW_RE.findall(frag):
        dm = DATE_RE.search(row)
        if not dm:
            continue
        date_str = dm.group(1).strip()
        try:
            d = datetime.strptime(date_str, "%A, %B %d, %Y").date()
        except ValueError:
            continue
        nums = TD_RE.findall(row)
        if len(nums) < 4:
            continue
        o, h, l, c = (float(x.replace(",", "")) for x in nums[:4])
        vm = re.findall(
            r'<td><span class="mod-ui-hide-small-below">([\d,]+)</span>', row)
        vol = int(vm[0].replace(",", "")) if vm else 0
        out.append((d, o, h, l, c, vol))
    return out


def main():
    all_rows = {}
    for start, end in YEAR_RANGES:
        print(f"抓取 {start} → {end} ...")
        try:
            frag = fetch_year(start, end)
            rows = parse_rows(frag)
            print(f"  解析到 {len(rows)} 条")
            for r in rows:
                all_rows[r[0]] = r
        except Exception as e:
            print(f"  失败: {e}")
        time.sleep(1.5)

    ordered = sorted(all_rows.values(), key=lambda x: x[0])
    # 旧版起点（LSE 上市 SMH 首日 2021-12-10）；现主流程由 update_data.py 抓 Nasdaq
    start_day = datetime(2021, 12, 10).date()
    ordered = [r for r in ordered if r[0] >= start_day]

    out_rows = []
    prev_close = None
    for d, o, h, l, c, vol in ordered:
        if prev_close is None or prev_close == 0:
            pct = ""
        else:
            pct = f"{(c - prev_close) / prev_close * 100:.2f}%"
        out_rows.append([
            d.strftime("%Y-%m-%d"),
            f"{o:.4f}", f"{h:.4f}", f"{l:.4f}", f"{c:.4f}",
            f"{c:.4f}",   # AdjClose = Close（FT 无复权价）
            pct, vol,
        ])
        prev_close = c

    if not out_rows:
        print("\n警告：未解析到任何数据，跳过写文件（保留原 CSV）。")
        return

    with open(OUT, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["Date", "Open", "High", "Low", "Close",
                    "AdjClose", "ChangePct", "Volume"])
        w.writerows(out_rows)

    print(f"\n完成：共 {len(out_rows)} 条 -> {OUT}")
    if out_rows:
        print("首行:", out_rows[0])
        print("末行:", out_rows[-1])


if __name__ == "__main__":
    main()