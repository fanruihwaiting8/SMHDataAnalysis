#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
测试：单日大跌触发换仓 —— "当天1倍指数跌≥4%就换5%到杠杆端"
============================================================

与现有【回撤触发】（相对历史新高 peak 跌 X%）不同，本脚本测试
【单日跌幅触发】：当天 A（1倍基准）相对前一日收盘跌 ≥ threshold%，
就卖出当前 A 市值的 ratio% 换入 B（杠杆端）。

对比模式：
  1) 原策略（纯回撤/反弹档位）—— 基准
  2) 原策略 + 单日大跌（每个达标日都触发）
  3) 原策略 + 单日大跌（每轮新高周期最多触发1次）
  4) 仅单日大跌买入 + 原反弹减仓（无回撤档位，测试日跌能否替代回撤档）

用法（必须用项目 .venv）：
  cd my-project/APP/SMHDataAnalysisBot
  .venv/bin/python test_daily_drop.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import backtest as bt

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "Input")

GROUPS = {
    "SMH": {
        "csv_a": "SMH_full_history.csv", "csv_b": "SMH3_full_history.csv",
        "name_a": "SMH", "name_b": "SMH3",
        "dd": {15: 0, 25: 0, 35: 100, 45: 0, 50: 0},
        "rb": {50: 0, 100: 0, 200: 100},
    },
    "QQQ": {
        "csv_a": "QQQ_full_history.csv", "csv_b": "TQQQ_full_history.csv",
        "name_a": "QQQ", "name_b": "TQQQ",
        "dd": {15: 60, 25: 0, 35: 100, 45: 0, 50: 0},
        "rb": {50: 0, 100: 100, 200: 0},
    },
    "USD": {
        "csv_a": "SMH_full_history.csv", "csv_b": "USD_full_history.csv",
        "name_a": "SMH", "name_b": "USD",
        "dd": {15: 0, 25: 45, 35: 100, 45: 0, 50: 0},
        "rb": {50: 0, 100: 0, 200: 100},
    },
}


def simulate(csv_a, csv_b, cap_a, cap_b, dd, rb,
             drop_thresh=0.0, drop_ratio=0.0, drop_once_per_cycle=False):
    """在原回撤/反弹逻辑基础上，叠加单日大跌触发。返回(末值,回撤笔数,日跌笔数,反弹笔数)。"""
    sa = bt._load_close_series(csv_a)
    sb = bt._load_close_series(csv_b)
    common = sorted(set(sa) & set(sb))
    p_a0, p_b0 = sa[common[0]], sb[common[0]]
    sh_a, sh_b = cap_a / p_a0, cap_b / p_b0

    peak = p_a0
    active_trough = p_a0
    dd_fired, rb_fired = set(), set()
    seg_active, seg_low = False, None
    prev_a = p_a0
    drop_fired = False
    n_dd = n_drop = n_rb = 0

    for date in common[1:]:
        pa, pb = sa[date], sb[date]
        day_drop = (prev_a - pa) / prev_a * 100.0
        prev_a = pa

        # ===== 单日大跌触发（新增逻辑，每个达标日均可触发）=====
        if (drop_thresh > 0 and drop_ratio > 0 and sh_a > 0
                and day_drop >= drop_thresh
                and not (drop_once_per_cycle and drop_fired)):
            move = sh_a * pa * (drop_ratio / 100.0)
            sh_a -= move / pa
            sh_b += move / pb
            n_drop += 1
            drop_fired = True

        # ===== 以下与 backtest.py 原逻辑一致 =====
        if pa > peak:
            peak = pa
            dd_fired.clear()
            drop_fired = False
            seg_active, seg_low = False, None
            continue

        if seg_low is None or pa < seg_low:
            seg_low = pa

        dd_pct = (peak - pa) / peak * 100.0
        for lv in bt.DRAWDOWN_LEVELS:
            if lv in dd_fired:
                continue
            if dd_pct >= lv:
                sr = dd.get(lv, 0.0) / 100.0
                if sr > 0 and sh_a > 0:
                    move = sh_a * pa * sr
                    sh_a -= move / pa
                    sh_b += move / pb
                    n_dd += 1
                dd_fired.add(lv)

        if dd_pct >= bt.TROUGH_TRIGGER_PCT:
            if not seg_active:
                seg_active = True
                active_trough = seg_low
                rb_fired.clear()
            elif seg_low < active_trough:
                active_trough = seg_low
                rb_fired.clear()

        rb_pct = ((pa - active_trough) / active_trough * 100.0
                  if active_trough and active_trough > 0 else 0.0)
        for lv in bt.REBOUND_LEVELS:
            if lv in rb_fired:
                continue
            if rb_pct >= lv:
                sr = rb.get(lv, 0.0) / 100.0
                if sr > 0 and sh_b > 0:
                    move = sh_b * pb * sr
                    sh_b -= move / pb
                    sh_a += move / pa
                    n_rb += 1
                rb_fired.add(lv)

    final = sh_a * sa[common[-1]] + sh_b * sb[common[-1]]
    return final, n_dd, n_drop, n_rb


def main():
    # (单日跌幅阈值%, 换仓比例%)
    CASES = [(3.0, 5), (4.0, 5), (5.0, 5), (4.0, 10), (4.0, 20)]

    for key in GROUPS:
        g = GROUPS[key]
        csv_a = os.path.join(BASE, g["csv_a"])
        csv_b = os.path.join(BASE, g["csv_b"])
        sa = bt._load_close_series(csv_a)
        sb = bt._load_close_series(csv_b)
        common = sorted(set(sa) & set(sb))

        base, _, _, _ = simulate(csv_a, csv_b, 500000, 500000, g["dd"], g["rb"])
        g_a = sa[common[-1]] / sa[common[0]]
        g_b = sb[common[-1]] / sb[common[0]]
        t_5050 = (0.5 * g_a + 0.5 * g_b) * 1000000
        t_hold_b = g_b * 1000000

        print("=" * 78)
        print(f"数据源：{g['name_a']} / {g['name_b']}"
              f"  （{common[0]} ~ {common[-1]}，共 {len(common)} 交易日）")
        print(f"原推荐补仓档：{g['dd']}  减仓档：{g['rb']}")
        print("=" * 78)
        print(f"{'方案':<34}{'最终总资金':>14}{'相对原策略':>12}{'日跌触发':>10}")
        print("-" * 78)
        print(f"{'50-50 不动':<34}{t_5050:>14,.0f}{(t_5050/base-1)*100:>+11.2f}%{'—':>10}")
        print(f"{'全程持 ' + g['name_b'] + '（杠杆端）':<34}{t_hold_b:>14,.0f}"
              f"{(t_hold_b/base-1)*100:>+11.2f}%{'—':>10}")
        print(f"{'原策略（纯回撤/反弹）':<34}{base:>14,.0f}{'基准':>12}{'—':>10}")
        print("-" * 78)

        dd0 = {lv: 0 for lv in bt.DRAWDOWN_LEVELS}
        MODES = [
            ("原策略+日跌(每达标日)", False, g["dd"]),
            ("原策略+日跌(每轮新高≤1次)", True, g["dd"]),
            ("仅日跌买入+原反弹(无回撤档)", False, dd0),
        ]
        for mode_name, once, dd_dict in MODES:
            print(f"【{mode_name}】")
            for th, r in CASES:
                tot, n_dd, n_drop, n_rb = simulate(
                    csv_a, csv_b, 500000, 500000, dd_dict, g["rb"],
                    drop_thresh=th, drop_ratio=r, drop_once_per_cycle=once)
                diff = (tot / base - 1) * 100
                mark = " ←你问的" if (th == 4.0 and r == 5) else ""
                print(f"  日跌≥{th:.0f}% 换{r:>2}%"
                      f"{tot:>24,.0f}{diff:>+11.2f}%{n_drop:>8}次{mark}")
            print()


if __name__ == "__main__":
    main()