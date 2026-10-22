#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
QQQ / TQQQ 加减仓策略——「最近 10 年区间」收益最大化网格搜索。

与 optimize_qqq.py 的唯一区别：把回测区间限制在数据末日往前推 10 年
（约 2016-10 至 2026-10），寻找该 10 年窗口内令末值最大的补仓/减仓档位，
用作 GUI 的 QQQ 推荐参数。

复用 backtest 的"回撤补仓、反弹减仓、资金只在两标的间转换"业务模型：
  · 基准端(1倍)=QQQ ；杠杆端(3倍纳指)=TQQQ
  · QQQ 相对历史新高回撤达档位 -> 卖 QQQ 买 TQQQ
  · QQQ 相对有效底部反弹达档位 -> 卖 TQQQ 买 QQQ

用法（需用项目 .venv）：
  cd my-project/APP/SMHDataAnalysisBot
  .venv/bin/python optimize_qqq_10y.py
"""
import datetime as _dt
import itertools
import backtest as bt

QQQ_CSV = "Input/QQQ_full_history.csv"
TQQQ_CSV = "Input/TQQQ_full_history.csv"

QQQ_CAP = 20000.0
TQQQ_CAP = 20000.0

DD_LEVELS = bt.DRAWDOWN_LEVELS          # [15, 25, 35, 45, 50]
RB_LEVELS = bt.REBOUND_LEVELS           # [50, 100, 200]
TROUGH_TRIGGER = bt.TROUGH_TRIGGER_PCT  # 25.0

# ---- 加载并对齐两序列，再截取"最近 10 年"窗口 ----
_qqq = bt._load_close_series(QQQ_CSV)
_tqqq = bt._load_close_series(TQQQ_CSV)
_all_common = sorted(set(_qqq) & set(_tqqq))

_last = _dt.date.fromisoformat(_all_common[-1])
# 10 年前的同一天（闰年 2-29 回退到 2-28）
try:
    _cut = _last.replace(year=_last.year - 10)
except ValueError:
    _cut = _last.replace(year=_last.year - 10, day=28)
START_DATE = _cut.isoformat()

COMMON = [d for d in _all_common if d >= START_DATE]
QP = [_qqq[d] for d in COMMON]
TP = [_tqqq[d] for d in COMMON]
N = len(COMMON)
TOTAL = QQQ_CAP + TQQQ_CAP


def fast_total(dd_pcts, rb_pcts):
    """内联纯计算回测（逻辑同 backtest.run_backtest），返回末日总资金。"""
    dd_ratio = {lv: p / 100.0 for lv, p in zip(DD_LEVELS, dd_pcts)}
    rb_ratio = {lv: p / 100.0 for lv, p in zip(RB_LEVELS, rb_pcts)}
    q_sh = QQQ_CAP / QP[0]
    t_sh = TQQQ_CAP / TP[0]
    peak = QP[0]
    active_trough = QP[0]
    dd_fired, rb_fired = set(), set()
    seg_active, seg_low = False, None
    for i in range(1, N):
        p, pt = QP[i], TP[i]
        if p > peak:
            peak = p
            dd_fired.clear()
            seg_active, seg_low = False, None
            continue
        if seg_low is None or p < seg_low:
            seg_low = p
        dd_pct = (peak - p) / peak * 100.0
        for lv in DD_LEVELS:
            if lv in dd_fired:
                continue
            if dd_pct >= lv:
                r = dd_ratio[lv]
                if r > 0 and q_sh > 0:
                    move = q_sh * p * r
                    q_sh -= move / p
                    t_sh += move / pt
                dd_fired.add(lv)
        if dd_pct >= TROUGH_TRIGGER:
            if not seg_active:
                seg_active = True
                active_trough = seg_low
                rb_fired.clear()
            elif seg_low < active_trough:
                active_trough = seg_low
                rb_fired.clear()
        if active_trough and active_trough > 0:
            rb_pct = (p - active_trough) / active_trough * 100.0
        else:
            rb_pct = 0.0
        for lv in RB_LEVELS:
            if lv in rb_fired:
                continue
            if rb_pct >= lv:
                r = rb_ratio[lv]
                if r > 0 and t_sh > 0:
                    move = t_sh * pt * r
                    t_sh -= move / pt
                    q_sh += move / p
                rb_fired.add(lv)
    return q_sh * QP[-1] + t_sh * TP[-1]


def search(dd_ranges, rb_pcts):
    best_v, best_c = -1.0, None
    for combo in itertools.product(*dd_ranges):
        v = fast_total(combo, rb_pcts)
        if v > best_v:
            best_v, best_c = v, combo
    return best_c, best_v


def search_rb(dd_pcts, rb_ranges):
    best_v, best_c = -1.0, None
    for combo in itertools.product(*rb_ranges):
        v = fast_total(dd_pcts, combo)
        if v > best_v:
            best_v, best_c = v, combo
    return best_c, best_v


def main():
    print("=" * 60)
    print("QQQ / TQQQ 加减仓策略分析（最近 10 年窗口）")
    print("=" * 60)
    print(f"全量数据: {_all_common[0]} -> {_all_common[-1]}")
    print(f"10 年窗口: {COMMON[0]} -> {COMMON[-1]}  共 {N} 个交易日")
    print(f"初始资金: QQQ {QQQ_CAP:,.0f} + TQQQ {TQQQ_CAP:,.0f} = {TOTAL:,.0f}")
    print(f"QQQ  {COMMON[0]}={QP[0]:.2f} -> {COMMON[-1]}={QP[-1]:.2f} "
          f"(×{QP[-1] / QP[0]:.2f})")
    print(f"TQQQ {COMMON[0]}={TP[0]:.4f} -> {COMMON[-1]}={TP[-1]:.2f} "
          f"(×{TP[-1] / TP[0]:.2f})")

    hold_q = TOTAL / QP[0] * QP[-1]
    hold_t = TOTAL / TP[0] * TP[-1]
    fixed = (TOTAL / 2) / QP[0] * QP[-1] + (TOTAL / 2) / TP[0] * TP[-1]
    print("\n----- 基准对照（不做任何策略）-----")
    print(f"  全程持 QQQ : {hold_q:,.0f}")
    print(f"  全程持 TQQQ: {hold_t:,.0f}")
    print(f"  50-50 不动 : {fixed:,.0f}")

    RB_INIT = [25, 50, 100]
    coarse = list(range(0, 101, 10))
    print(f"\n[阶段1] 粗搜补仓 步长10% 组合数={len(coarse) ** 5} "
          f"(减仓固定 {dict(zip(RB_LEVELS, RB_INIT))}) ...")
    c1, v1 = search([coarse] * 5, RB_INIT)
    print(f"  粗搜最优补仓: {dict(zip(DD_LEVELS, c1))}  总资金={v1:,.0f}")

    def nb(c):
        return list(range(max(0, c - 10), min(100, c + 10) + 1, 5))

    print("\n[阶段2] 细搜补仓 步长5% ...")
    c2, v2 = search([nb(c) for c in c1], RB_INIT)
    print(f"  细搜最优补仓: {dict(zip(DD_LEVELS, c2))}  总资金={v2:,.0f}")

    rb_range = list(range(0, 101, 10))
    print(f"\n[阶段3] 搜索减仓 步长10% 组合数={len(rb_range) ** 3} ...")
    r3, v3 = search_rb(c2, [rb_range] * 3)
    print(f"  最优减仓: {dict(zip(RB_LEVELS, r3))}  总资金={v3:,.0f}")

    def nbr(c):
        return list(range(max(0, c - 10), min(100, c + 10) + 1, 5))

    r3b, v3b = search_rb(c2, [nbr(c) for c in r3])
    print(f"  细搜减仓 步长5%: {dict(zip(RB_LEVELS, r3b))}  总资金={v3b:,.0f}")

    c4, v4 = search([nb(c) for c in c2], r3b)
    print(f"\n[阶段4] 减仓固定后再收敛补仓: "
          f"{dict(zip(DD_LEVELS, c4))}  总资金={v4:,.0f}")

    print("\n" + "=" * 60)
    print("最终推荐策略（10 年窗口收益最大化）")
    print("=" * 60)
    for lv, p in zip(DD_LEVELS, c4):
        print(f"  QQQ 回撤 -{lv}%  -> 卖出当时 QQQ 市值 {p}% 买入 TQQQ")
    for lv, p in zip(RB_LEVELS, r3b):
        print(f"  QQQ 反弹 +{lv}%  -> 卖出当时 TQQQ 市值 {p}% 买入 QQQ")
    print(f"\n截止 {COMMON[-1]} 策略总资金 = {v4:,.0f}")
    print(f"（对照 全程QQQ {hold_q:,.0f} / 全程TQQQ {hold_t:,.0f} / "
          f"50-50不动 {fixed:,.0f}）")

    print("\n# 复制到 main.py DATA_SOURCES['QQQ']：")
    print(f"recommend_dd = {dict(zip(DD_LEVELS, c4))}")
    print(f"recommend_rb = {dict(zip(RB_LEVELS, r3b))}")

    dd = {lv: p for lv, p in zip(DD_LEVELS, c4)}
    rb = {lv: p for lv, p in zip(RB_LEVELS, r3b)}
    res = bt.run_backtest(QQQ_CAP, TQQQ_CAP, dd, rb, QQQ_CSV, TQQQ_CSV,
                          start_date=START_DATE)
    print(f"\n----- 调仓明细（共 {len(res['trades'])} 笔）-----")
    for d, act, detail in res["trades"]:
        print(f"  {d}  {act}  {detail}")


if __name__ == "__main__":
    main()