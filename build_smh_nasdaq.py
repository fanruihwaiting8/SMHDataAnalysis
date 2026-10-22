#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
构建美股原生 SMH (VanEck Semiconductor ETF, NASDAQ) 历史行情。

数据源：Nasdaq 官方 api（真美股原生 SMH，价格 500+ 量级）
  https://api.nasdaq.com/api/quote/SMH/historical?assetclass=etf&fromdate=...&todate=...&limit=99999
  返回 JSON：data.tradesTable.rows[{date(MM/DD/YYYY),open,high,low,close,volume}]

局限：Nasdaq 官方接口硬性只返回近 10 年（约 2016 起），
  无法追溯到 2000/2007。若需更早，须改用 Yahoo(build_smh_yahoo.py)。

处理：
  1. 拉近 10 年日线；
  2. 日期 MM/DD/YYYY -> YYYY-MM-DD，价格去逗号；
  3. AdjClose 用 Close 兜底（Nasdaq 不单列 adjclose，近 10 年 SMH 无拆股）；
  4. ChangePct = (Close - 前一日Close)/前一日Close × 100%；
  5. 落盘 Input/SMH_full_history.csv，
     表头：Date,Open,High,Low,Close,AdjClose,ChangePct,Volume
"""
import csv
import json
import os
import ssl
import urllib.request
from datetime import date, datetime

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(BASE_DIR, "Input", "SMH_full_history.csv")

SSL_CTX = ssl.create_default_context()
SSL_CTX.check_hostname = False
SSL_CTX.verify_mode = ssl.CERT_NONE

SYMBOL = "SMH"
URL = ("https://api.nasdaq.com/api/quote/{sym}/historical"
       "?assetclass=etf&fromdate={f}&todate={t}&limit=99999")
HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                   "AppleWebKit/537.36 (KHTML, like Gecko) "
                   "Chrome/120.0 Safari/537.36"),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.nasdaq.com/",
    "Origin": "https://www.nasdaq.com",
}


def _num(s):
    return float(str(s).replace(",", "").replace("$", "").strip())


def fetch():
    """拉取 Nasdaq 官方历史行情，返回 (date, o, h, l, c, vol) 升序列表。"""
    f = "2000-01-01"
    t = date.today().strftime("%Y-%m-%d")
    url = URL.format(sym=SYMBOL, f=f, t=t)
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=30, context=SSL_CTX) as resp:
        raw = resp.read().decode("utf-8", errors="replace")
    data = json.loads(raw)
    rows_in = (data.get("data") or {}).get("tradesTable", {}).get("rows") or []
    if not rows_in:
        raise RuntimeError("Nasdaq 返回空数据，原始前 300 字：\n" + raw[:300])

    rows = []
    for r in rows_in:
        try:
            d = datetime.strptime(r["date"].strip(), "%m/%d/%Y").date()
            o = _num(r["open"])
            h = _num(r["high"])
            l = _num(r["low"])
            c = _num(r["close"])
            v = int(_num(r.get("volume") or 0))
        except (KeyError, ValueError):
            continue
        rows.append((d, o, h, l, c, v))

    # 去重 + 升序
    dedup = {r[0]: r for r in rows}
    return sorted(dedup.values(), key=lambda x: x[0])


def main():
    print("抓取美股 SMH (NASDAQ) 历史 via Nasdaq 官方 api ...")
    rows = fetch()
    print(f"  解析到 {len(rows)} 条（{rows[0][0]} ~ {rows[-1][0]}）")

    out_rows = []
    prev_close = None
    for d, o, h, l, c, v in rows:
        pct = "" if (prev_close in (None, 0)) else \
            f"{(c - prev_close) / prev_close * 100:.2f}%"
        out_rows.append([
            d.strftime("%Y-%m-%d"),
            f"{o:.4f}", f"{h:.4f}", f"{l:.4f}", f"{c:.4f}",
            f"{c:.4f}", pct, v,
        ])
        prev_close = c

    if not out_rows:
        print("\n警告：未解析到任何数据，保留原 CSV。")
        return

    with open(OUT, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["Date", "Open", "High", "Low", "Close",
                    "AdjClose", "ChangePct", "Volume"])
        w.writerows(out_rows)

    print(f"\n完成：共 {len(out_rows)} 条 -> {OUT}")
    print("首行:", out_rows[0])
    print("末行:", out_rows[-1])


if __name__ == "__main__":
    main()