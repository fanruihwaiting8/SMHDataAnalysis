#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
构建 SMH3 (Leverage Shares 3x Long Semiconductors ETP) 全量历史行情。

数据源：FT markets 历史价格接口（网页方式，非官方 API SDK）。
  https://markets.ft.com/data/equities/ajax/get-historical-prices
  一次限一年，需分年调用。返回 GBP 计价的 HTML 表格。

处理：
  1. 分年抓取 2021-12-01 至今；
  2. 解析 HTML 表格 -> 日期 + OHLC + Volume；
  3. FT 返回的价格即为正确量级（≈官方美元价），直接采用，不做汇率换算；
  4. 按日期升序排序、去重；
  5. 计算 ChangePct = (Close - 前一日Close) / 前一日Close × 100%；
  6. 落盘 SMH3_full_history.csv。
     表头：Date,Open,High,Low,Close,AdjClose,ChangePct,Volume

注意：历史上曾误将原始价再乘 GBP_USD=1.3475，导致价格整体放大约 1.35 倍
      （如 2026-06-03 变成 47.57 而非官方 ~35.18）。现已移除该换算。
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

XID = "695808495"                 # FT 内部标识符 (SMH3:LSE)
BASE = "https://markets.ft.com/data/equities/ajax/get-historical-prices"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                   "..", "..", "..", "Input", "SMH3_full_history.csv")

# 分年区间（起点为成立首日所在月，终点为今日）
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
    # 反转义 \u003c 等
    frag = frag.encode("utf-8").decode("unicode_escape")
    return frag


# 行分割：每个 <tr>...</tr> 是一条记录
ROW_RE = re.compile(r"<tr>(.*?)</tr>", re.S)
# 日期在第一个带 mod-ui-hide-small-below 的 span（完整格式：Wednesday, November 30, 2022）
DATE_RE = re.compile(
    r'mod-ui-table__cell--text.*?mod-ui-hide-small-below">([^<]+)</span>', re.S)
# 4 个纯数字 td = OHLC
TD_RE = re.compile(r"<td>([\d.,]+)</td>")


def parse_rows(frag):
    """解析 HTML 片段，返回 [(date_obj, o, h, l, c, volume), ...]（GBP）。"""
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
        # 提取纯数字 td（OHLC 是前 4 个 <td>数字</td>）
        nums = TD_RE.findall(row)
        if len(nums) < 4:
            continue
        o, h, l, c = (float(x.replace(",", "")) for x in nums[:4])
        # 成交量在带 mod-ui-hide-small-below 的第二个 span（数字，可能含逗号）
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
                all_rows[r[0]] = r      # 以日期去重
        except Exception as e:
            print(f"  失败: {e}")
        time.sleep(1.5)

    # 升序排序
    ordered = sorted(all_rows.values(), key=lambda x: x[0])
    # 过滤成立首日之前（2021-12-10）
    start_day = datetime(2021, 12, 10).date()
    ordered = [r for r in ordered if r[0] >= start_day]

    # 价格直接采用 FT 原始值（已是正确量级），计算 ChangePct
    out_rows = []
    prev_close = None
    for d, o, h, l, c, vol in ordered:
        oU = round(o, 4)
        hU = round(h, 4)
        lU = round(l, 4)
        cU = round(c, 4)
        if prev_close is None or prev_close == 0:
            pct = ""
        else:
            pct = f"{(cU - prev_close) / prev_close * 100:.2f}%"
        out_rows.append([
            d.strftime("%Y-%m-%d"),
            f"{oU:.4f}", f"{hU:.4f}", f"{lU:.4f}", f"{cU:.4f}",
            f"{cU:.4f}",   # AdjClose = Close（FT 无复权价）
            pct, vol,
        ])
        prev_close = cU

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