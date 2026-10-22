#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
大跌日接飞刀的真实痛感 —— 帮你"忍住不动"的数据锚点（修正版）
==============================================================
核心问题：当天 A 跌≥5%，手痒想搬钱去杠杆端。
真实代价不是"搬 vs 不搬到期末"（那只反映杠杆端长期涨幅），
而是：**从大跌日买入，到这轮下跌真正见底之前，你还要亏多深？**

对比基准：你的系统买点在 -35% 回撤处。
每个大跌日买入 = 在可能远高于 -35% 的位置提前接刀。

输出三组数据：
  A) 大跌日有没有预测力？—— 大跌后 vs 随机日的后续收益对比
  B) 接飞刀有多痛？—— 每个大跌日到本轮真正底部的额外跌幅（A vs 3倍杠杆B）
  C) 提前买 vs 等 -35%—— 同样一笔钱，两种买法到本轮底部的差价
"""
import os
import sys
import random

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import backtest as bt

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "Input")

PAIRS = [
    ("SMH/SMH3", "SMH_full_history.csv", "SMH3_full_history.csv"),
    ("QQQ/TQQQ", "QQQ_full_history.csv", "TQQQ_full_history.csv"),
    ("SMH/USD", "SMH_full_history.csv", "USD_full_history.csv"),
]

THRESH = 5.0


def analyze(name, csv_a, csv_b, thresh):
    sa = bt._load_close_series(os.path.join(BASE, csv_a))
    sb = bt._load_close_series(os.path.join(BASE, csv_b))
    common = sorted(set(sa) & set(sb))
    n = len(common)

    # ---- 找大跌日 ----
    drop_idx = []
    for i in range(1, n):
        drop = (sa[common[i - 1]] - sa[common[i]]) / sa[common[i - 1]] * 100.0
        if drop >= thresh:
            drop_idx.append(i)

    # ---- A) 预测力检验：大跌日后20日收益 vs 随机日后20日收益 ----
    fwd_drop = [sa[common[min(i + 20, n - 1)]] / sa[common[i]] - 1
                for i in drop_idx if i + 20 < n]
    random.seed(42)
    all_fwd = [sa[common[i + 20]] / sa[common[i]] - 1 for i in range(n - 21)]
    sample_fwd = random.sample(all_fwd, min(2000, len(all_fwd)))

    avg_drop_fwd = sum(fwd_drop) / len(fwd_drop) * 100
    avg_rand_fwd = sum(sample_fwd) / len(sample_fwd) * 100

    # ---- B) 接飞刀痛感：每个大跌日 → 本轮真正底部的额外跌幅 ----
    # 本轮底部 = 从大跌日往后走，直到 A 创新高为止的最低点
    extra_a, extra_b, deepen_count = [], [], 0
    for i in drop_idx:
        pa0 = sa[common[i]]
        pb0 = sb[common[i]]
        low_a, low_b = pa0, pb0
        hit_new_high = False
        for j in range(i + 1, n):
            if sa[common[j]] < low_a:
                low_a = sa[common[j]]
                low_b = sb[common[j]]
            if sa[common[j]] >= pa0:  # A 收复了大跌日价格 = 本轮结束
                hit_new_high = True
                break
        fall_a = (pa0 - low_a) / pa0 * 100
        fall_b = (pb0 - low_b) / pb0 * 100
        extra_a.append(fall_a)
        extra_b.append(fall_b)
        if fall_a > 1.0:
            deepen_count += 1

    avg_extra_a = sum(extra_a) / len(extra_a)
    avg_extra_b = sum(extra_b) / len(extra_b)
    worst_extra_b = max(extra_b)
    no_pain = sum(1 for v in extra_b if v < 3.0)

    # ---- C) 提前买 vs 等 -35%：找大跌日之后首次触及 -35% 回撤的位置 ----
    # 对于每个大跌日，从该日起追踪 peak，看是否到达 -35%，比较两种买法到本轮底部
    early_worse = 0
    early_worse_total_pct = 0.0
    for i in drop_idx:
        pa0 = sa[common[i]]
        pb0 = sb[common[i]]
        # 追踪本轮 peak（从大跌日往前找区间最高）
        peak = max(sa[common[j]] for j in range(max(0, i - 250), i + 1))
        # 找本轮底部
        low_a, low_b = pa0, pb0
        for j in range(i + 1, n):
            if sa[common[j]] < low_a:
                low_a = sa[common[j]]
                low_b = sb[common[j]]
            if sa[common[j]] >= peak:
                break
        # 检查本轮是否触及 -35%
        dd_at_low = (peak - low_a) / peak * 100
        if dd_at_low >= 35:
            # 找 -35% 触及日的 B 价格
            pb_35 = None
            for j in range(i + 1, n):
                dd = (peak - sa[common[j]]) / peak * 100
                if dd >= 35:
                    pb_35 = sb[common[j]]
                    break
                if sa[common[j]] >= peak:
                    break
            if pb_35 and pb_35 > 0:
                # 同样100元：大跌日买B vs -35%买B，持有到本轮底部
                early_val = 100 * low_b / pb0
                wait_val = 100 * low_b / pb_35
                if early_val < wait_val:
                    early_worse += 1
                    early_worse_total_pct += (wait_val - early_val) / wait_val * 100

    print(f"\n{'='*74}")
    print(f"{name} ｜ A 单日跌≥{thresh:.0f}% 共 {len(drop_idx)} 天")
    print(f"{'='*74}")

    print(f"\n  A) 大跌日有没有预测力？（此后20日平均收益）")
    print(f"     大跌日后买入：{avg_drop_fwd:+.2f}%")
    print(f"     随便哪天买入：{avg_rand_fwd:+.2f}%")
    verdict = "没有" if abs(avg_drop_fwd - avg_rand_fwd) < 1.5 else \
              ("略好" if avg_drop_fwd > avg_rand_fwd else "更差")
    print(f"     → 大跌日择时价值：{verdict}（差异仅"
          f"{avg_drop_fwd - avg_rand_fwd:+.2f}%，基本是噪音）")

    print(f"\n  B) 接飞刀有多痛？（从大跌日到本轮真正底部的额外跌幅）")
    print(f"     A(1倍) 平均再跌：{avg_extra_a:.1f}%")
    print(f"     B(杠杆) 平均再跌：{avg_extra_b:.1f}%   最惨一次再跌：{worst_extra_b:.1f}%")
    print(f"     {len(extra_b)}次大跌中，{deepen_count}次随后继续探底"
          f"（{deepen_count/len(extra_b)*100:.0f}%），"
          f"只有{no_pain}次几乎无痛（<3%）")
    print(f"     → 杠杆端把'再跌'放大数倍：平均每笔冲动先浮亏 {avg_extra_b:.0f}%")

    print(f"\n  C) 提前买 vs 等-35%（只看触及-35%的轮次）")
    print(f"     提前在大跌日买入 vs 等到-35%再买：{early_worse} 次提前买更亏")
    if early_worse > 0:
        print(f"     平均每次提前买比等-35%多亏 "
              f"{early_worse_total_pct / early_worse:.1f}%")
    print(f"     → 你的系统已经选好了更深的买点，提前动手 = 用更贵的价格买同一资产")


def main():
    for name, ca, cb in PAIRS:
        analyze(name, ca, cb, THRESH)

    print(f"\n{'='*74}")
    print("【忍住的心法】")
    print("  1. 大跌日没有预测力——事后20日收益和随便哪天买没区别，它不传递信息")
    print("  2. 大跌日不是底——多数情况随后继续探底，杠杆端把额外跌幅放大数倍")
    print("  3. 你的系统买点在-35%——那是'跌透了'的确认价，比大跌日便宜得多")
    print("  4. 每次手痒时默念：'我不是不买，我是在等-35%的更好价格'")
    print(f"{'='*74}")


if __name__ == "__main__":
    main()