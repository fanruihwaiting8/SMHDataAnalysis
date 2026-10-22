#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
构建美股原生 SMH (VanEck Semiconductor ETF, NASDAQ) 全量历史行情。

背景：
  FT markets 接口只收录欧洲 UCITS 版 SMH（SMH:LSE，2020 后才有），
  无法追溯到美股原生 SMH 的早期数据。美股 SMH 于 2000-06 在 NASDAQ 上市，
  故改用 Yahoo Finance chart 接口抓取其完整历史。

数据源：Yahoo Finance chart 接口
  https://query1.finance.yahoo.com/v8/finance/chart/SMH
  返回 JSON，含 timestamp / open / high / low / close /（adjclose）。
  原生 USD 计价，无需汇率换算。

处理：
  1. 一次性拉取 2000-01-01 至今；
  2. 解析 timestamp + OHLC + Volume + AdjClose；
  3. 按日期升序、去重；
  4. ChangePct = (Close - 前一日Close) / 前一日Close × 100%；
  5. 落盘 Input/SMH_full_history.csv，
     表头：Date,Open,High,Low,Close,AdjClose,ChangePct,Volume
"""
import csv
import json
import os
import ssl
import time
import urllib.request
from datetime import date, datetime, timezone

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(BASE_DIR, "Input", "SMH_full_history.csv")

# macOS 自带 Python 常缺根证书，抓取网页时跳过校验
SSL_CTX = ssl.create_default_context()
SSL_CTX.check_hostname = False
SSL_CTX.verify_mode = ssl.CERT_NONE

SYMBOL = "SMH"
# query1 常被限流，query2 作为备用主机轮询
HOSTS = [
    "https://query2.finance.yahoo.com/v8/finance/chart/",
    "https://query1.finance.yahoo.com/v8/finance/chart/",
]
HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                   "AppleWebKit/537.36 (KHTML, like Gecko) "
                   "Chrome/120.0 Safari/537.36"),
    "Accept": "application/json,text/plain,*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://finance.yahoo.com/quote/SMH/history",
}


def _get(url):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=30, context=SSL_CTX) as resp:
        return resp.read().decode("utf-8", errors="replace")


def fetch():
    """拉取 2000-01-01 至今的日线，返回解析后的行列表。"""
    p1 = 946684800  # 2000-01-01 UTC
    p2 = int(datetime.now(timezone.utc).timestamp())
    qs = f"{SYMBOL}?period1={p1}&period2={p2}&interval=1d&events=div%2Csplit"

    raw = None
    last_err = None
    # 主机轮询 + 429 退避重试
    for attempt in range(6):
        host = HOSTS[attempt % len(HOSTS)]
        try:
            raw = _get(host + qs)
            break
        except urllib.error.HTTPError as e:
            last_err = e
            if e.code == 429:
                wait = 3 * (attempt + 1)
                print(f"  429 限流，{wait}s 后换主机重试 ...")
                time.sleep(wait)
                continue
            raise
    if raw is None:
        raise last_err

    data = json.loads(raw)
    res = data["chart"]["result"][0]
    ts = res["timestamp"]
    q = res["indicators"]["quote"][0]
    adj = None
    if "adjclose" in res["indicators"]:
        adj = res["indicators"]["adjclose"][0]["adjclose"]

    rows = []
    for i, t in enumerate(ts):
        o, h, l, c = q["open"][i], q["high"][i], q["low"][i], q["close"][i]
        v = q["volume"][i]
        if None in (o, h, l, c):
            continue  # 停牌 / 缺失日跳过
        d = datetime.fromtimestamp(t, tz=timezone.utc).date()
        ac = adj[i] if adj and adj[i] is not None else c
        rows.append((d, float(o), float(h), float(l), float(c),
                     float(ac), int(v or 0)))
    return rows


def main():
    print(f"抓取美股 SMH (NASDAQ) 全量历史 via Yahoo Finance ...")
    rows = fetch()
    print(f"  解析到 {len(rows)} 条")

    # 去重（按日期）+ 升序
    dedup = {}
    for r in rows:
        dedup[r[0]] = r
    ordered = sorted(dedup.values(), key=lambda x: x[0])

    out_rows = []
    prev_close = None
    for d, o, h, l, c, ac, vol in ordered:
        if prev_close is None or prev_close == 0:
            pct = ""
        else:
            pct = f"{(c - prev_close) / prev_close * 100:.2f}%"
        out_rows.append([
            d.strftime("%Y-%m-%d"),
            f"{o:.4f}", f"{h:.4f}", f"{l:.4f}", f"{c:.4f}",
            f"{ac:.4f}", pct, vol,
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
    print("首行:", out_rows[0])
    print("末行:", out_rows[-1])


if __name__ == "__main__":
    main()