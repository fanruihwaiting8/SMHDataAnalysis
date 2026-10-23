#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
QQQ / TQQQ 加仓减仓策略分析与优化。

复用 SMH/SOXL 的"回撤补仓、反弹减仓、资金只在两标的间转换"业务模型：
  · 基准端(1倍) = QQQ ；杠杆端(3倍纳指) = TQQQ
  · 回撤补仓：QQQ 相对历史新高 peak 回撤达档位 -> 卖 QQQ 买 TQQQ
  · 反弹减仓：QQQ 相对"有效底部 active_trough"反弹达档位 -> 卖 TQQQ 买 QQQ
  · 有效底部规则与 backtest.run_backtest 完全一致（TROUGH_TRIGGER_PCT=25%）

本脚本：
  1) 打印各类基准对照（全程持 QQQ / 全程持 TQQQ / 50-50 不动）；
  2) 两阶段网格搜索最优补仓档位（固定一组合理减仓）；
  3) 再对减仓档位做搜索；
  4) 输出可执行的策略建议 + 每笔调仓明细。

用法（需用项目 .venv）：
  cd my-project/APP/SMHDataAnalysisBot
  .venv/bin/python optimize_qqq.py
"""
import itertools
import backtest as bt

QQQ_CSV = "Input/QQQ_full_history.csv"
TQQQ_CSV = "Input/TQQQ_full_history.csv"

# 初始资金：QQQ 端 / TQQQ 端各投入（与 SMH 版一致，各 2 万，合计 4 万）
QQQ_CAP = 20000.0
TQQQ_CAP = 20000.0

DD_LEVELS = bt.DRAWDOWN_LEVELS          # [15, 25, 35, 45, 50]
RB_LEVELS = bt.REBOUND_LEVELS           # [50, 100, 200]
TROUGH_TRIGGER = bt.TROUGH_TRIGGER_PCT  # 25.0

# 预加载并对齐两序列（交集升序），转成并行价格数组以加速网格搜索
_qqq = bt._load_close_series(QQQ_CSV)
_tqqq = bt._load_close_series(TQQQ_CSV)
COMMON = sorted(set(_qqq) & set(_tqqq))
QP = [_qqq[d] for d in COMMON]      # QQQ 收盘价数组（基准端）
TP = [_tqqq[d] for d in COMMON]     # TQQQ 收盘价数组（杠杆端）
N = len(COMMON)
TOTAL = QQQ_CAP + TQQQ_CAP


def fast_total(dd_pcts, rb_pcts):
    """内联纯计算回测（逻辑同 backtest.run_backtest），返回截止末日总资金。

    dd_pcts: 与 DD_LEVELS 对齐的补仓百分比（卖 QQQ 的比例）
    rb_pcts: 与 RB_LEVELS 对齐的减仓百分比（卖 TQQQ 的比例）
    """
    dd_ratio = {lv: p / 100.0 for lv,p in zip(DD_LEVELS, dd_pcts)}
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
        # 回撤补仓
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
        # 有效底部刷新
        if dd_pct >= TROUGH_TRIGGER:
            if not seg_active:
                seg_active = True
                active_trough = seg_low
                rb_fired.clear()
            elif seg_low < active_trough:
                active_trough = seg_low
                rb_fired.clear()
        # 反弹减仓
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
    print("QQQ / TQQQ 加减仓策略分析")
    print("=" * 60)
    print(f"交易日区间: {COMMON[0]} -> {COMMON[-1]}  共 {N} 天")
    print(f"初始资金: QQQ {QQQ_CAP:,.0f} + TQQQ {TQQQ_CAP:,.0f} "
          f"= {TOTAL:,.0f}")
    print(f"QQQ  {COMMON[0]}={QP[0]:.2f} -> {COMMON[-1]}={QP[-1]:.2f} "
          f"(×{QP[-1] / QP[0]:.1f})")
    print(f"TQQQ {COMMON[0]}={TP[0]:.4f} -> {COMMON[-1]}={TP[-1]:.2f} "
          f"(×{TP[-1] / TP[0]:.0f})")

    # ---- 基准对照 ----
    hold_q = TOTAL / QP[0] * QP[-1]
    hold_t = TOTAL / TP[0] * TP[-1]
    fixed = (TOTAL / 2) / QP[0] * QP[-1] + (TOTAL / 2) / TP[0] * TP[-1]
    print("\n----- 基准对照（不做任何策略）-----")
    print(f"  全程持 QQQ : {hold_q:,.0f}")
    print(f"  全程持 TQQQ: {hold_t:,.0f}")
    print(f"  50-50 不动 : {fixed:,.0f}")
    print(f"  完全不调仓 : {fast_total([0]*5, [0]*3):,.0f}")

    # ---- 阶段1：粗搜补仓（固定一组合理减仓）----
    RB_INIT = [25, 50, 100]  # +50%卖25% / +100%卖50% / +200%卖100%
    coarse = list(range(0, 101, 10))
    print(f"\n[阶段1] 粗搜补仓 步长10% 组合数={len(coarse)**5} "
          f"(减仓固定 {dict(zip(RB_LEVELS, RB_INIT))}) ...")
    c1, v1 = search([coarse] * 5, RB_INIT)
    print(f"  粗搜最优补仓: {dict(zip(DD_LEVELS, c1))}  总资金={v1:,.0f}")

    def nb(c):
        return list(range(max(0, c - 10), min(100, c + 10) + 1, 5))

    print("\n[阶段2] 细搜补仓 步长5% ...")
    c2, v2 = search([nb(c) for c in c1], RB_INIT)
    print(f"  细搜最优补仓: {dict(zip(DD_LEVELS, c2))}  总资金={v2:,.0f}")

    # ---- 阶段3：在最优补仓下搜索减仓 ----
    rb_range = list(range(0, 101, 10))
    print(f"\n[阶段3] 搜索减仓 步长10% 组合数={len(rb_range)**3} ...")
    r3, v3 = search_rb(c2, [rb_range] * 3)
    print(f"  最优减仓: {dict(zip(RB_LEVELS, r3))}  总资金={v3:,.0f}")

    # ---- 阶段4：再回搜一次补仓，收敛 ----
    c4, v4 = search([nb(c) for c in c2], r3)
    print(f"\n[阶段4] 减仓固定后再收敛补仓: "
          f"{dict(zip(DD_LEVELS, c4))}  总资金={v4:,.0f}")

    print("\n" + "=" * 60)
    print("最终推荐策略（收益最大化）")
    print("=" * 60)
    for lv, p in zip(DD_LEVELS, c4):
        print(f"  QQQ 回撤 -{lv}%  -> 卖出当时 QQQ 市值 {p}% 买入 TQQQ")
    for lv, p in zip(RB_LEVELS, r3):
        print(f"  QQQ 反弹 +{lv}%  -> 卖出当时 TQQQ 市值 {p}% 买入 QQQ")
    print(f"\n截止 {COMMON[-1]} 策略总资金 = {v4:,.0f}")
    print(f"（对照 全程QQQ {hold_q:,.0f} / 全程TQQQ {hold_t:,.0f} / "
          f"50-50不动 {fixed:,.0f}）")

    # ---- 用完整引擎跑一遍，输出调仓明细 ----
    dd = {lv: p for lv, p in zip(DD_LEVELS, c4)}
    rb = {lv: p for lv, p in zip(RB_LEVELS, r3)}
    res = bt.run_backtest(QQQ_CAP, TQQQ_CAP, dd, rb, QQQ_CSV, TQQQ_CSV)
    print(f"\n----- 调仓明细（共 {len(res['trades'])} 笔）-----")
    for d, act, detail, pa, pb in res["trades"]:
        print(f"  {d}  {act}  {detail}  （成交价 {pa:.2f} / {pb:.2f}）")


if __name__ == "__main__":
    main()