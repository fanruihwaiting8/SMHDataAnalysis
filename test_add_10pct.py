#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
测试：在 -10% 回撤处小幅加仓，最终收益是否比原策略更高？
==========================================================

原推荐策略在 -15%/-25%/-35% 等档位大批换仓（卖A买B）。
本脚本在保持原推荐档位不变的前提下，额外在 -10% 回撤处加入
不同比例的小幅加仓，对比最终总资金，回答：
  "跌到 10% 就先小幅加仓，最后收益会不会比等到 15%/35% 大批换仓更高？"

用法（必须用项目 .venv）：
  cd my-project/APP/SMHDataAnalysisBot
  .venv/bin/python test_add_10pct.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import backtest as bt

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "Input")

# 三组数据源 + 各自的推荐档位（与 main.py DATA_SOURCES 一致）
GROUPS = {
    "SMH": {
        "csv_a": "SMH_full_history.csv",
        "csv_b": "SOXL_full_history.csv",
        "name_a": "SMH", "name_b": "SOXL",
        "dd": {15: 0, 25: 0, 35: 100, 45: 0, 50: 0},
        "rb": {50: 0, 100: 0, 200: 100},
    },
    "QQQ": {
        "csv_a": "QQQ_full_history.csv",
        "csv_b": "TQQQ_full_history.csv",
        "name_a": "QQQ", "name_b": "TQQQ",
        "dd": {15: 60, 25: 0, 35: 100, 45: 0, 50: 0},
        "rb": {50: 0, 100: 100, 200: 0},
    },
    "USD": {
        "csv_a": "SMH_full_history.csv",
        "csv_b": "USD_full_history.csv",
        "name_a": "SMH", "name_b": "USD",
        "dd": {15: 0, 25: 45, 35: 100, 45: 0, 50: 0},
        "rb": {50: 0, 100: 0, 200: 100},
    },
}

# 在 -10% 处尝试的小幅加仓比例（0 = 原策略基准）
ADD_RATIOS = [0, 5, 10, 15, 20, 30, 50]


def run(key, add_10):
    """以 50-50 建仓跑一次回测；add_10>0 时在 -10% 档额外卖 A 买 B。"""
    g = GROUPS[key]
    csv_a = os.path.join(BASE, g["csv_a"])
    csv_b = os.path.join(BASE, g["csv_b"])
    dd = dict(g["dd"])
    rb = dict(g["rb"])
    if add_10 > 0:
        dd[10] = add_10
    # 引擎按模块常量 DRAWDOWN_LEVELS 遍历，临时加入 10 档
    old_levels = bt.DRAWDOWN_LEVELS
    bt.DRAWDOWN_LEVELS = sorted(set(old_levels) | {10})
    try:
        res = bt.run_backtest(500000, 500000, dd, rb, csv_a, csv_b)
    finally:
        bt.DRAWDOWN_LEVELS = old_levels
    return res


def main():
    for key in GROUPS:
        g = GROUPS[key]
        print("=" * 72)
        print(f"数据源：{g['name_a']} / {g['name_b']}")
        print(f"原推荐补仓档：{g['dd']}  减仓档：{g['rb']}")
        print("=" * 72)
        print(f"{'-10%加仓比例':>14}{'最终总资金':>16}{'相对原策略':>14}{'交易笔数':>10}")
        base_total = None
        for r in ADD_RATIOS:
            res = run(key, r)
            tot = res["final_total"]
            if base_total is None:
                base_total = tot
            diff = (tot / base_total - 1) * 100
            label = "0%（原策略）" if r == 0 else f"+{r}%"
            print(f"{label:>14}{tot:>16,.0f}{diff:>+13.2f}%{len(res['trades']):>10}")
        print()


if __name__ == "__main__":
    main()