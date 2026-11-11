#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
统一数据更新模块 —— 一次性刷新 Input/ 下各标的的「尽可能早」的全量历史 CSV。

数据源：
  - QQQ/TQQQ/SOXL/USD/SOXX：FT markets 历史价格接口（网页方式，分年调用）。
    https://markets.ft.com/data/equities/ajax/get-historical-prices
  - SMH：FT 数据库没有美股原生 SMH（只有 2021 起的欧洲 UCITS 版 SMH:LSE），
    因此真实段走美股行情接口，且只能取到近若干年：
      · 首选 stockanalysis.com（fetch_smh_sa.py，近 5 年，现为主用源）；
      · 次选 Nasdaq 官方 api（build_smh_nasdaq.py，近 10 年，约 2016 起，
        2026-11 起对本机/云端返回 403，仅作兜底）。
    远端抓到的真实段会与本地已有真实段按日期合并（远端覆盖同日），
    两源都失败时仅用本地，保证数据不倒退。
    由于真实段起点有限，SMH 采用「真实段 + 代理回填段」拼接：
      · 2016-08-03 至今 = 真实 SMH；
      · 之前            = SOXX（iShares Semiconductor ETF，2001-07-13 起）按
        衔接日收盘价比例缩放后回填，收益率序列即 SOXX 本身。
    SOXX 与 SMH 同为费城半导体指数系 ETF，近 10 年重合期日收益相关系数
    0.9875，回调事件逐一对应，可作长周期代理。原始未缩放的 SOXX 另存
    Input/SOXX_full_history.csv 留档。
  均原生 USD 计价，不做汇率换算。

标的配置（XID / 实际最早可得日 / 抓取起始年，均经 FT 实测）：
  QQQ  238029      1999-03-10  （Invesco QQQ Trust，纳指 1 倍）
  TQQQ 22950261    2010-02-11  （纳指 3 倍）
  SOXX 164751      2001-07-13  （iShares Semiconductor ETF，半导体 1 倍）
  SMH  SA+SOXX     2001-07-13  （拼接：2016-08-03 前为 SOXX 缩放回填）
  SOXL 23333004    2010-03-11  （半导体 3 倍）
  USD  6646165     2007-02-01  （ProShares Ultra Semiconductors，半导体 2 倍）
  CSI300 26672304  2005-01-04  （沪深300 指数 000300:CSI，CNY 点位，仅作对比基准）
  ETF588000 998195844 2020-11-16（华夏上证科创板50 ETF 588000:SHH，中国科技，仅作对比基准）
  ETF588170 978111186 2025-04-08（华夏科创半导体材料设备 ETF 588170:SHH，中国半导体，仅作对比基准）

落盘表头：Date,Open,High,Low,Close,AdjClose,ChangePct,Volume
"""
import csv
import json
import os
import re
import ssl
import time
import urllib.request
from datetime import date, datetime, timedelta

# SMH 真实段数据源：
#   首选 stockanalysis.com（fetch_smh_sa，近 5 年，接口稳定）
#   次选 Nasdaq 官方（build_smh_nasdaq，2026-11 起对本机/云端返回 403）
from build_smh_nasdaq import fetch as _fetch_smh_nasdaq
from fetch_smh_sa import fetch as _fetch_smh_sa
from fetch_smh_sa import us_last_closed_day as _us_last_closed_day

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

# 标的配置：symbol -> (XID, 最早可得日, 抓取起始年, 输出文件名)
# 注意顺序：SOXX 必须排在 SMH 之前，SMH 的长历史要用刚落盘的 SOXX 回填。
TARGETS = {
    "QQQ":  ("238029",    date(1999, 3, 10), 1999, "QQQ_full_history.csv"),
    "TQQQ": ("22950261",  date(2010, 2, 11), 2010, "TQQQ_full_history.csv"),
    "SOXX": ("164751",    date(2001, 7, 13), 2001, "SOXX_full_history.csv"),
    "SMH":  ("__SPLICE__", date(2001, 7, 13), 2001, "SMH_full_history.csv"),
    "SOXL": ("23333004",  date(2010, 3, 11), 2010, "SOXL_full_history.csv"),
    "USD":  ("6646165",   date(2007, 1, 30), 2007, "USD_full_history.csv"),
    # 对比用基准指数/ETF（CNY 计价，仅用于净值曲线对比，不参与策略交易）
    "CSI300": ("26672304", date(2005, 1, 4), 2005, "CSI300_full_history.csv"),
    # 中国科技：华夏上证科创板50 ETF（上市首日 2020-11-16）
    "ETF588000": ("998195844", date(2020, 11, 16), 2020,
                  "ETF588000_full_history.csv"),
    # 中国半导体：华夏科创半导体材料设备 ETF（上市首日 2025-04-08）
    "ETF588170": ("978111186", date(2025, 4, 8), 2025,
                  "ETF588170_full_history.csv"),
}

# SMH 真实段（Nasdaq 官方）之前，用 SOXX 缩放回填
PROXY_FOR_SMH = "SOXX_full_history.csv"
# SMH 真实段起点：Nasdaq 官方只给近 10 年，早于此日的一律视为代理回填段
SMH_REAL_FROM = date(2016, 8, 3)

ROW_RE = re.compile(r"<tr>(.*?)</tr>", re.S)
DATE_RE = re.compile(
    r'mod-ui-table__cell--text.*?mod-ui-hide-small-below">([^<]+)</span>', re.S)
TD_RE = re.compile(r"<td>([\d.,]+)</td>")


CN_SYMBOLS = ("CSI300", "ETF588000", "ETF588170")


def _cn_last_closed_day():
    """A 股最近一个已收盘交易日（北京时间 15:30 前算前一日，周末回退周五）。"""
    try:
        from zoneinfo import ZoneInfo
        now = datetime.now(ZoneInfo("Asia/Shanghai"))
    except Exception:
        now = datetime.now()
    d = now.date()
    if now.hour * 60 + now.minute < 15 * 60 + 30:
        d = date.fromordinal(d.toordinal() - 1)
    while d.weekday() >= 5:   # 周六/周日回退
        d = date.fromordinal(d.toordinal() - 1)
    return d


def _latest_expected_trading_day(symbol=None):
    """该标的最近一个「应当已有收盘数据」的交易日。

    分市场判定，避免当日尚未收盘时被误判为"需要更新"而每次全量重抓：
      · 美股标的（默认）：美东 16:05 之后才认为当日已收盘；
      · A 股标的（CSI300/ETF588000/ETF588170）：北京时间 15:30 之后。
    仅按周末回退，不含节假日；节假日缺一天不影响判定，
    因为本地数据只要 >= 该日即视为已最新。
    """
    if symbol in CN_SYMBOLS:
        return _cn_last_closed_day()
    try:
        return _us_last_closed_day()
    except Exception:
        d = date.today()
        while d.weekday() >= 5:
            d = date.fromordinal(d.toordinal() - 1)
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


def _csv_first_date(out_name):
    """读取本地 CSV 第一行数据的日期，无文件/无数据返回 None。"""
    path = os.path.join(INPUT_DIR, out_name)
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            r = csv.reader(f)
            next(r, None)  # 跳过表头
            for row in r:
                if row and row[0].strip():
                    return datetime.strptime(row[0].strip(), "%Y-%m-%d").date()
    except (OSError, ValueError):
        return None
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


def _read_csv_rows(out_name):
    """读取 Input/ 下已落盘 CSV，返回 [(date,o,h,l,c,vol), ...] 升序。"""
    path = os.path.join(INPUT_DIR, out_name)
    rows = []
    if not os.path.exists(path):
        return rows
    with open(path, "r", encoding="utf-8") as f:
        r = csv.reader(f)
        next(r, None)  # 跳过表头
        for line in r:
            if len(line) < 5 or not line[0].strip():
                continue
            try:
                d = datetime.strptime(line[0].strip(), "%Y-%m-%d").date()
                o, h, l, c = (float(x) for x in line[1:5])
                vol = int(float(line[7])) if len(line) > 7 and line[7] else 0
            except (ValueError, IndexError):
                continue
            rows.append((d, o, h, l, c, vol))
    rows.sort(key=lambda x: x[0])
    return rows


def _write_csv(out_name, ordered):
    """把 [(date,o,h,l,c,vol)] 升序序列写成标准 8 列 CSV，返回落盘行。"""
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
    return out_rows


def _build_smh_series(log=print):
    """构建 SMH 全量序列：Nasdaq 真实段 + SOXX 按比例缩放回填段。

    缩放系数 k = 真实段首日 SMH 收盘 / 同日 SOXX 收盘，
    回填段整体 ×k，使衔接处价格连续、收益率序列保持 SOXX 原样。
    """
    # 1) 真实段：本地已落盘真实段为底，再用远端抓取结果覆盖/续写同日数据。
    #    远端优先 stockanalysis（近 5 年，Nasdaq 官方 api 已对本机/云端 403），
    #    再退回 Nasdaq 官方；两者都失败时仅用本地，保证不会倒退。
    merged = {r[0]: r for r in _read_csv_rows("SMH_full_history.csv")
              if r[0] >= SMH_REAL_FROM}
    log(f"  [SMH] 本地真实段 {len(merged)} 条"
        f"（末日 {max(merged) if merged else '-'}）")

    fetched = []
    try:
        fetched = [r for r in _fetch_smh_sa() if r[0] >= SMH_REAL_FROM]
        log(f"  [SMH] stockanalysis 抓取 {len(fetched)} 条"
            f"（末日 {fetched[-1][0] if fetched else '-'}）")
    except Exception as e:
        log(f"  [SMH] stockanalysis 抓取失败 {e}")
    if not fetched:
        try:
            fetched = [r for r in _fetch_smh_nasdaq() if r[0] >= SMH_REAL_FROM]
            log(f"  [SMH] Nasdaq 抓取 {len(fetched)} 条")
        except Exception as e:
            log(f"  [SMH] Nasdaq 抓取失败 {e}，仅用本地真实段")

    for r in fetched:
        merged[r[0]] = r
    real = sorted(merged.values(), key=lambda x: x[0])
    if not real:
        return []
    log(f"  [SMH] 真实段合并后 {len(real)} 条（{real[0][0]} ~ {real[-1][0]}）")

    # 2) 代理段：SOXX
    prox = _read_csv_rows(PROXY_FOR_SMH)
    if not prox:
        log("  [SMH] 无 SOXX 留档，仅保留真实段")
        return real

    anchor = real[0][0]
    prox_map = {r[0]: r for r in prox}
    anchor_row = prox_map.get(anchor)
    if anchor_row is None:
        earlier = [r for r in prox if r[0] <= anchor]
        anchor_row = earlier[-1] if earlier else None
    if anchor_row is None or anchor_row[4] <= 0:
        log("  [SMH] 代理段无法对齐衔接日，仅保留真实段")
        return real

    k = real[0][4] / anchor_row[4]
    back = [(d, o * k, h * k, l * k, c * k, vol)
            for d, o, h, l, c, vol in prox if d < anchor]
    log(f"  [SMH] SOXX 回填 {len(back)} 条（{back[0][0] if back else '-'} ~ "
        f"{anchor}，缩放系数 k={k:.4f}）")
    return back + real


def update_symbol(symbol, log=print, force=False):
    """刷新单个标的 CSV。

    先对比本地 CSV 最新日期与"最近有效交易日"，若已一致则跳过联网。
    返回 (是否成功, 是否跳过, 条数, 首行日期, 末行日期)。
    """
    xid, first_day, start_year, out_name = TARGETS[symbol]

    if not force:
        local_last = _csv_last_date(out_name)
        local_first = _csv_first_date(out_name)
        expected = _latest_expected_trading_day(symbol)
        # 既要末端最新，也要起点已回溯到该标的最早可得日（容忍 10 天误差）
        back_ok = (local_first is not None
                   and local_first <= first_day + timedelta(days=10))
        if local_last is not None and local_last >= expected and back_ok:
            log(f"  [{symbol}] 本地已最新（{local_first} ~ {local_last}），跳过")
            return True, True, 0, local_first.strftime("%Y-%m-%d"), \
                local_last.strftime("%Y-%m-%d")
        if not back_ok:
            log(f"  [{symbol}] 本地起点={local_first}，需回溯至 {first_day}")
        else:
            log(f"  [{symbol}] 本地={local_last}，目标≥{expected}，需要更新")

    # SMH = Nasdaq 官方真实段 + SOXX 缩放回填段
    if xid == "__SPLICE__":
        ordered = _build_smh_series(log)
        if not ordered:
            log(f"  [{symbol}] 未能构建拼接序列，保留原 CSV")
            return False, False, 0, None, None
        out_rows = _write_csv(out_name, ordered)
        log(f"  [{symbol}] 拼接完成 {len(out_rows)} 条 "
            f"{out_rows[0][0]} ~ {out_rows[-1][0]}")
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

    out_rows = _write_csv(out_name, ordered)
    return True, False, len(out_rows), out_rows[0][0], out_rows[-1][0]


def update_all(log=print, force=False):
    """依次刷新全部标的 CSV（已最新且起点已回溯到位的自动跳过）。

    返回结果字典 {symbol: (ok, skipped, n, first, last)}。
    """
    os.makedirs(INPUT_DIR, exist_ok=True)
    results = {}
    for sym in TARGETS:
        log(f"检查 {sym} ...")
        results[sym] = update_symbol(sym, log=log, force=force)
    return results


if __name__ == "__main__":
    import sys
    res = update_all(force="--force" in sys.argv)
    print("\n=== 更新完成 ===")
    for sym, (ok, skipped, n, a, b) in res.items():
        if skipped:
            state = "已最新(跳过)"
        elif ok:
            state = "已更新"
        else:
            state = "失败"
        print(f"{sym}: {state} {n} 条 {a}~{b}")