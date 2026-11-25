#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""SMH / USD（2 倍）组的「带护栏」参数搜索。

和 optimize_group_10y.py 的区别：那个脚本只最大化末日总资金，搜出来的
最优解必然是「浅档就把基准端全部换成杠杆端、深档无弹药」的激进解。
本脚本在同一业务模型上加三道护栏，用于回答「现在满仓杠杆合适吗」之后的
参数调整：

  1) 深档留弹药：补仓档 -15/-25/-35 用掉后，基准端剩余比例必须 >= RESERVE_MIN
     （剩余比例 = Π(1 - r_lv)），且 -45/-50 至少一档 > 0。
  2) 最大回撤硬约束：策略每日总市值的最大回撤必须 <= MAX_DD_LIMIT。
  3) 时间兜底：持杠杆端满 hold_days 个交易日仍未触发反弹减仓档时，
     强制换回基准端 hold_ratio 比例——堵住「+200% 换回线高于历史新高、
     长熊里永不触发 = 无限期满杠杆」这个结构漏洞。

搜索分三段，避免 Python 下 21^5 组合 × 逐日回撤计算的爆炸：
  Phase A 事件级快筛（复用 optimize_group_10y.fast_total，只算末值）
  Phase B 对 Phase A 的 TOPK 做逐日模拟，算最大回撤并过滤
  Phase C 对入选解做「时间兜底网格 + 多起点」稳健性评估

用法（需用项目 .venv）：
  cd my-project/APP/SMHDataAnalysisBot
  .venv/bin/python tools/optimize_usd_guarded.py            # 全量窗口
  .venv/bin/python tools/optimize_usd_guarded.py usd 10     # 步长 10 粗搜
"""
import os
import sys
import statistics

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE)
os.chdir(BASE)

import backtest as bt                      # noqa: E402
import optimize_group_10y as og            # noqa: E402

DD_LEVELS = bt.DRAWDOWN_LEVELS             # [15, 25, 35, 45, 50]
RB_LEVELS = bt.REBOUND_LEVELS              # [50, 100, 200]
TROUGH_TRIGGER = bt.TROUGH_TRIGGER_PCT     # 25.0

RESERVE_MIN = 0.20        # -35 档用完后基准端至少还剩 20%
MAX_DD_LIMIT = 0.60       # 期望的回撤上限（全量窗口实测无解，故改做前沿分析）
TOPK = 2000               # Phase A 进入逐日回撤校验的候选数
# 回撤-收益前沿分档：输出每档回撤上限下的最优解
DD_BUCKETS = [0.60, 0.65, 0.70, 0.75, 0.80, 0.85, 0.90]
# 时间兜底网格：持杠杆端满 N 个交易日仍未触发减仓档则强制换回 ratio
HOLD_GRID = [(378, 0.5), (378, 1.0), (504, 0.5), (504, 1.0),
             (756, 0.5), (756, 1.0)]

# 减仓档候选（全撤回 / 分批撤回 / 低档就开始撤）
RB_CANDS = [
    {50: 0, 100: 0, 200: 100},
    {50: 0, 100: 30, 200: 100},
    {50: 0, 100: 50, 200: 100},
    {50: 0, 100: 100, 200: 0},
    {50: 30, 100: 50, 200: 100},
    {50: 0, 100: 70, 200: 100},
]


def reserve_ok(dd_pcts):
    """浅档(-15/-25/-35)用完后基准端剩余比例是否达标，且深档有额度。"""
    left = 1.0
    for p in dd_pcts[:3]:
        left *= (1.0 - p / 100.0)
    if left < RESERVE_MIN - 1e-9:
        return False
    return (dd_pcts[3] + dd_pcts[4]) > 0


def simulate(ctx, dd_pcts, rb_pcts, hold_days=None, hold_ratio=1.0,
             i_from=0, w_lev=0.5):
    """逐日模拟，语义与 backtest.run_backtest 对齐（创新高当日仍判减仓、
    初始底部取建仓前 INIT_TROUGH_DAYS 区间最低价），额外支持时间兜底。

    i_from：在 ctx['common'] 中的起始下标，用于多起点评估。
    返回 dict(mult, mdd, n_exit, n_add, final)。
    """
    AP, BP = ctx["AP"], ctx["BP"]
    N = len(AP)
    dd_ratio = {lv: p / 100.0 for lv, p in zip(DD_LEVELS, dd_pcts)}
    rb_ratio = {lv: p / 100.0 for lv, p in zip(RB_LEVELS, rb_pcts)}
    a_sh = (1.0 - w_lev) / AP[i_from]
    b_sh = w_lev / BP[i_from]
    peak = AP[i_from]
    trough = ctx["trough_at"][i_from]
    dd_fired, rb_fired = set(), set()
    seg_active, seg_low = False, None
    lever_days = 0
    eq0 = a_sh * AP[i_from] + b_sh * BP[i_from]
    eq_peak, mdd = eq0, 0.0
    n_exit = n_add = 0
    for i in range(i_from + 1, N):
        p, pb = AP[i], BP[i]
        eq = a_sh * p + b_sh * pb
        if eq > eq_peak:
            eq_peak = eq
        dd_eq = eq / eq_peak - 1.0
        if dd_eq < mdd:
            mdd = dd_eq
        if b_sh * pb > 1e-9:
            lever_days += 1
        else:
            lever_days = 0

        is_new_high = p > peak
        if is_new_high:
            peak = p
            dd_fired.clear()
            seg_active, seg_low = False, None
            dd_pct = 0.0
        else:
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
                        n_add += 1
                    dd_fired.add(lv)
            if dd_pct >= TROUGH_TRIGGER:
                if not seg_active:
                    seg_active = True
                    trough = seg_low
                    rb_fired.clear()
                elif seg_low < trough:
                    trough = seg_low
                    rb_fired.clear()
        # 反弹减仓（创新高当日同样判定）
        rb_pct = (p - trough) / trough * 100.0 if trough and trough > 0 else 0.0
        for lv in RB_LEVELS:
            if lv in rb_fired:
                continue
            if rb_pct >= lv:
                r = rb_ratio[lv]
                if r > 0 and b_sh > 0:
                    move = b_sh * pb * r
                    b_sh -= move / pb
                    a_sh += move / p
                    n_exit += 1
                    lever_days = 0
                rb_fired.add(lv)
        # 时间兜底
        if (hold_days and lever_days >= hold_days and b_sh * pb > 1e-9
                and hold_ratio > 0):
            move = b_sh * pb * hold_ratio
            b_sh -= move / pb
            a_sh += move / p
            n_exit += 1
            lever_days = 0
    final = a_sh * AP[-1] + b_sh * BP[-1]
    return {"mult": final / eq0, "mdd": mdd, "n_exit": n_exit,
            "n_add": n_add, "final": final}


def build_trough_at(ctx):
    """每个下标 i 对应的「建仓日初始底部」，与 backtest.py 同口径。"""
    AP = ctx["AP"]
    out = []
    for i in range(len(AP)):
        lo = max(0, i - bt.INIT_TROUGH_DAYS)
        out.append(min(AP[lo:i + 1]))
    return out


def multi_start_idx(ctx):
    """多起点集合：每年 1/2 与 7/1 之后的第一个交易日（留 >=3 年窗口）。"""
    common = ctx["common"]
    last_year = int(common[-1][:4]) - 3
    idx, seen = [], set()
    for want in [f"{y}-{mmdd}" for y in range(int(common[0][:4]), last_year + 1)
                 for mmdd in ("01-02", "07-01")]:
        for i, d in enumerate(common):
            if d >= want:
                if i not in seen:
                    seen.add(i)
                    idx.append(i)
                break
    return idx


def grid_candidates(ctx, grid):
    """全网格（粗步长）候选，不按末值预筛，避免把保守解挤出池子。"""
    import itertools
    out = []
    for combo in itertools.product(*([grid] * 5)):
        if not reserve_ok(combo):
            continue
        for rb in RB_CANDS:
            out.append((combo, tuple(rb[lv] for lv in RB_LEVELS)))
    return out


def main():
    group = (sys.argv[1] if len(sys.argv) > 1 else "usd").lower()
    window = (sys.argv[2] if len(sys.argv) > 2 else "all").lower()
    step = int(sys.argv[3]) if len(sys.argv) > 3 else 25
    ctx = og.build_ctx(group, window, 0.0)
    ctx["trough_at"] = build_trough_at(ctx)
    AP, BP, common = ctx["AP"], ctx["BP"], ctx["common"]
    na, nb = ctx["g"]["name_a"], ctx["g"]["name_b"]

    print("=" * 78)
    print(f"{na} / {nb} 带护栏参数搜索  {common[0]} -> {common[-1]}  "
          f"({len(common)} 日)")
    print(f"护栏：-35 档后基准端剩余 >= {RESERVE_MIN:.0%}；"
          f"深档(-45/-50)须有额度；最大回撤 <= {MAX_DD_LIMIT:.0%}")
    print("=" * 78)

    # 对照：现行推荐参数
    cur_dd = [0, 80, 95, 100, 0]
    cur_rb = [0, 0, 100]
    r_cur = simulate(ctx, cur_dd, cur_rb)
    hold_a = AP[-1] / AP[0]
    hold_b = BP[-1] / BP[0]
    fixed = 0.5 * hold_a + 0.5 * hold_b
    print(f"全程 {na}={hold_a:,.1f}x   全程 {nb}={hold_b:,.1f}x   "
          f"50-50 不动={fixed:,.1f}x")
    print(f"现行推荐 dd={cur_dd} rb={cur_rb} -> {r_cur['mult']:,.1f}x  "
          f"最大回撤 {r_cur['mdd']*100:.1f}%  "
          f"补仓{r_cur['n_add']}笔/减仓{r_cur['n_exit']}笔")

    # 回撤下界诊断：完全不补仓(50-50 不动)就是本机制能做到的最浅回撤
    r_fix = simulate(ctx, [0, 0, 0, 0, 0], [0, 0, 0])
    print(f"回撤下界诊断：50-50 不动 {r_fix['mult']:,.1f}x  "
          f"最大回撤 {r_fix['mdd']*100:.1f}%  "
          f"→ 任何补仓方案的回撤都不会比它更浅")

    # 初始配比诊断：回撤主要由初始杠杆端占比决定，不是补仓档能左右的
    print(f"\n初始配比诊断（不补不减，看回撤由谁决定）")
    print(f"{'杠杆端初始占比':<16}{'倍数':>10}{'最大回撤':>11}")
    print("-" * 40)
    for w in [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.75, 1.0]:
        rw = simulate(ctx, [0, 0, 0, 0, 0], [0, 0, 0], w_lev=w)
        print(f"{format(w, '.0%'):<16}{rw['mult']:>10,.1f}"
              f"{rw['mdd']*100:>10.1f}%")

    grid = list(range(0, 101, step))
    cands = grid_candidates(ctx, grid)
    print(f"\n全网格候选(步长{step})：{len(cands)} 个，逐日模拟中…")

    # Phase B：逐日模拟，记录 (倍数, 最大回撤)，不做二元过滤
    pool = []   # (mult, dd_pcts, rbp, hold_days, hold_ratio, r)
    for dd_pcts, rbp in cands:
        r = simulate(ctx, dd_pcts, list(rbp))
        pool.append((r["mult"], dd_pcts, rbp, None, 0.0, r))
    pool.sort(key=lambda t: -t[0])

    # Phase B2：对「收益靠前」与「回撤最浅」两头叠加时间兜底
    seeds = pool[:25] + sorted(pool, key=lambda t: -t[5]["mdd"])[:25]
    for _m, dd_pcts, rbp, _hd, _hr, _r in seeds:
        for hd, hr in HOLD_GRID:
            r = simulate(ctx, dd_pcts, list(rbp), hold_days=hd,
                         hold_ratio=hr)
            pool.append((r["mult"], dd_pcts, rbp, hd, hr, r))

    def label(dd_pcts, rbp, hd, hr):
        s = f"dd={list(dd_pcts)} rb={list(rbp)}"
        if hd:
            s += f" 兜底{hd}日减{int(hr * 100)}%"
        return s

    print(f"\nPhase B 回撤-收益前沿（共评估 {len(pool)} 个方案）")
    print(f"{'回撤上限':<10}{'倍数':>10}  方案")
    print("-" * 94)
    frontier = []
    for cap in DD_BUCKETS:
        ok = [x for x in pool if x[5]["mdd"] >= -cap]
        if not ok:
            print(f"{'<=' + format(cap, '.0%'):<10}{'无解':>10}")
            continue
        bestx = max(ok, key=lambda t: t[0])
        frontier.append((cap, bestx))
        print(f"{'<=' + format(cap, '.0%'):<10}{bestx[0]:>10,.1f}  "
              f"{label(bestx[1], bestx[2], bestx[3], bestx[4])}"
              f"  [实际回撤 {bestx[5]['mdd'] * 100:.1f}%]")

    if not frontier:
        print("全部方案回撤均 > 90%，护栏需从机制层面改")
        return

    # Phase C：多起点稳健性
    idxs = multi_start_idx(ctx)
    print(f"\nPhase C 多起点 n={len(idxs)}（{common[idxs[0]]} ~ "
          f"{common[idxs[-1]]}）")
    print(f"{'方案':<52}{'中位':>9}{'最差':>9}{'最深回撤':>11}"
          f"{'全窗倍数':>11}{'全窗回撤':>10}")
    print("-" * 110)
    plans = [("现行 dd=[0,80,95,100,0] rb=[0,0,100]", cur_dd, cur_rb,
              None, 0.0)]
    seen = set()
    for cap, x in frontier:
        key = (x[1], x[2], x[3], x[4])
        if key in seen:
            continue
        seen.add(key)
        plans.append((f"<={cap:.0%} 档 " + label(x[1], x[2], x[3], x[4]),
                      list(x[1]), list(x[2]), x[3], x[4]))
    # 人工方案：在最优解基础上把深档也留出额度，并叠加时间兜底
    if frontier:
        b_dd, b_rb = list(frontier[0][1][1]), list(frontier[0][1][2])
        for hd in (378, 504, 756):
            plans.append((f"最优+兜底{hd}日全撤", b_dd, b_rb, hd, 1.0))
        for man in ([0, 0, 75, 75, 100], [0, 0, 50, 75, 100],
                    [0, 25, 50, 75, 100]):
            plans.append((f"手工留深档 dd={man} rb={b_rb}", man, b_rb,
                          None, 0.0))
            plans.append((f"手工留深档 dd={man} +兜底504日全撤", man, b_rb,
                          504, 1.0))
    for name, dd_pcts, rbp, hd, hr in plans:
        rows = [simulate(ctx, dd_pcts, rbp, hold_days=hd, hold_ratio=hr,
                         i_from=i) for i in idxs]
        ms = [x["mult"] for x in rows]
        r_full = simulate(ctx, dd_pcts, rbp, hold_days=hd, hold_ratio=hr)
        print(f"{name:<52}{statistics.median(ms):>9,.1f}{min(ms):>9,.2f}"
              f"{min(x['mdd'] for x in rows) * 100:>10.1f}%"
              f"{r_full['mult']:>10,.1f}{r_full['mdd'] * 100:>9.1f}%")

    pick = None
    for cap, x in frontier:
        if cap <= MAX_DD_LIMIT + 1e-9:
            pick = x
            break
    if pick is None:
        pick = frontier[0][1]
    print("\n# 复制到 main.py DATA_SOURCES['USD'] / web/app.js REC_BY_SOURCE")
    print(f"recommend_dd = {dict(zip(DD_LEVELS, pick[1]))}")
    print(f"recommend_rb = {dict(zip(RB_LEVELS, pick[2]))}")
    if pick[3]:
        print(f"# 另需时间兜底：持杠杆端满 {pick[3]} 个交易日强制减 "
              f"{int(pick[4] * 100)}%")


if __name__ == "__main__":
    main()