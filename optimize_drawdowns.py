#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
在固定减仓策略下，网格搜索最优补仓档位百分比，使截止今天总资金最大。

固定减仓（rebounds）：SMH反弹 +50%卖SOXL的25%、+100%卖50%、+200%卖100%。
待优化补仓（drawdowns）：回撤-15/-25/-35/-45/-50% 各卖出当时 SMH 市值的百分比。

为加速搜索，内联一个纯计算版回测（与 backtest.run_backtest 逻辑完全一致，
但预加载价格数组、不读盘、不生成 trades 明细）。
两阶段：先 10% 步长粗搜，再在最优点邻域 ±10% 用 2% 步长细搜。
"""
import itertools
import backtest as bt

SMH_CSV = "Input/SMH_full_history.csv"
SMH3_CSV = "Input/SOXL_full_history.csv"
SMH_CAP = 20000.0
SMH3_CAP = 20000.0
REBOUNDS = {50: 25, 100: 50, 200: 100}
DD_LEVELS = [15, 25, 35, 45, 50]
RB_LEVELS = [50, 100, 200]
RESET_LEVELS = [lv for lv in DD_LEVELS if lv >= 25]

# 预加载并对齐两序列（交集升序），转成并行价格数组
_smh = bt._load_close_series(SMH_CSV)
_smh3 = bt._load_close_series(SMH3_CSV)
COMMON = sorted(set(_smh) & set(_smh3))
SMH_P = [_smh[d] for d in COMMON]
SMH3_P = [_smh3[d] for d in COMMON]
N = len(COMMON)
print("交易日区间:", COMMON[0], "->", COMMON[-1], "共", N, "天")

# 固定减仓比例（预转小数）
RB_RATIO = {lv: REBOUNDS[lv] / 100.0 for lv in RB_LEVELS}


def final_total(dd_pcts):
    """dd_pcts: 与 DD_LEVELS 对齐的 5 个补仓百分比。返回截止今天总资金。"""
    dd_ratio = {lv: p / 100.0 for lv, p in zip(DD_LEVELS, dd_pcts)}
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
                r = dd_ratio[lv]
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
                r = RB_RATIO[lv]
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


base = final_total([0, 0, 0, 0, 0])
print(f"[基准] 完全不补仓 总资金 = {base:,.2f}")

coarse = list(range(0, 101, 10))
print(f"\n[阶段1] 粗搜 步长10% 组合数={len(coarse)**5} ...")
c1, v1 = search([coarse] * 5)
print("粗搜最优:", dict(zip(DD_LEVELS, c1)), f"总资金={v1:,.2f}")

def nb(c):
    return list(range(max(0, c - 10), min(100, c + 10) + 1, 2))

fine = [nb(c) for c in c1]
tot = 1
for r in fine:
    tot *= len(r)
print(f"\n[阶段2] 细搜 步长2% 组合数={tot} ...")
c2, v2 = search(fine)

print("\n===== 最终结论（固定减仓下的最优补仓档位）=====")
for lv, p in zip(DD_LEVELS, c2):
    print(f"  回撤 -{lv}% -> 卖出当时 SMH 市值的 {p}% 补入 SOXL")
print(f"截止 {COMMON[-1]} 总资金 = {v2:,.2f}  (基准不补仓 {base:,.2f})")