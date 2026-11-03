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
  .venv/bin/python optimize_group_10y.py smh          # 默认最近 10 年
  .venv/bin/python optimize_group_10y.py smh all      # 全量历史窗口
  .venv/bin/python optimize_group_10y.py usd 15y      # 最近 15 年
  .venv/bin/python optimize_group_10y.py smh all 1    # 全量窗口 + 每月定投 1%
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


def build_ctx(group_key: str, window: str = "10y", dca_pct: float = 0.0):
    """window 取 'all'(全量) 或 'Ny'(最近 N 年，如 10y / 15y)。

    dca_pct > 0 时启用「每月定投」口径：每月第一个共同交易日注入
    (CAP_A+CAP_B) × dca_pct%，注入额全部买入基准端 A（口径与
    web/backtest.js、tools/optimize_dca.js 完全一致）。
    """
    g = GROUPS[group_key]
    sa = bt._load_close_series(g["csv_a"])
    sb = bt._load_close_series(g["csv_b"])
    all_common = sorted(set(sa) & set(sb))
    last = _dt.date.fromisoformat(all_common[-1])
    if window == "all":
        start_date = all_common[0]
        label = "全量窗口"
    else:
        years = int(window.rstrip("yY") or 10)
        try:
            cut = last.replace(year=last.year - years)
        except ValueError:
            cut = last.replace(year=last.year - years, day=28)
        start_date = max(cut.isoformat(), all_common[0])
        label = f"最近 {years} 年窗口"
    common = [d for d in all_common if d >= start_date]
    ctx = {
        "g": g, "all_common": all_common, "common": common,
        "AP": [sa[d] for d in common], "BP": [sb[d] for d in common],
        "N": len(common), "start_date": start_date,
        "total": CAP_A + CAP_B, "label": label,
    }
    ctx["events"] = build_events(ctx["AP"])
    # 定投口径：预计算「每投入 1 元累计可买到的 A 份额」，
    # 注入与持仓无关、纯加性，故可在搜索前算一次。
    ctx["mc"] = (CAP_A + CAP_B) * dca_pct / 100.0
    ctx["dca_pct"] = dca_pct
    ucum = [0.0] * ctx["N"]
    last_month = common[0][:7]
    for i in range(1, ctx["N"]):
        ucum[i] = ucum[i - 1]
        ym = common[i][:7]
        if ym != last_month:
            last_month = ym
            ucum[i] += 1.0 / ctx["AP"][i]
    ctx["ucum"] = ucum
    return ctx


def build_events(AP):
    """预计算补仓/减仓触发事件序列。

    触发时点只取决于基准端 A 的价格序列（新高清空补仓已触发档、
    新低重置反弹基准），与各档位的「卖出比例」参数无关，因此可以
    在网格搜索前算一次，之后每个参数组合只需遍历几十个事件，
    而不是几千个交易日。
    返回 [(i, kind, level)]，kind=0 补仓 / 1 减仓。
    """
    N = len(AP)
    events = []
    peak = AP[0]
    active_trough = AP[0]
    dd_fired, rb_fired = set(), set()
    seg_active, seg_low = False, None
    for i in range(1, N):
        p = AP[i]
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
                events.append((i, 0, lv))
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
                events.append((i, 1, lv))
                rb_fired.add(lv)
    return events


def fast_total(ctx, dd_pcts, rb_pcts):
    """按预计算事件序列做纯计算回测，返回末日总资金。

    定投口径下，每月注入的现金全额买入基准端 A，而「注入份额」本身
    与持仓无关（只取决于注入日价格），且后续所有调仓都是按比例的线性
    变换，所以可以把两个事件之间累计的注入份额一次性补到事件发生前，
    结果与逐日注入完全一致（由 fast_total_slow 对拍验证）。
    """
    AP, BP = ctx["AP"], ctx["BP"]
    dd_ratio = {lv: p / 100.0 for lv, p in zip(DD_LEVELS, dd_pcts)}
    rb_ratio = {lv: p / 100.0 for lv, p in zip(RB_LEVELS, rb_pcts)}
    a_sh = CAP_A / AP[0]
    b_sh = CAP_B / BP[0]
    mc = ctx.get("mc", 0.0)
    ucum = ctx.get("ucum")
    prev = 0
    for i, kind, lv in ctx["events"]:
        r = dd_ratio[lv] if kind == 0 else rb_ratio[lv]
        if r <= 0:
            continue
        if mc > 0:
            a_sh += mc * (ucum[i] - ucum[prev])
            prev = i
        p, pb = AP[i], BP[i]
        if kind == 0:
            if a_sh > 0:
                move = a_sh * p * r
                a_sh -= move / p
                b_sh += move / pb
        else:
            if b_sh > 0:
                move = b_sh * pb * r
                b_sh -= move / pb
                a_sh += move / p
    if mc > 0:
        a_sh += mc * (ucum[-1] - ucum[prev])
    return a_sh * AP[-1] + b_sh * BP[-1]


def fast_total_slow(ctx, dd_pcts, rb_pcts):
    """内联纯计算回测（逻辑同 backtest.run_backtest），返回末日总资金。

    定投口径下严格逐日注入，用于和 fast_total 的事件级实现对拍。
    """
    AP, BP, N = ctx["AP"], ctx["BP"], ctx["N"]
    YM = [d[:7] for d in ctx["common"]]
    mc = ctx.get("mc", 0.0)
    last_month = YM[0]
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
        if mc > 0 and YM[i] != last_month:
            last_month = YM[i]
            a_sh += mc / p
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
    window = (sys.argv[2] if len(sys.argv) > 2 else "10y").lower()
    dca_pct = float(sys.argv[3]) if len(sys.argv) > 3 else 0.0
    if group_key not in GROUPS:
        print(f"未知分组 {group_key}，可选: {list(GROUPS)}")
        sys.exit(1)

    ctx = build_ctx(group_key, window, dca_pct)
    g, common, N = ctx["g"], ctx["common"], ctx["N"]
    AP, BP, total = ctx["AP"], ctx["BP"], ctx["total"]
    na, nb_ = g["name_a"], g["name_b"]

    print("=" * 60)
    print(f"{na} / {nb_} 加减仓策略分析（{ctx['label']}）")
    print("=" * 60)
    print(f"全量数据: {ctx['all_common'][0]} -> {ctx['all_common'][-1]}")
    print(f"{ctx['label']}: {common[0]} -> {common[-1]}  共 {N} 个交易日")
    print(f"初始资金: {na} {CAP_A:,.0f} + {nb_} {CAP_B:,.0f} = {total:,.0f}")
    if dca_pct > 0:
        print(f"月度定投: {dca_pct}% = 每月 {ctx['mc']:,.0f} 全额买入 {na}")
    print(f"{na}  {common[0]}={AP[0]:.4f} -> {common[-1]}={AP[-1]:.4f} "
          f"(×{AP[-1] / AP[0]:.2f})")
    print(f"{nb_} {common[0]}={BP[0]:.4f} -> {common[-1]}={BP[-1]:.4f} "
          f"(×{BP[-1] / BP[0]:.2f})")

    hold_a = total / AP[0] * AP[-1]
    hold_b = total / BP[0] * BP[-1]
    fixed = (total / 2) / AP[0] * AP[-1] + (total / 2) / BP[0] * BP[-1]
    if dca_pct > 0:
        # 同样现金流下的对照：定投额全额买入 A，不做任何调仓
        fixed = fast_total(ctx, [0] * 5, [0] * 3)
        hold_a = total / AP[0] * AP[-1] + ctx["mc"] * ctx["ucum"][-1] * AP[-1]
    print("\n----- 基准对照（不做任何策略）-----")
    print(f"  全程持 {na} : {hold_a:,.0f}")
    print(f"  全程持 {nb_}: {hold_b:,.0f}")
    print(f"  50-50 不动 : {fixed:,.0f}")

    GRID = list(range(0, 101, 5))
    starts = [[0, 0, 0], [25, 50, 100], [50, 100, 100]]
    print(f"\n事件数={len(ctx['events'])}  "
          f"补仓全网格={len(GRID) ** 5:,} 组合/轮，减仓={len(GRID) ** 3:,}")

    best_v, best_c, best_r = -1.0, None, None
    for si, rb0 in enumerate(starts, 1):
        cur_rb = list(rb0)
        cur_dd, v = search(ctx, [GRID] * 5, cur_rb)
        for it in range(4):
            new_rb, v_rb = search_rb(ctx, cur_dd, [GRID] * 3)
            new_dd, v_dd = search(ctx, [GRID] * 5, new_rb)
            if v_dd <= v + 1e-6:
                cur_rb, v = new_rb, max(v, v_rb)
                break
            cur_dd, cur_rb, v = new_dd, new_rb, v_dd
        print(f"  起点{si} rb0={rb0} -> dd={list(cur_dd)} rb={list(cur_rb)} "
              f"总资金={v:,.0f}")
        if v > best_v:
            best_v, best_c, best_r = v, cur_dd, cur_rb

    c4, r3b, v4 = best_c, best_r, best_v

    print("\n" + "=" * 60)
    print("最终推荐策略（" + ctx["label"] + "收益最大化）")
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
    if dca_pct > 0:
        # bt.run_backtest 只支持一次性投入口径，定投口径下跳过调仓明细，
        # 改用逐日实现对拍校验事件级结果。
        v_slow = fast_total_slow(ctx, c4, r3b)
        print(f"\n逐日实现对拍: {v_slow:,.2f}  差值 {abs(v_slow - v4):,.6f}")
        return
    res = bt.run_backtest(CAP_A, CAP_B, dd, rb, g["csv_a"], g["csv_b"],
                          start_date=ctx["start_date"])
    print(f"\n----- 调仓明细（共 {len(res['trades'])} 笔）-----")
    for d, act, detail, pa, pb in res["trades"]:
        print(f"  {d}  {act}  {detail}  （成交价 {pa:.2f} / {pb:.2f}）")


if __name__ == "__main__":
    main()