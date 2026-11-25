#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""带护栏 + 鲁棒性的「参数推荐区间」搜索。

和既有脚本的差别：
  · optimize_group_10y.py  —— 只最大化全窗口末值，输出单点最优（易过拟合）
  · tools/optimize_usd_guarded.py —— 加了回撤护栏，但仍只给单点
  · 本脚本 —— 给出每一档的「推荐区间」：在「通过护栏 + 多起点鲁棒」的
    近优解集合里，统计每档取值的分位区间，作为推荐带宽；区间中心作为
    默认值。这样参数不再是一个脆弱的单点，带内任取一值表现都接近。

三段式：
  Phase 1  全窗口逐日模拟整个粗网格，拿到 (倍数, 最大回撤)
  Phase 2  过护栏（最大回撤 <= CAP，深档留弹药），按全窗口倍数取 TOPK，
           做多起点评估（每年 1/7 月各一个进场点），得到「中位倍数 /
           最差倍数 / 最深回撤」
  Phase 3  以「中位倍数 >= 最优的 KEEP 比例」且「最差倍数 >= 最优最差的
           KEEP_WORST 比例」筛出近优鲁棒解集，统计每档取值区间输出

用法（需用项目 .venv）：
  cd my-project/APP/SMHDataAnalysisBot
  .venv/bin/python tools/optimize_robust_bands.py smh 10y
  .venv/bin/python tools/optimize_robust_bands.py qs all 25 0.85
"""
import os
import sys
import itertools
import statistics as st

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE)
os.chdir(BASE)

import backtest as bt                      # noqa: E402
import optimize_group_10y as og            # noqa: E402
from optimize_usd_guarded import (          # noqa: E402
    simulate, build_trough_at, multi_start_idx,
)

DD_LEVELS = bt.DRAWDOWN_LEVELS             # [15, 25, 35, 45, 50]
RB_LEVELS = bt.REBOUND_LEVELS              # [50, 100, 200]

# 每组各自的回撤护栏（按该组「50-50 不动」的回撤下界上浮一点给出，
# 太紧会无解——最大回撤主要由初始配比决定，补仓档压不下来）。
DD_CAP = {"smh": 0.82, "usd": 0.60, "qqq": 0.75, "qs": 0.85, "lev4": 0.90}
RESERVE_MIN = 0.15        # -15/-25/-35 三档用完后，基准端至少还剩 15%
TOPK = 160                # 进入多起点评估的候选数
KEEP = 0.85               # 近优集合：中位倍数 >= 最优中位 × KEEP
KEEP_WORST = 0.70         # 且最差起点倍数 >= 最优方案最差倍数 × KEEP_WORST

RB_CANDS = [
    {50: 0, 100: 0, 200: 100},
    {50: 0, 100: 30, 200: 100},
    {50: 0, 100: 50, 200: 100},
    {50: 0, 100: 70, 200: 100},
    {50: 0, 100: 100, 200: 0},
    {50: 30, 100: 50, 200: 100},
    {50: 50, 100: 100, 200: 0},
]


def reserve_ok(dd_pcts):
    left = 1.0
    for p in dd_pcts[:3]:
        left *= (1.0 - p / 100.0)
    return left >= RESERVE_MIN - 1e-9


def band(vals):
    """给一组取值算推荐区间：[p25, p75]，中心取中位数（对齐到 5 的倍数）。"""
    s = sorted(vals)
    n = len(s)
    lo = s[max(0, int(n * 0.25) - (1 if n * 0.25 == int(n * 0.25) else 0))]
    hi = s[min(n - 1, int(n * 0.75))]
    mid = st.median(s)
    mid5 = int(round(mid / 5.0) * 5)
    return lo, hi, mid5


def main():
    group = (sys.argv[1] if len(sys.argv) > 1 else "smh").lower()
    window = (sys.argv[2] if len(sys.argv) > 2 else "10y").lower()
    step = int(sys.argv[3]) if len(sys.argv) > 3 else 25
    cap = float(sys.argv[4]) if len(sys.argv) > 4 else DD_CAP.get(group, 0.85)

    ctx = og.build_ctx(group, window, 0.0)
    ctx["trough_at"] = build_trough_at(ctx)
    AP, BP, common = ctx["AP"], ctx["BP"], ctx["common"]
    na, nb = ctx["g"]["name_a"], ctx["g"]["name_b"]

    print("=" * 84)
    print(f"{na} / {nb}  参数推荐区间搜索   {common[0]} -> {common[-1]} "
          f"({len(common)} 日, {ctx['label']})")
    print(f"护栏：最大回撤 <= {cap:.0%}；-35 档后基准端剩余 >= "
          f"{RESERVE_MIN:.0%}；网格步长 {step}")
    print("=" * 84)

    r_fix = simulate(ctx, [0] * 5, [0] * 3)
    print(f"基准：全程{na} {AP[-1] / AP[0]:,.1f}x   "
          f"全程{nb} {BP[-1] / BP[0]:,.1f}x   "
          f"50-50 不动 {r_fix['mult']:,.1f}x（回撤 {r_fix['mdd'] * 100:.1f}%，"
          f"即本机制回撤下界）")

    # ---- Phase 1：全窗口粗网格 ----
    grid = list(range(0, 101, step))
    combos = [c for c in itertools.product(*([grid] * 5)) if reserve_ok(c)]
    print(f"\nPhase 1  网格 {len(combos)} × 减仓候选 {len(RB_CANDS)} = "
          f"{len(combos) * len(RB_CANDS)} 个方案，全窗口逐日模拟中…")
    pool = []
    for dd_pcts in combos:
        for rb in RB_CANDS:
            rbp = [rb[lv] for lv in RB_LEVELS]
            r = simulate(ctx, dd_pcts, rbp)
            if r["mdd"] < -cap:
                continue
            pool.append((r["mult"], dd_pcts, tuple(rbp), r["mdd"]))
    if not pool:
        print(f"护栏 {cap:.0%} 下无解——该组回撤下界为 "
              f"{r_fix['mdd'] * 100:.1f}%，请放宽 cap")
        return
    pool.sort(key=lambda t: -t[0])
    print(f"  过护栏方案 {len(pool)} 个，全窗口最优 {pool[0][0]:,.1f}x "
          f"(回撤 {pool[0][3] * 100:.1f}%) dd={list(pool[0][1])} "
          f"rb={list(pool[0][2])}")

    # ---- Phase 2：多起点鲁棒性评估 ----
    idxs = multi_start_idx(ctx)
    cands = pool[:TOPK]
    print(f"\nPhase 2  对前 {len(cands)} 个方案做 {len(idxs)} 个进场点评估"
          f"（{common[idxs[0]]} ~ {common[idxs[-1]]}）…")
    scored = []
    for mult, dd_pcts, rbp, mdd in cands:
        rows = [simulate(ctx, dd_pcts, list(rbp), i_from=i) for i in idxs]
        ms = [x["mult"] for x in rows]
        scored.append({
            "dd": dd_pcts, "rb": rbp, "full": mult, "mdd": mdd,
            "med": st.median(ms), "worst": min(ms),
            "worst_mdd": min(x["mdd"] for x in rows),
        })
    scored.sort(key=lambda d: -d["med"])

    print(f"\n  前 12 名（按多起点中位倍数）")
    print(f"  {'dd':<24}{'rb':<18}{'全窗倍数':>10}{'全窗回撤':>10}"
          f"{'中位':>9}{'最差':>8}{'最深回撤':>10}")
    print("  " + "-" * 92)
    for d in scored[:12]:
        print(f"  {str(list(d['dd'])):<24}{str(list(d['rb'])):<18}"
              f"{d['full']:>10,.1f}{d['mdd'] * 100:>9.1f}%"
              f"{d['med']:>9,.1f}{d['worst']:>8,.2f}"
              f"{d['worst_mdd'] * 100:>9.1f}%")

    # ---- Phase 3：近优鲁棒集合 -> 每档推荐区间 ----
    best = scored[0]
    keep = [d for d in scored
            if d["med"] >= best["med"] * KEEP
            and d["worst"] >= best["worst"] * KEEP_WORST]
    print(f"\nPhase 3  近优鲁棒集合：中位 >= {best['med'] * KEEP:,.1f}x 且 "
          f"最差 >= {best['worst'] * KEEP_WORST:,.2f}x -> {len(keep)} 个方案")

    print(f"\n  ---- 加杠杆（回撤补仓）推荐区间 ----")
    centers_dd = []
    for k, lv in enumerate(DD_LEVELS):
        vals = [d["dd"][k] for d in keep]
        lo, hi, mid = band(vals)
        centers_dd.append(mid)
        act = sum(1 for v in vals if v > 0) / len(vals) * 100
        print(f"  {na} 回撤 -{lv:<3}% -> 换 {lo:>3.0f}~{hi:<3.0f}% "
              f"(推荐 {mid:>3d}%)   该档被启用占比 {act:.0f}%")
    print(f"  ---- 去杠杆（反弹减仓）推荐区间 ----")
    centers_rb = []
    for k, lv in enumerate(RB_LEVELS):
        vals = [d["rb"][k] for d in keep]
        lo, hi, mid = band(vals)
        centers_rb.append(mid)
        act = sum(1 for v in vals if v > 0) / len(vals) * 100
        print(f"  {na} 反弹 +{lv:<3}% -> 撤 {lo:>3.0f}~{hi:<3.0f}% "
              f"(推荐 {mid:>3d}%)   该档被启用占比 {act:.0f}%")

    # 区间中心本身是否也站得住（区间统计出来的中心未必在集合里）
    r_mid = simulate(ctx, centers_dd, centers_rb)
    rows = [simulate(ctx, centers_dd, centers_rb, i_from=i) for i in idxs]
    ms = [x["mult"] for x in rows]
    print(f"\n  区间中心 dd={centers_dd} rb={centers_rb}")
    print(f"    全窗口 {r_mid['mult']:,.1f}x  回撤 {r_mid['mdd'] * 100:.1f}%"
          f"   多起点中位 {st.median(ms):,.1f}x  最差 {min(ms):,.2f}x")

    # ---- 邻域扰动：每档 ±step 看表现衰减 ----
    print(f"\n  邻域扰动（在推荐中心上单档 ±{step} pp）")
    print(f"  {'扰动':<22}{'全窗倍数':>10}{'全窗回撤':>10}{'多起点中位':>12}"
          f"{'最差':>9}")
    print("  " + "-" * 66)
    perturb = [("基线（推荐中心）", centers_dd, centers_rb)]
    for k, lv in enumerate(DD_LEVELS):
        for sgn in (-1, 1):
            v = centers_dd[k] + sgn * step
            if v < 0 or v > 100:
                continue
            d2 = list(centers_dd)
            d2[k] = v
            perturb.append((f"补仓 -{lv}% -> {v}%", d2, centers_rb))
    for k, lv in enumerate(RB_LEVELS):
        for sgn in (-1, 1):
            v = centers_rb[k] + sgn * step
            if v < 0 or v > 100:
                continue
            r2 = list(centers_rb)
            r2[k] = v
            perturb.append((f"减仓 +{lv}% -> {v}%", centers_dd, r2))
    for name, d2, r2 in perturb:
        rf = simulate(ctx, d2, r2)
        rr = [simulate(ctx, d2, r2, i_from=i)["mult"] for i in idxs]
        print(f"  {name:<22}{rf['mult']:>10,.1f}{rf['mdd'] * 100:>9.1f}%"
              f"{st.median(rr):>12,.1f}{min(rr):>9,.2f}")

    print(f"\n# 推荐写入 main.py DATA_SOURCES / web/app.js REC_BY_SOURCE")
    print(f"recommend_dd = {dict(zip(DD_LEVELS, centers_dd))}")
    print(f"recommend_rb = {dict(zip(RB_LEVELS, centers_rb))}")


if __name__ == "__main__":
    main()