#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
走动回测（Walk-Forward Analysis）——检验补仓/减仓策略是否只是过拟合历史。

方法：
  把历史切成若干「训练窗口 + 测试窗口」滚动前进：
    1. 在训练窗口上网格搜索收益最大化的补仓/减仓档位；
    2. 把这组参数「原封不动」用到紧随其后、从未参与调参的测试窗口，
       记录该段「样本外（OOS）」真实表现；
    3. 滚动前进（测试窗口首尾相接、不重叠），拼接所有测试窗口得到
       一条真正的样本外收益曲线，再与「全程持 A / 全程持 B / 50-50
       不动」在同口径下对比。

判据：
  · 样本外仍稳定跑赢基准  -> 策略具备一定泛化能力（仍需看回撤/样本量）；
  · 样本外跑输或大起大落  -> 高收益主要来自样本内过拟合，谨慎当长期策略。

用法（必须用项目 .venv）：
  cd my-project/APP/SMHDataAnalysisBot
  .venv/bin/python walk_forward.py smh          # 默认 训练3年 + 测试1年
  .venv/bin/python walk_forward.py qqq 3 1      # 自定义 训练3年 + 测试1年
  .venv/bin/python walk_forward.py usd 2 1
"""
import sys
import datetime as _dt
import itertools
import backtest as bt

GROUPS = {
    "smh": ("Input/SMH_full_history.csv", "Input/SMH3_full_history.csv",
            "SMH", "SMH3"),
    "usd": ("Input/SMH_full_history.csv", "Input/USD_full_history.csv",
            "SMH", "USD"),
    "qqq": ("Input/QQQ_full_history.csv", "Input/TQQQ_full_history.csv",
            "QQQ", "TQQQ"),
}

CAP = 40000.0                           # 每个测试窗口起始资金（50-50 分配）
DD_LEVELS = bt.DRAWDOWN_LEVELS          # [15, 25, 35, 45, 50]
RB_LEVELS = bt.REBOUND_LEVELS           # [50, 100, 200]
TROUGH = bt.TROUGH_TRIGGER_PCT          # 25.0


def simulate(AP, BP, dd_ratio, rb_ratio):
    """与 backtest 模型一致的纯计算版，返回 (末日总资金, 逐日净值列表)。"""
    n = len(AP)
    a = (CAP / 2) / AP[0]
    b = (CAP / 2) / BP[0]
    peak = AP[0]
    trough = AP[0]
    ddf, rbf = set(), set()
    seg_active, seg_low = False, None
    eq = [a * AP[0] + b * BP[0]]
    for i in range(1, n):
        p, pb = AP[i], BP[i]
        if p > peak:
            peak = p
            ddf.clear()
            seg_active, seg_low = False, None
            eq.append(a * p + b * pb)
            continue
        if seg_low is None or p < seg_low:
            seg_low = p
        dd = (peak - p) / peak * 100.0
        for lv in DD_LEVELS:
            if lv in ddf:
                continue
            if dd >= lv:
                r = dd_ratio[lv]
                if r > 0 and a > 0:
                    mv = a * p * r
                    a -= mv / p
                    b += mv / pb
                ddf.add(lv)
        if dd >= TROUGH:
            if not seg_active:
                seg_active = True
                trough = seg_low
                rbf.clear()
            elif seg_low < trough:
                trough = seg_low
                rbf.clear()
        rb = (p - trough) / trough * 100.0 if trough and trough > 0 else 0.0
        for lv in RB_LEVELS:
            if lv in rbf:
                continue
            if rb >= lv:
                r = rb_ratio[lv]
                if r > 0 and b > 0:
                    mv = b * pb * r
                    b -= mv / pb
                    a += mv / p
                rbf.add(lv)
        eq.append(a * p + b * pb)
    return a * AP[-1] + b * BP[-1], eq


def total_only(AP, BP, dd_pcts, rb_pcts):
    dd = {lv: p / 100.0 for lv, p in zip(DD_LEVELS, dd_pcts)}
    rb = {lv: p / 100.0 for lv, p in zip(RB_LEVELS, rb_pcts)}
    t, _ = simulate(AP, BP, dd, rb)
    return t


def optimize(AP, BP):
    """分阶段网格搜索训练窗口最优档位，返回 (dd_pcts, rb_pcts)。"""
    rb0 = [25, 50, 100]
    coarse = list(range(0, 101, 20))            # 0,20,40,60,80,100
    best_v, best_c = -1.0, None
    for combo in itertools.product(coarse, repeat=5):
        v = total_only(AP, BP, combo, rb0)
        if v > best_v:
            best_v, best_c = v, combo

    def nb(c):
        return list(range(max(0, c - 10), min(100, c + 10) + 1, 10))

    best2 = best_c
    for combo in itertools.product(*[nb(c) for c in best_c]):
        v = total_only(AP, BP, combo, rb0)
        if v > best_v:
            best_v, best2 = v, combo

    rbr = list(range(0, 101, 20))
    best_rv, best_r = -1.0, [0, 0, 0]
    for combo in itertools.product(rbr, repeat=3):
        v = total_only(AP, BP, best2, combo)
        if v > best_rv:
            best_rv, best_r = v, combo
    return list(best2), list(best_r)


def max_drawdown(eq):
    peak = eq[0]
    mdd = 0.0
    for v in eq:
        if v > peak:
            peak = v
        dd = (peak - v) / peak
        if dd > mdd:
            mdd = dd
    return mdd * 100.0


def add_years(d, y):
    try:
        return d.replace(year=d.year + y)
    except ValueError:
        return d.replace(year=d.year + y, day=28)


def main():
    key = (sys.argv[1] if len(sys.argv) > 1 else "smh").lower()
    train_y = int(sys.argv[2]) if len(sys.argv) > 2 else 3
    test_y = int(sys.argv[3]) if len(sys.argv) > 3 else 1
    if key not in GROUPS:
        print(f"未知分组 {key}，可选 {list(GROUPS)}")
        sys.exit(1)
    csv_a, csv_b, na, nb_ = GROUPS[key]
    sa = bt._load_close_series(csv_a)
    sb = bt._load_close_series(csv_b)
    common = sorted(set(sa) & set(sb))
    d0 = _dt.date.fromisoformat(common[0])

    print("=" * 64)
    print(f"走动回测 Walk-Forward：{na} / {nb_}  "
          f"训练{train_y}年 + 测试{test_y}年 滚动前进")
    print("=" * 64)
    print(f"全量数据 {common[0]} -> {common[-1]}  共 {len(common)} 交易日")

    # ===== 构造滚动窗口（测试窗口首尾相接、互不重叠）=====
    folds = []
    tr_start = d0
    while True:
        tr_end = add_years(tr_start, train_y)
        te_end = add_years(tr_end, test_y)
        tr_dates = [d for d in common
                    if tr_start.isoformat() <= d < tr_end.isoformat()]
        te_dates = [d for d in common
                    if tr_end.isoformat() <= d < te_end.isoformat()]
        if len(tr_dates) < 60 or len(te_dates) < 20:
            break
        folds.append((tr_dates, te_dates))
        tr_start = add_years(tr_start, test_y)

    if not folds:
        print("数据跨度不足，无法构造「训练+测试」窗口；可减小训练/测试年数。")
        sys.exit(1)

    # 链式复利：策略与各基准都从同一 OOS 窗口起点、同样本金出发，
    # 取各自成长倍数相乘，得到跨所有测试窗口的样本外累计表现。
    cum = {"strat": 1.0, na: 1.0, nb_: 1.0, "5050": 1.0}
    strat_eq = [1.0]                    # 归一化净值，用于算整体最大回撤

    print(f"\n共 {len(folds)} 个滚动窗口（搜索中，可能需要一会儿）：\n")
    print(f"{'测试期(样本外)':<26}{'OOS策略':>9}{'全持'+na:>9}"
          f"{'全持'+nb_:>10}{'50-50':>9}  调参档位(dd/rb)")
    print("-" * 92)

    for tr, te in folds:
        AP_tr = [sa[d] for d in tr]
        BP_tr = [sb[d] for d in tr]
        dd_pcts, rb_pcts = optimize(AP_tr, BP_tr)
        AP_te = [sa[d] for d in te]
        BP_te = [sb[d] for d in te]
        dd = {lv: p / 100.0 for lv, p in zip(DD_LEVELS, dd_pcts)}
        rb = {lv: p / 100.0 for lv, p in zip(RB_LEVELS, rb_pcts)}
        s_final, s_eq = simulate(AP_te, BP_te, dd, rb)
        g_strat = s_final / CAP
        g_a = AP_te[-1] / AP_te[0]
        g_b = BP_te[-1] / BP_te[0]
        g_5050 = 0.5 * g_a + 0.5 * g_b
        cum["strat"] *= g_strat
        cum[na] *= g_a
        cum[nb_] *= g_b
        cum["5050"] *= g_5050
        base = strat_eq[-1]
        for v in s_eq[1:]:
            strat_eq.append(base * (v / s_eq[0]))
        print(f"{te[0]}~{te[-1]:<14}"
              f"{(g_strat - 1) * 100:>8.1f}%{(g_a - 1) * 100:>8.1f}%"
              f"{(g_b - 1) * 100:>9.1f}%{(g_5050 - 1) * 100:>8.1f}%"
              f"  dd={dd_pcts} rb={rb_pcts}")

    print("-" * 92)
    print("\n样本外累计（链式复利）成长倍数：")
    print(f"  OOS 策略   : ×{cum['strat']:.3f}   累计 {(cum['strat'] - 1) * 100:+.1f}%")
    print(f"  全程持 {na} : ×{cum[na]:.3f}   累计 {(cum[na] - 1) * 100:+.1f}%")
    print(f"  全程持 {nb_}: ×{cum[nb_]:.3f}   累计 {(cum[nb_] - 1) * 100:+.1f}%")
    print(f"  50-50 不动 : ×{cum['5050']:.3f}   累计 {(cum['5050'] - 1) * 100:+.1f}%")
    print(f"\n  OOS 策略整条曲线最大回撤：{max_drawdown(strat_eq):.1f}%")

    beat_5050 = cum["strat"] > cum["5050"]
    beat_a = cum["strat"] > cum[na]
    beat_lev = cum["strat"] > cum[nb_]        # 对标无脑持有杠杆端（最严格）
    print("\n结论：", end="")
    if beat_lev and beat_5050:
        print(f"样本外同时跑赢「50-50」与「无脑持 {nb_}」 —— "
              "策略有真实泛化能力（仍需看回撤与更多市场样本）。")
    elif beat_5050 or beat_a:
        print(f"样本外跑赢 1 倍基准/50-50，但【跑输无脑持有杠杆端 {nb_}】 —— "
              "择时规则未能贡献超额收益，高回报本质是杠杆 Beta，"
              "不建议当长期 Alpha 策略。")
    else:
        print("样本外跑输全部基准 —— 高收益纯属样本内过拟合，不可长期执行。")


if __name__ == "__main__":
    main()