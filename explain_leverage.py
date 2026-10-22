#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""解释：为何 2010-2026 这段 TQQQ(3x) 长期收益远超 QQQ(1x)。

关键在于——波动损耗(volatility decay)确实存在且被放大，但当标的
"长期单边上涨、且涨幅足够覆盖损耗"时，3 倍日收益复利仍会碾压 1 倍。
本脚本用真实数据量化：年化收益、年化波动、最大回撤、单日最惨跌幅、
以及"若换一段不同市况会怎样"。
"""
import csv
import math


def load(path):
    d, c = [], []
    with open(path, encoding="utf-8") as f:
        for r in csv.DictReader(f):
            dt, cl = (r.get("Date") or "").strip(), (r.get("Close") or "").strip()
            if dt and cl:
                d.append(dt); c.append(float(cl))
    return d, c


def stats(dates, closes, name):
    n = len(closes)
    yrs = (int(dates[-1][:4]) - int(dates[0][:4])) + \
        (int(dates[-1][5:7]) - int(dates[0][5:7])) / 12.0
    total_mult = closes[-1] / closes[0]
    cagr = total_mult ** (1 / yrs) - 1
    rets = [closes[i] / closes[i - 1] - 1 for i in range(1, n)]
    mean = sum(rets) / len(rets)
    var = sum((x - mean) ** 2 for x in rets) / len(rets)
    ann_vol = math.sqrt(var) * math.sqrt(252)
    # 最大回撤
    peak, maxdd = closes[0], 0.0
    for p in closes:
        peak = max(peak, p)
        maxdd = min(maxdd, p / peak - 1)
    worst_day = min(rets)
    print(f"\n【{name}】{dates[0]} ~ {dates[-1]}  约 {yrs:.1f} 年")
    print(f"  总涨幅      : ×{total_mult:,.1f}")
    print(f"  年化收益CAGR: {cagr*100:6.1f}%")
    print(f"  年化波动    : {ann_vol*100:6.1f}%")
    print(f"  最大回撤    : {maxdd*100:6.1f}%")
    print(f"  单日最惨跌幅: {worst_day*100:6.1f}%")
    return {"cagr": cagr, "vol": ann_vol, "maxdd": maxdd}


def slice_range(dates, closes, start, end):
    idx = [i for i, d in enumerate(dates) if start <= d <= end]
    return [dates[i] for i in idx], [closes[i] for i in idx]


qd, qc = load("Input/QQQ_full_history.csv")
td, tc = load("Input/TQQQ_full_history.csv")

print("=" * 56)
print("全区间 2010-2026（史上最强科技牛）")
print("=" * 56)
stats(qd, qc, "QQQ 1x")
stats(td, tc, "TQQQ 3x")

# 对照：若市况不同——2021 高点买入到 2022 熊市底部，看损耗如何吃掉杠杆
print("\n" + "=" * 56)
print("反例：2021-11 高点 -> 2022-12 熊市，杠杆损耗被放大")
print("=" * 56)
qd2, qc2 = slice_range(qd, qc, "2021-11-19", "2022-12-28")
td2, tc2 = slice_range(td, tc, "2021-11-19", "2022-12-28")
stats(qd2, qc2, "QQQ 1x（这一段）")
stats(td2, tc2, "TQQQ 3x（这一段）")