#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
在固定补仓策略下，网格搜索最优减仓比例，使截止今天总资金最大。

固定补仓（drawdowns）：回撤-15%不操作、-25%补20%、-35%补100%（-45/-50%不操作）。
待优化减仓（rebounds）：SMH反弹 +50%/+100%/+200% 各卖出当时 SMH3 市值的百分比。

减仓仅 3 档，组合可控，直接用步长 1% 全网格搜索（101^3≈103万，内联版秒级）。
"""
import itertools
import backtest as bt

SMH_CSV = "Input/SMH_full_history.csv"
SMH3_CSV = "Input/SMH3_full_history.csv"
SMH_CAP = 20000.0
SMH3_CAP = 20000.0
DRAWDOWNS = {15: 0, 25: 20, 35: 100, 45: 0, 50: 0}   # 固定补仓
DD_LEVELS = [15, 25, 35, 45, 50]
RB_LEVELS = [50, 100, 200]
RESET_LEVELS = [lv for lv in DD_LEVELS if lv >= 25]

_smh = bt._load_close_series(SMH_CSV)
_smh3 = bt._load_close_series(SMH3_CSV)
COMMON = sorted(set(_smh) & set(_smh3))
SMH_P = [_smh[d] for d in COMMON]
SMH3_P = [_smh3[d] for d in COMMON]
N = len(COMMON)
print("交易日区间:", COMMON[0], "->", COMMON[-1], "共", N, "天")

DD_RATIO = {lv: DRAWDOWNS[lv] / 100.0 for lv in DD_LEVELS}


def final_total(rb_pcts):
    """rb_pcts: 与 RB_LEVELS 对齐的 3 个减仓百分比。返回截止今天总资金。"""
    rb_ratio = {lv: p / 100.0 for lv, p in zip(RB_LEVELS, rb_pcts)}
    smh_sh = SMH_CAP / SMH_P[0]
    smh3_sh = SMH3_CAP / SMH3_P[0]
    peak = SMH_P[0]
    trough = None
    dd_fired = set()
    rb_fired = set()
    for i in range(1, N):
        p = SMH_P[i]
        p3 = SMH3_P[i]
        if p > peak:
            peak = p
            dd_fired.clear()
            continue
        dd_pct = (peak - p) / peak * 100.0
        for lv in DD_LEVELS:
            if lv in dd_fired:
                continue
            if dd_pct >= lv:
                r = DD_RATIO[lv]
                if r > 0 and smh_sh > 0:
                    move = smh_sh * p * r
                    smh_sh -= move / p
                    smh3_sh += move / p3
                dd_fired.add(lv)
                if lv in RESET_LEVELS:
                    trough = p
                    rb_fired.clear()
        if trough is not None and trough > 0:
            rb_pct = (p - trough) / trough * 100.0
        else:
            rb_pct = 0.0
        for lv in RB_LEVELS:
            if lv in rb_fired:
                continue
            if rb_pct >= lv:
                r = rb_ratio[lv]
                if r > 0 and smh3_sh > 0:
                    move = smh3_sh * p3 * r
                    smh3_sh -= move / p3
                    smh_sh += move / p
                rb_fired.add(lv)
    return smh_sh * SMH_P[-1] + smh3_sh * SMH3_P[-1]


def search(ranges):
    best_v, best_c = -1.0, None
    for combo in itertools.product(*ranges):
        v = final_total(combo)
        if v > best_v:
            best_v, best_c = v, combo
    return best_c, best_v


# 阶段1：步长5%粗搜
coarse = list(range(0, 101, 5))
print(f"[阶段1] 粗搜 步长5% 组合数={len(coarse)**3} ...")
c1, v1 = search([coarse] * 3)
print("粗搜最优:", dict(zip(RB_LEVELS, c1)), f"总资金={v1:,.2f}")

# 阶段2：邻域 ±5% 步长1% 细搜
def nb(c):
    return list(range(max(0, c - 5), min(100, c + 5) + 1, 1))

fine = [nb(c) for c in c1]
tot = 1
for r in fine:
    tot *= len(r)
print(f"[阶段2] 细搜 步长1% 组合数={tot} ...")
c2, v2 = search(fine)

print("\n===== 最终结论（固定补仓下的最优减仓比例）=====")
for lv, p in zip(RB_LEVELS, c2):
    print(f"  SMH反弹 +{lv}% -> 卖出当时 SMH3 市值的 {p}% 补入 SMH")
print(f"截止 {COMMON[-1]} 总资金 = {v2:,.2f}")