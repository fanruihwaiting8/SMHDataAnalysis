#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
统一数据更新模块 —— 一次性刷新 Input/ 下四个标的的全量历史 CSV。

数据源：
  - QQQ/TQQQ/SMH3/USD：FT markets 历史价格接口（网页方式，分年调用）。
    https://markets.ft.com/data/equities/ajax/get-historical-prices
  - SMH：Nasdaq 官方 api（build_smh_nasdaq.py）。
    FT 数据库只收录欧洲 UCITS 版 SMH（SMH:LSE，2021 起、约 29 量级净值），
    并非美股原生 SMH（NASDAQ，500+ 量级），故 SMH 单独走 Nasdaq 官方接口。
    局限：Nasdaq 官方仅返回近 10 年（约 2016 起），无法追溯到 2000/2007。
  均原生 USD 计价，不做汇率换算。

五标的配置（XID / 成立首日 / 抓取起始年）：
  QQQ  238029     2010-02-11
  TQQQ 22950261   2010-02-11
  SMH  (Nasdaq官方api，非FT)  ~2016-08  美股原生 VanEck Semiconductor ETF
  SMH3 695808495  2021-12-14
  USD  6646165    2007-01-30  （ProShares Ultra Semiconductors，2倍半导体指数）

落盘表头：Date,Open,High,Low,Close,AdjClose,ChangePct,Volume
"""
import csv
import json
import os
import re
import ssl
import time
import urllib.request
from datetime import date, datetime

# SMH 走 Nasdaq 官方接口（FT 无美股原生 SMH），复用其抓取逻辑
from build_smh_nasdaq import fetch as _fetch_smh_nasdaq

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
INPUT_DIR = os.path.join(BASE_DIR, "Input")

# macOS 自带 Python 常缺根证书，抓取网页时跳过校验
SSL_CTX = ssl.create_default_context()
SSL_CTX.check_hostname = False
SSL_CTX.verify_mode = ssl.CERT_NONE

BASE = "https://markets.ft.com/data/equities/ajax/get-historical-prices"
HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                   "AppleWebKit/537.36 (KHTML, like Gecko) "
                   "Chrome/120.0 Safari/537.36"),
    "X-Requested-With": "XMLHttpRequest",
    "Referer": "https://markets.ft.com/data/equities/tearsheet/historical",
}

# 标的配置：symbol -> (XID, 成立首日, 抓取起始年, 输出文件名)
TARGETS = {
    "QQQ":  ("238029",    date(2010, 2, 11), 2010, "QQQ_full_history.csv"),
    "TQQQ": ("22950261",  date(2010, 2, 11), 2010, "TQQQ_full_history.csv"),
    "SMH":  ("__NASDAQ__", date(2016, 8, 3), 2016, "SMH_full_history.csv"),
    "SMH3": ("695808495", date(2021, 12, 14), 2021, "SMH3_full_history.csv"),
    "USD":  ("6646165",   date(2007, 1, 30), 2007, "USD_full_history.csv"),
}

ROW_RE = re.compile(r"<tr>(.*?)</tr>", re.S)
DATE_RE = re.compile(
    r'mod-ui-table__cell--text.*?mod-ui-hide-small-below">([^<]+)</span>', re.S)
TD_RE = re.compile(r"<td>([\d.,]+)</td>")


def _latest_expected_trading_day():
    """今日往前推算的最近一个有效交易日（周末回退到周五）。

    仅按周末（周六/周日）回退，不含节假日；节假日缺一天不影响判定，
    因为本地数据只要 >= 该日即视为已最新。
    """
    d = date.today()
    wd = d.weekday()  # 周一=0 ... 周日=6
    if wd == 5:        # 周六 -> 周五
        d = date.fromordinal(d.toordinal() - 1)
    elif wd == 6:      # 周日 -> 周五
        d = date.fromordinal(d.toordinal() - 2)
    return d


def _csv_last_date(out_name):
    """读取本地 CSV 最后一行数据的日期，无文件/无数据返回 None。"""
    path = os.path.join(INPUT_DIR, out_name)
    if not os.path.exists(path):
        return None
    last = None
    try:
        with open(path, "r", encoding="utf-8") as f:
            r = csv.reader(f)
            next(r, None)  # 跳过表头
            for row in r:
                if row and row[0].strip():
                    last = row[0].strip()
    except Exception:
        return None
    if not last:
        return None
    try:
        return datetime.strptime(last, "%Y-%m-%d").date()
    except ValueError:
        return None


def _year_ranges(start_year: int):
    """生成分年抓取区间，终点为今日。"""
    today = date.today()
    ranges = []
    for y in range(start_year, today.year + 1):
        s = f"{y}/01/01"
        e = (f"{y}/12/31" if y < today.year
             else today.strftime("%Y/%m/%d"))
        ranges.append((s, e))
    return ranges


def _fetch_year(xid, start, end):
    url = f"{BASE}?startDate={start}&endDate={end}&symbol={xid}"
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=30, context=SSL_CTX) as resp:
        raw = resp.read().decode("utf-8", errors="replace")
    data = json.loads(raw)
    frag = data.get("html", "")
    return frag.encode("utf-8").decode("unicode_escape")


def _parse_rows(frag):
    out = []
    for row in ROW_RE.findall(frag):
        dm = DATE_RE.search(row)
        if not dm:
            continue
        try:
            d = datetime.strptime(dm.group(1).strip(), "%A, %B %d, %Y").date()
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


def update_symbol(symbol, log=print, force=False):
    """刷新单个标的 CSV。

    先对比本地 CSV 最新日期与"最近有效交易日"，若已一致则跳过联网。
    返回 (是否成功, 是否跳过, 条数, 首行日期, 末行日期)。
    """
    xid, first_day, start_year, out_name = TARGETS[symbol]

    if not force:
        local_last = _csv_last_date(out_name)
        expected = _latest_expected_trading_day()
        if local_last is not None and local_last >= expected:
            log(f"  [{symbol}] 本地已最新（{local_last} ≥ {expected}），跳过")
            return True, True, 0, local_last.strftime("%Y-%m-%d"), \
                local_last.strftime("%Y-%m-%d")
        log(f"  [{symbol}] 本地={local_last}，目标≥{expected}，需要更新")

    # SMH 走 Nasdaq 官方接口（FT 无美股原生 SMH）
    if xid == "__NASDAQ__":
        try:
            ordered = _fetch_smh_nasdaq()  # [(date,o,h,l,c,vol), ...] 升序
        except Exception as e:
            log(f"  [{symbol}] Nasdaq 抓取失败 {e}，保留原 CSV")
            return False, False, 0, None, None
        ordered = [r for r in ordered if r[0] >= first_day]
        if not ordered:
            log(f"  [{symbol}] Nasdaq 未返回数据，保留原 CSV")
            return False, False, 0, None, None
        out_rows = []
        prev = None
        for d, o, h, l, c, vol in ordered:
            pct = "" if prev in (None, 0) else f"{(c - prev) / prev * 100:.2f}%"
            out_rows.append([
                d.strftime("%Y-%m-%d"),
                f"{o:.4f}", f"{h:.4f}", f"{l:.4f}", f"{c:.4f}", f"{c:.4f}",
                pct, vol,
            ])
            prev = c
        out_path = os.path.join(INPUT_DIR, out_name)
        with open(out_path, "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(["Date", "Open", "High", "Low", "Close",
                        "AdjClose", "ChangePct", "Volume"])
            w.writerows(out_rows)
        log(f"  [{symbol}] Nasdaq {len(out_rows)} 条")
        return True, False, len(out_rows), out_rows[0][0], out_rows[-1][0]

    all_rows = {}
    for start, end in _year_ranges(start_year):
        try:
            rows = _parse_rows(_fetch_year(xid, start, end))
            for r in rows:
                all_rows[r[0]] = r
            log(f"  [{symbol}] {start}~{end}: {len(rows)} 条")
        except Exception as e:
            log(f"  [{symbol}] {start}~{end}: 失败 {e}")
        time.sleep(1.2)

    ordered = sorted(all_rows.values(), key=lambda x: x[0])
    ordered = [r for r in ordered if r[0] >= first_day]
    if not ordered:
        log(f"  [{symbol}] 未解析到任何数据，保留原 CSV")
        return False, False, 0, None, None

    out_rows = []
    prev = None
    for d, o, h, l, c, vol in ordered:
        pct = "" if prev in (None, 0) else f"{(c - prev) / prev * 100:.2f}%"
        out_rows.append([
            d.strftime("%Y-%m-%d"),
            f"{o:.4f}", f"{h:.4f}", f"{l:.4f}", f"{c:.4f}", f"{c:.4f}",
            pct, vol,
        ])
        prev = c

    out_path = os.path.join(INPUT_DIR, out_name)
    with open(out_path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["Date", "Open", "High", "Low", "Close",
                    "AdjClose", "ChangePct", "Volume"])
        w.writerows(out_rows)
    return True, False, len(out_rows), out_rows[0][0], out_rows[-1][0]


def update_all(log=print):
    """依次刷新四个标的 CSV（已最新的自动跳过）。

    返回结果字典 {symbol: (ok, skipped, n, first, last)}。
    """
    os.makedirs(INPUT_DIR, exist_ok=True)
    results = {}
    for sym in TARGETS:
        log(f"检查 {sym} ...")
        results[sym] = update_symbol(sym, log=log)
    return results


if __name__ == "__main__":
    res = update_all()
    print("\n=== 更新完成 ===")
    for sym, (ok, skipped, n, a, b) in res.items():
        if skipped:
            state = "已最新(跳过)"
        elif ok:
            state = "已更新"
        else:
            state = "失败"
        print(f"{sym}: {state} {n} 条 {a}~{b}")