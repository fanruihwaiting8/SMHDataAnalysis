#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""QQQ/SOXL 与 SMH/SOXL 长期表现对比（同窗口、同口径、多起点）。

回答的问题：把基准端从 SMH（半导体）换成 QQQ（纳指宽基）、杠杆端仍用
SOXL（半导体 3 倍），长期收益是不是比 SMH/SOXL 更高？

口径：
  · 初始资金 20000 + 20000，一次性投入，不定投；
  · 每组都用「该组自己的推荐参数」和「对方的推荐参数」各跑一遍，
    避免结论被某一组参数的过拟合带偏；
  · 同时给出全程持 A / 全程持 B / 50-50 不动三条基准；
  · 多起点（每年年初）检验稳健性，输出倍数中位数/最差值。

用法：
  cd my-project/APP/SMHDataAnalysisBot
  .venv/bin/python tools/compare_qqq_soxl.py
"""
import os
import sys
import statistics as st

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import backtest as bt                     # noqa: E402
import optimize_group_10y as og           # noqa: E402

CAP = 20000.0
DD_L, RB_L = bt.DRAWDOWN_LEVELS, bt.REBOUND_LEVELS

# 现网推荐参数（与 main.py DATA_SOURCES / web/app.js REC_BY_SOURCE 一致）
PARAMS = {
    "SMH": ({15: 0, 25: 45, 35: 100, 45: 0, 50: 0}, {50: 0, 100: 0, 200: 100}),
    "QQQ": ({15: 90, 25: 0, 35: 100, 45: 0, 50: 0}, {50: 0, 100: 100, 200: 0}),
    "USD": ({15: 0, 25: 0, 35: 75, 45: 75, 50: 100}, {50: 0, 100: 0, 200: 100}),
}

GROUPS = {
    "SMH/SOXL": og.GROUPS["smh"],
    "QQQ/SOXL": og.GROUPS["qs"],
    "QQQ/TQQQ": og.GROUPS["qqq"],
}


def max_dd(series):
    peak, worst = series[0], 0.0
    for v in series:
        if v > peak:
            peak = v
        if peak > 0:
            worst = min(worst, (v - peak) / peak * 100.0)
    return worst


def run(g, dd, rb, start):
    res = bt.run_backtest(CAP, CAP, dd, rb, g["csv_a"], g["csv_b"],
                          start_date=start, name_a=g["name_a"],
                          name_b=g["name_b"])
    return res


def common_window(g):
    sa = bt._load_close_series(g["csv_a"])
    sb = bt._load_close_series(g["csv_b"])
    return sorted(set(sa) & set(sb)), sa, sb


def main():
    # 三组的共同可比起点：取各组共同交易日首日的最晚者
    firsts, info = {}, {}
    for name, g in GROUPS.items():
        common, sa, sb = common_window(g)
        firsts[name] = common[0]
        info[name] = (common, sa, sb)
        print(f"{name:9s} 数据区间 {common[0]} -> {common[-1]}  "
              f"共 {len(common)} 个共同交易日")
    uni_start = max(firsts.values())
    uni_end = min(info[n][0][-1] for n in GROUPS)
    print(f"\n统一可比窗口起点 = {uni_start}，终点 = {uni_end}")

    for label, pair in [("各组自有推荐参数", None),
                        ("SMH 组参数", PARAMS["SMH"]),
                        ("QQQ 组参数", PARAMS["QQQ"])]:
        dd, rb = pair if pair else (None, None)
        print("\n" + "=" * 78)
        print(f"【{label}】统一窗口 {uni_start} -> {uni_end}（一次性投入 40000）")
        print("=" * 78)
        print(f"{'组合':10s}{'策略末值':>14s}{'倍数':>8s}{'最大回撤':>10s}"
              f"{'全程A':>12s}{'全程B':>12s}{'50-50':>12s}{'笔数':>6s}")
        for name, g in GROUPS.items():
            if dd is None:
                key = "SMH" if name == "SMH/SOXL" else "QQQ"
                p_dd, p_rb = PARAMS[key]
            else:
                p_dd, p_rb = dd, rb
            res = run(g, p_dd, p_rb, uni_start)
            eq = res["equity_strategy"]
            common, sa, sb = info[name]
            win = [d for d in common if d >= uni_start]
            ha = 2 * CAP / sa[win[0]] * sa[win[-1]]
            hb = 2 * CAP / sb[win[0]] * sb[win[-1]]
            fx = CAP / sa[win[0]] * sa[win[-1]] + CAP / sb[win[0]] * sb[win[-1]]
            print(f"{name:10s}{res['final_total']:>14,.0f}"
                  f"{res['final_total'] / (2 * CAP):>7.2f}x"
                  f"{max_dd(eq):>9.1f}%{ha:>12,.0f}{hb:>12,.0f}{fx:>12,.0f}"
                  f"{len(res['trades']):>6d}")

    # ---- 多起点稳健性：每年 1 月第一个交易日进场，跑到数据末日 ----
    print("\n" + "=" * 78)
    print("多起点稳健性（每年首个交易日进场 -> 数据末日，各组自有推荐参数）")
    print("=" * 78)
    years = sorted({d[:4] for d in info["SMH/SOXL"][0] if d >= uni_start})
    rows = {}
    for name, g in GROUPS.items():
        key = "SMH" if name == "SMH/SOXL" else "QQQ"
        p_dd, p_rb = PARAMS[key]
        common = info[name][0]
        vals, dds = [], []
        for y in years:
            cands = [d for d in common if d[:4] == y and d >= uni_start]
            if not cands:
                continue
            res = run(g, p_dd, p_rb, cands[0])
            vals.append(res["final_total"] / (2 * CAP))
            dds.append(max_dd(res["equity_strategy"]))
        rows[name] = (vals, dds)
    print(f"{'组合':10s}{'起点数':>7s}{'倍数中位':>10s}{'倍数最差':>10s}"
          f"{'倍数最好':>10s}{'回撤中位':>10s}{'回撤最差':>10s}")
    for name, (vals, dds) in rows.items():
        print(f"{name:10s}{len(vals):>7d}{st.median(vals):>9.2f}x"
              f"{min(vals):>9.2f}x{max(vals):>9.2f}x"
              f"{st.median(dds):>9.1f}%{min(dds):>9.1f}%")

    # ---- 分年度收益对比（看相对强弱来源）----
    print("\n" + "=" * 78)
    print("基准端/杠杆端标的本身的年度涨跌（%）")
    print("=" * 78)
    series = {
        "QQQ": info["QQQ/SOXL"][1],
        "SMH": info["SMH/SOXL"][1],
        "SOXL": info["SMH/SOXL"][2],
        "TQQQ": info["QQQ/TQQQ"][2],
    }
    print(f"{'年份':6s}" + "".join(f"{k:>10s}" for k in series))
    for y in years:
        line = f"{y:6s}"
        for k, s in series.items():
            ds = sorted(d for d in s if d[:4] == y and d >= uni_start)
            if len(ds) < 2:
                line += f"{'-':>10s}"
                continue
            line += f"{(s[ds[-1]] / s[ds[0]] - 1) * 100:>9.1f}%"
        print(line)


if __name__ == "__main__":
    main()