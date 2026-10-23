#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
固定参数样本外回测（Anchored Out-of-Sample）
=============================================

与 walk_forward.py 的「每年滚动重新调参」不同，本脚本更贴近真实执行：

    1. 只用【最早的一段数据】训练一次，网格搜索出一组补仓/减仓档位；
    2. 把这组参数【永久固定、再也不改】，一次性回测训练期之后的
       【全部剩余时间】——这就是你在起点定好规则后一直照做到今天的真实结果；
    3. 与「全程持 A / 全程持 B / 50-50 不动」在同口径下对比。

为什么这样才公平：
  现实中你不可能每年拿「未来数据」回头调参。能用的只有过去。
  如果一组在最早期定下的参数，样本外还能稳定跑赢无脑持有杠杆端，
  才说明择时规则真有可执行的 Alpha；若样本外跑输，则高收益只是杠杆 Beta。

三组可测（SMH/SOXL 换用 SOXL 后样本已补足到约 10 年）：
  qqq -> QQQ(1倍) / TQQQ(3倍纳指)
  usd -> SMH(1倍) / USD(2倍半导体)
  smh -> SMH(1倍) / SOXL(3倍半导体)

用法（必须用项目 .venv）：
  cd my-project/APP/SMHDataAnalysisBot
  .venv/bin/python fixed_param_test.py qqq        # 默认训练最早3年，测试其后全部
  .venv/bin/python fixed_param_test.py usd 3
  .venv/bin/python fixed_param_test.py qqq 2      # 训练期越短，样本外越长越严格
"""
import sys
import datetime as _dt
import backtest as bt
import walk_forward as wf

# 三组：SMH/SOXL 换标的后样本约 10 年，已可参与样本外检验
GROUPS = {
    "usd": wf.GROUPS["usd"],
    "qqq": wf.GROUPS["qqq"],
    "smh": wf.GROUPS["smh"],
}


def cagr(mult, years):
    """由总成长倍数与年数折算年化收益率(%)。"""
    if years <= 0 or mult <= 0:
        return 0.0
    return (mult ** (1.0 / years) - 1.0) * 100.0


def main():
    key = (sys.argv[1] if len(sys.argv) > 1 else "qqq").lower()
    train_y = int(sys.argv[2]) if len(sys.argv) > 2 else 3
    if key not in GROUPS:
        print(f"未知分组 {key}，可选 {list(GROUPS)}")
        sys.exit(1)

    csv_a, csv_b, na, nb_ = GROUPS[key]
    sa = bt._load_close_series(csv_a)
    sb = bt._load_close_series(csv_b)
    common = sorted(set(sa) & set(sb))
    d0 = _dt.date.fromisoformat(common[0])
    tr_end = wf.add_years(d0, train_y)

    tr = [d for d in common if d < tr_end.isoformat()]
    te = [d for d in common if d >= tr_end.isoformat()]
    if len(tr) < 60 or len(te) < 60:
        print("数据跨度不足以切出「训练+足够长测试」窗口，请减小训练年数。")
        sys.exit(1)

    print("=" * 68)
    print(f"固定参数样本外回测：{na} / {nb_}")
    print("=" * 68)
    print(f"全量数据   {common[0]} -> {common[-1]}  共 {len(common)} 交易日")
    print(f"训练期(定参){tr[0]} -> {tr[-1]}  共 {len(tr)} 交易日（最早 {train_y} 年）")
    print(f"测试期(样本外){te[0]} -> {te[-1]}  共 {len(te)} 交易日")

    # ===== 1) 只用最早一段训练，定出一组永久固定参数 =====
    print("\n正在用最早一段数据网格搜索最优档位（可能需要一会儿）……")
    AP_tr = [sa[d] for d in tr]
    BP_tr = [sb[d] for d in tr]
    dd_pcts, rb_pcts = wf.optimize(AP_tr, BP_tr)
    tr_mult = wf.total_only(AP_tr, BP_tr, dd_pcts, rb_pcts) / wf.CAP
    print(f"训练期选出固定参数： dd={dd_pcts}  rb={rb_pcts}")
    print(f"训练期内（样本内）策略成长：×{tr_mult:.3f}")

    # ===== 2) 固定参数，一次性回测其后全部时间 =====
    AP_te = [sa[d] for d in te]
    BP_te = [sb[d] for d in te]
    dd = {lv: p / 100.0 for lv, p in zip(wf.DD_LEVELS, dd_pcts)}
    rb = {lv: p / 100.0 for lv, p in zip(wf.RB_LEVELS, rb_pcts)}
    s_final, s_eq = wf.simulate(AP_te, BP_te, dd, rb)

    g_strat = s_final / wf.CAP
    g_a = AP_te[-1] / AP_te[0]
    g_b = BP_te[-1] / BP_te[0]
    g_5050 = 0.5 * g_a + 0.5 * g_b

    # 测试期年数（按日历）
    d_te0 = _dt.date.fromisoformat(te[0])
    d_te1 = _dt.date.fromisoformat(te[-1])
    yrs = (d_te1 - d_te0).days / 365.25

    # 各基准归一化净值 -> 最大回撤
    a_eq = [p / AP_te[0] for p in AP_te]
    b_eq = [p / BP_te[0] for p in BP_te]
    eq_5050 = [0.5 * (AP_te[i] / AP_te[0]) + 0.5 * (BP_te[i] / BP_te[0])
               for i in range(len(te))]
    s_eq_norm = [v / s_eq[0] for v in s_eq]

    print("\n" + "-" * 68)
    print(f"测试期约 {yrs:.1f} 年样本外结果（起始 50-50，参数全程不变）：")
    print("-" * 68)
    rows = [
        ("固定参数策略", g_strat, wf.max_drawdown(s_eq_norm)),
        (f"全程持 {na}（1倍基准）", g_a, wf.max_drawdown(a_eq)),
        (f"全程持 {nb_}（杠杆端）", g_b, wf.max_drawdown(b_eq)),
        ("50-50 不动", g_5050, wf.max_drawdown(eq_5050)),
    ]
    print(f"{'方案':<22}{'成长倍数':>10}{'累计收益':>12}{'年化':>10}{'最大回撤':>12}")
    for name, mult, mdd in rows:
        print(f"{name:<22}×{mult:>8.3f}{(mult - 1) * 100:>10.1f}%"
              f"{cagr(mult, yrs):>9.1f}%{mdd:>11.1f}%")
    print("-" * 68)

    beat_lev = g_strat > g_b
    beat_5050 = g_strat > g_5050
    beat_a = g_strat > g_a
    print("\n结论：", end="")
    if beat_lev and beat_5050:
        print(f"固定参数样本外【同时跑赢 50-50 与无脑持 {nb_}】 —— "
              "择时规则有真实、可执行的超额收益。")
    elif beat_5050 or beat_a:
        print(f"固定参数样本外跑赢 1 倍基准/50-50，但【跑输无脑持 {nb_}】 —— "
              f"择时未贡献 Alpha，高收益本质是长期持有杠杆端的 Beta。")
    else:
        print("固定参数样本外跑输全部基准 —— 该参数无法泛化到未来。")


if __name__ == "__main__":
    main()