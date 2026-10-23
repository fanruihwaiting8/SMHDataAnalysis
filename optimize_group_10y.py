#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
通用「最近 10 年区间」收益最大化网格搜索（基准端 A / 杠杆端 B）。

与 optimize_qqq_10y.py 同一套逻辑，只是把标的对参数化，方便对
不同数据源分别求最优补仓/减仓档位，用作 GUI 推荐参数。

内置分组（与 main.py 的 DATA_SOURCES 对齐）：
  · smh : SMH(1倍基准)  / SOXL(半导体 3 倍杠杆)
  · usd : SMH(1倍基准)  / USD (半导体 2 倍)
  · qqq : QQQ(1倍基准)  / TQQQ(纳指 3 倍)

复用 backtest 的"回撤补仓、反弹减仓、资金只在两标的间转换"业务模型。

用法（需用项目 .venv）：
  cd my-project/APP/SMHDataAnalysisBot
  .venv/bin/python optimize_group_10y.py smh
  .venv/bin/python optimize_group_10y.py usd
"""
import sys
import datetime as _dt
import itertools
import backtest as bt

GROUPS = {
    "smh": {"csv_a": "Input/SMH_full_history.csv",
            "csv_b": "Input/SOXL_full_history.csv",
            "name_a": "SMH", "name_b": "SOXL"},
    "usd": {"csv_a": "Input/SMH_full_history.csv",
            "csv_b": "Input/USD_full_history.csv",
            "name_a": "SMH", "name_b": "USD"},
    "qqq": {"csv_a": "Input/QQQ_full_history.csv",
            "csv_b": "Input/TQQQ_full_history.csv",
            "name_a": "QQQ", "name_b": "TQQQ"},
}

CAP_A = 20000.0
CAP_B = 20000.0

DD_LEVELS = bt.DRAWDOWN_LEVELS          # [15, 25, 35, 45, 50]
RB_LEVELS = bt.REBOUND_LEVELS           # [50, 100, 200]
TROUGH_TRIGGER = bt.TROUGH_TRIGGER_PCT  # 25.0


def build_ctx(group_key: str):
    g = GROUPS[group_key]
    sa = bt._load_close_series(g["csv_a"])
    sb = bt._load_close_series(g["csv_b"])
    all_common = sorted(set(sa) & set(sb))
    last = _dt.date.fromisoformat(all_common[-1])
    try:
        cut = last.replace(year=last.year - 10)
    except ValueError:
        cut = last.replace(year=last.year - 10, day=28)
    start_date = cut.isoformat()
    common = [d for d in all_common if d >= start_date]
    ctx = {
        "g": g, "all_common": all_common, "common": common,
        "AP": [sa[d] for d in common], "BP": [sb[d] for d in common],
        "N": len(common), "start_date": start_date,
        "total": CAP_A + CAP_B,
    }
    return ctx


def fast_total(ctx, dd_pcts, rb_pcts):
    """内联纯计算回测（逻辑同 backtest.run_backtest），返回末日总资金。"""
    AP, BP, N = ctx["AP"], ctx["BP"], ctx["N"]
    dd_ratio = {lv: p / 100.0 for lv, p in zip(DD_LEVELS, dd_pcts)}
    rb_ratio = {lv: p / 100.0 for lv, p in zip(RB_LEVELS, rb_pcts)}
    a_sh = CAP_A / AP[0]
    b_sh = CAP_B / BP[0]
    peak = AP[0]
    active_trough = AP[0]
    dd_fired, rb_fired = set(), set()
    seg_active, seg_low = False, None
    for i in range(1, N):
        p, pb = AP[i], BP[i]
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
                if r > 0 and a_sh > 0:
                    move = a_sh * p * r
                    a_sh -= move / p
                    b_sh += move / pb
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
                if r > 0 and b_sh > 0:
                    move = b_sh * pb * r
                    b_sh -= move / pb
                    a_sh += move / p
                rb_fired.add(lv)
    return a_sh * AP[-1] + b_sh * BP[-1]


def search(ctx, dd_ranges, rb_pcts):
    best_v, best_c = -1.0, None
    for combo in itertools.product(*dd_ranges):
        v = fast_total(ctx, combo, rb_pcts)
        if v > best_v:
            best_v, best_c = v, combo
    return best_c, best_v


def search_rb(ctx, dd_pcts, rb_ranges):
    best_v, best_c = -1.0, None
    for combo in itertools.product(*rb_ranges):
        v = fast_total(ctx, dd_pcts, combo)
        if v > best_v:
            best_v, best_c = v, combo
    return best_c, best_v


def main():
    group_key = (sys.argv[1] if len(sys.argv) > 1 else "smh").lower()
    if group_key not in GROUPS:
        print(f"未知分组 {group_key}，可选: {list(GROUPS)}")
        sys.exit(1)

    ctx = build_ctx(group_key)
    g, common, N = ctx["g"], ctx["common"], ctx["N"]
    AP, BP, total = ctx["AP"], ctx["BP"], ctx["total"]
    na, nb_ = g["name_a"], g["name_b"]

    print("=" * 60)
    print(f"{na} / {nb_} 加减仓策略分析（最近 10 年窗口）")
    print("=" * 60)
    print(f"全量数据: {ctx['all_common'][0]} -> {ctx['all_common'][-1]}")
    print(f"10 年窗口: {common[0]} -> {common[-1]}  共 {N} 个交易日")
    print(f"初始资金: {na} {CAP_A:,.0f} + {nb_} {CAP_B:,.0f} = {total:,.0f}")
    print(f"{na}  {common[0]}={AP[0]:.4f} -> {common[-1]}={AP[-1]:.4f} "
          f"(×{AP[-1] / AP[0]:.2f})")
    print(f"{nb_} {common[0]}={BP[0]:.4f} -> {common[-1]}={BP[-1]:.4f} "
          f"(×{BP[-1] / BP[0]:.2f})")

    hold_a = total / AP[0] * AP[-1]
    hold_b = total / BP[0] * BP[-1]
    fixed = (total / 2) / AP[0] * AP[-1] + (total / 2) / BP[0] * BP[-1]
    print("\n----- 基准对照（不做任何策略）-----")
    print(f"  全程持 {na} : {hold_a:,.0f}")
    print(f"  全程持 {nb_}: {hold_b:,.0f}")
    print(f"  50-50 不动 : {fixed:,.0f}")

    RB_INIT = [25, 50, 100]
    coarse = list(range(0, 101, 10))
    print(f"\n[阶段1] 粗搜补仓 步长10% 组合数={len(coarse) ** 5} "
          f"(减仓固定 {dict(zip(RB_LEVELS, RB_INIT))}) ...")
    c1, v1 = search(ctx, [coarse] * 5, RB_INIT)
    print(f"  粗搜最优补仓: {dict(zip(DD_LEVELS, c1))}  总资金={v1:,.0f}")

    def nb(c):
        return list(range(max(0, c - 10), min(100, c + 10) + 1, 5))

    print("\n[阶段2] 细搜补仓 步长5% ...")
    c2, v2 = search(ctx, [nb(c) for c in c1], RB_INIT)
    print(f"  细搜最优补仓: {dict(zip(DD_LEVELS, c2))}  总资金={v2:,.0f}")

    rb_range = list(range(0, 101, 10))
    print(f"\n[阶段3] 搜索减仓 步长10%组合数={len(rb_range) ** 3} ...")
    r3, v3 = search_rb(ctx, c2, [rb_range] * 3)
    print(f"  最优减仓: {dict(zip(RB_LEVELS, r3))}  总资金={v3:,.0f}")

    def nbr(c):
        return list(range(max(0, c - 10), min(100, c + 10) + 1, 5))

    r3b, v3b = search_rb(ctx, c2, [nbr(c) for c in r3])
    print(f"  细搜减仓 步长5%: {dict(zip(RB_LEVELS, r3b))}  总资金={v3b:,.0f}")

    c4, v4 = search(ctx, [nb(c) for c in c2], r3b)
    print(f"\n[阶段4] 减仓固定后再收敛补仓: "
          f"{dict(zip(DD_LEVELS, c4))}  总资金={v4:,.0f}")

    print("\n" + "=" * 60)
    print("最终推荐策略（10 年窗口收益最大化）")
    print("=" * 60)
    for lv, p in zip(DD_LEVELS, c4):
        print(f"  {na} 回撤 -{lv}%  -> 卖出当时 {na} 市值 {p}% 买入 {nb_}")
    for lv, p in zip(RB_LEVELS, r3b):
        print(f"  {na} 反弹 +{lv}%  -> 卖出当时 {nb_} 市值 {p}% 买入 {na}")
    print(f"\n截止 {common[-1]} 策略总资金 = {v4:,.0f}")
    print(f"（对照 全程{na} {hold_a:,.0f} / 全程{nb_} {hold_b:,.0f} / "
          f"50-50不动 {fixed:,.0f}）")

    print(f"\n# 复制到 main.py DATA_SOURCES['{group_key.upper()}']：")
    print(f"recommend_dd = {dict(zip(DD_LEVELS, c4))}")
    print(f"recommend_rb = {dict(zip(RB_LEVELS, r3b))}")

    dd = {lv: p for lv, p in zip(DD_LEVELS, c4)}
    rb = {lv: p for lv, p in zip(RB_LEVELS, r3b)}
    res = bt.run_backtest(CAP_A, CAP_B, dd, rb, g["csv_a"], g["csv_b"],
                          start_date=ctx["start_date"])
    print(f"\n----- 调仓明细（共 {len(res['trades'])} 笔）-----")
    for d, act, detail, pa, pb in res["trades"]:
        print(f"  {d}  {act}  {detail}  （成交价 {pa:.2f} / {pb:.2f}）")


if __name__ == "__main__":
    main()