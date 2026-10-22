#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SMH / SMH3 补仓减仓策略回测引擎

规则（与用户确认）：
  · 起点：SMH3 成立日（两份 CSV 日期交集的首日）。用投入资金按当日
    收盘价买入 SMH、SMH3 份额。
  · 逐日遍历（按日期升序，取两 CSV 的日期交集）。两个仓位市值随各自
    收盘价动态变化。
  · 回撤点定义：当前价相对“最近一次历史新高 peak”的跌幅，
    回撤% = (peak - 当前价) / peak * 100。
  · 回撤补仓：SMH 现价相对 peak 回撤达 -X%，且该档本轮未触发，
    则卖出当前 SMH 市值的 drawdowns[X]%，资金全部转买 SMH3。
      档位：DRAWDOWN_LEVELS = [15, 25, 35, 45, 50]
  · 反弹点定义（有效底部 active_trough）：初始为建仓日价格——若买入点恰在
    低位，此后即使从未触发回撤补仓，只要相对建仓价上涨达标也应减仓。
    此后每当价格自“最近一次历史新高 peak”回撤达到 TROUGH_TRIGGER_PCT（=25%）
    时，本段（两个相邻历史新高之间）即被认定为一个有效底部段：其底部 = 该段
    从新高回落直到再次创新高之前的“区间最低价”。该底部相对上一个历史新高是低点，
    也是此后一段反弹上涨的起点（未来创新高前不会再出现更低价）。
    段内价格继续下探则底部跟随下移，直到 SMH 再次创出新高才结束本段。
    未达 25% 回撤的微小回调不构成新底部；创新高后若回撤未达 25% 则不产生新底部，
    既有 active_trough 保持不变，反弹涨幅继续相对它累计。
  · 反弹减仓：SMH 现价相对 active_trough 上涨达 +Y%，且该档未触发，则卖出当前
    SMH3 市值的 rebounds[Y]%，资金全部转买 SMH。
    反弹% = (当前价 - active_trough) / active_trough * 100。创新高不清空底部，
    反弹涨幅持续累计，直到出现新的（回撤≥25%的）底部段并跌出更低价才重算。
      档位：REBOUND_LEVELS = [50, 100, 200]
  · 重置：SMH 创新高时 peak 上移、回撤档清空、结束本底部段跟踪；有效底部保留。
  · 资金只在 SMH ↔ SMH3 间转换，无额外现金。
  · 输出：截止最新一日两仓位市值及总资金。
"""
import os
import csv

DRAWDOWN_LEVELS = [15, 25, 35, 45, 50]
REBOUND_LEVELS = [50, 100, 200]
# 有效底部触发阈值：价格自最近一次历史新高回撤达到该幅度(%)时，
# 本段（两相邻新高之间）的区间最低点即被认定为反弹减仓基准 active_trough
TROUGH_TRIGGER_PCT = 25.0


def _load_close_series(csv_path: str) -> dict:
    """读取 CSV，返回 {date_str: close_price} 字典。"""
    series = {}
    with open(csv_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for r in reader:
            date = (r.get("Date") or "").strip()
            close_raw = (r.get("Close") or "").strip()
            if not date or not close_raw:
                continue
            try:
                series[date] = float(close_raw)
            except ValueError:
                continue
    return series


def get_common_dates(smh_csv: str, smh3_csv: str) -> list:
    """返回两份 CSV 的日期交集（升序）。"""
    smh_series = _load_close_series(smh_csv)
    smh3_series = _load_close_series(smh3_csv)
    return sorted(set(smh_series) & set(smh3_series))


def get_default_start_date(smh_csv: str, smh3_csv: str) -> str:
    """默认起点：两份 CSV 日期交集的首日（即 SMH3 成立日）。"""
    common = get_common_dates(smh_csv, smh3_csv)
    if not common:
        raise ValueError("SMH 与 SMH3 的历史数据没有共同交易日")
    return common[0]


def run_backtest(smh_capital: float, smh3_capital: float,
                 drawdowns: dict, rebounds: dict,
                 smh_csv: str, smh3_csv: str,
                 start_date: str = None,
                 end_date: str = None,
                 reset_threshold: float = 25.0,
                 name_a: str = "SMH", name_b: str = "SMH3") -> dict:
    """
    执行回测。

    参数：
      smh_capital / smh3_capital: 初始投入资金
      drawdowns: {15: pct, 25: pct, ...} 各回撤档补仓百分比（卖 SMH 的比例）
      rebounds:  {50: pct, 100: pct, 200: pct} 各反弹档减仓百分比（卖 SMH3 的比例）
      smh_csv / smh3_csv: 两份历史 CSV 路径
      start_date: 初始资金买入的时间节点（YYYY-MM-DD）。为空则用日期交集
                  首日；若该日非交易日，则取其之后最近的交易日。
      end_date:   回测截止日期（YYYY-MM-DD）。为空则用区间末日；若该日
                  非交易日，则取其之前最近的交易日。
      reset_threshold: 已弃用（保留参数仅为兼容旧调用签名，不再影响计算）。
                  反弹点现为“最近一次回撤补仓所在那一段的最低点（有效底部）”。
      name_a / name_b: 两个标的的显示名（仅影响交易明细文案），默认 SMH / SMH3。
                  不同数据源组合（如 SMH/USD、QQQ/TQQQ）须由调用方传入，
                  否则交易明细会错写成 SMH/SMH3。

    返回：
      {
        "start_date": ..., "end_date": ...,
        "final_smh": ..., "final_smh3": ..., "final_total": ...,
        "trades": [ (date, action, detail), ... ]
      }
    """
    smh_series = _load_close_series(smh_csv)
    smh3_series = _load_close_series(smh3_csv)

    # 取两者日期交集并升序排列
    all_common = sorted(set(smh_series) & set(smh3_series))
    if not all_common:
        raise ValueError("SMH 与 SMH3 的历史数据没有共同交易日，无法回测")

    # 根据 start_date 截取回测区间
    if start_date:
        sd = start_date.strip()
        # 取 >= 指定日期的第一个交易日
        candidates = [d for d in all_common if d >= sd]
        if not candidates:
            raise ValueError(
                f"所选日期 {sd} 晚于全部历史数据（最后交易日 "
                f"{all_common[-1]}），无法回测")
        common_dates = candidates
    else:
        common_dates = all_common

    # 根据 end_date 截取回测区间上界（截止日非交易日→向前取最近交易日）
    if end_date:
        ed = end_date.strip()
        within = [d for d in common_dates if d <= ed]
        if not within:
            raise ValueError(
                f"所选截止日期 {ed} 早于回测起始交易日 "
                f"{common_dates[0]}，无法回测")
        common_dates = within

    start_date = common_dates[0]
    end_date = common_dates[-1]

    smh_price0 = smh_series[start_date]
    smh3_price0 = smh3_series[start_date]
    if smh_price0 <= 0 or smh3_price0 <= 0:
        raise ValueError("起始日价格异常（<=0），无法建仓")

    # 以份额记账，市值 = 份额 × 当日收盘价
    smh_shares = smh_capital / smh_price0
    smh3_shares = smh3_capital / smh3_price0

    # 基准
    peak = smh_price0            # SMH 历史新高（回撤补仓的基准，创新高即上移）
    # 反弹点 active_trough：有效底部。建仓日价格本身即作为初始有效底部——
    # 若买入点恰在低位，此后即使从未触发回撤补仓，只要相对建仓价上涨达标也应减仓。
    # 之后每当价格自 peak 回撤达到 TROUGH_TRIGGER_PCT（=25%）时，本段（两相邻新高
    # 之间）即被认定为一个有效底部段，其底部 = 该段区间最低价；段内继续下探则底部
    # 跟随下移，直到再次创新高才结束本段。创新高不清空底部，旧的有效底部保持不变，
    # 直到出现新的（回撤≥25%的）底部段并跌出更低价才刷新。
    active_trough = smh_price0
    dd_fired = set()             # 相对当前 peak 已触发的回撤补仓档
    rb_fired = set()             # 相对当前 active_trough 已触发的反弹减仓档

    trades = []
    # 记录模型认定的“底部/反弹点”，供 GUI 展示：建仓日先记一条初始底部；此后每形成
    # 一个更低的底部段记一条，段内价格继续下探则更新该条为更低价，避免逐日刷屏。
    troughs = [(start_date, active_trough, "建仓日初始底部（反弹点）")]
    seg_active = False            # 本段回撤是否已达 25%（即本段是否已认定有效底部）
    seg_low = None                # 本段（自上个新高以来）跟踪到的区间最低价

    # ===== 逐日净值序列（供 GUI 绘制净值曲线对比图）=====
    # equity_dates：日期；equity_strategy：策略每日总市值；
    # equity_hold_smh/hold_smh3：合并初始资金全程只持有单一标的的每日市值；
    # equity_5050：50-50 不动（初始各买一半、全程不操作）的每日市值。
    total_capital = smh_capital + smh3_capital
    hold_smh_shares = total_capital / smh_price0     # 全买 SMH 的份额
    hold_smh3_shares = total_capital / smh3_price0   # 全买 SMH3 的份额
    fixed_smh_shares = smh_shares                     # 50-50 不动：锁定建仓份额
    fixed_smh3_shares = smh3_shares
    equity_dates = [start_date]
    equity_strategy = [smh_shares * smh_price0 + smh3_shares * smh3_price0]
    equity_hold_smh = [hold_smh_shares * smh_price0]
    equity_hold_smh3 = [hold_smh3_shares * smh3_price0]
    equity_5050 = [fixed_smh_shares * smh_price0 + fixed_smh3_shares * smh3_price0]
    # 交易标记点（供图上打三角）：{"date","kind"(补仓/减仓),"equity"}
    trade_marks = []

    for date in common_dates[1:]:
        smh_price = smh_series[date]
        smh3_price = smh3_series[date]

        # ===== 逐日记录各口径净值（放在循环开头，保证创新高 continue 也不漏）=====
        equity_dates.append(date)
        equity_strategy.append(smh_shares * smh_price + smh3_shares * smh3_price)
        equity_hold_smh.append(hold_smh_shares * smh_price)
        equity_hold_smh3.append(hold_smh3_shares * smh3_price)
        equity_5050.append(
            fixed_smh_shares * smh_price + fixed_smh3_shares * smh3_price)

        # ===== 创出新高 -> 回撤基准 peak 上移，开启新一轮补仓判断 =====
        # 创新高说明价格重回高位，回撤补仓基准 peak 上移、回撤档 dd_fired 清空、
        # 结束上一段的最低点跟踪。但有效底部 active_trough 不清空——若创新高后
        # 回撤未达 25% 就不产生新底部，反弹减仓仍相对既有 active_trough 计算；
        # 直到某段回撤再次达 25% 并跌出更低价，才刷新有效底部。
        if smh_price > peak:
            peak = smh_price
            dd_fired.clear()
            seg_active = False
            seg_low = None
            continue  # 新高当日不触发买卖

        # ===== 跟踪本段区间最低价 =====
        # 自上个新高以来，逐日更新本段最低价 seg_low
        if seg_low is None or smh_price < seg_low:
            seg_low = smh_price

        # ===== 回撤补仓：卖 SMH 买 SMH3 =====
        # 回撤幅度（相对 peak，正数）
        dd_pct = (peak - smh_price) / peak * 100.0
        for lv in DRAWDOWN_LEVELS:
            if lv in dd_fired:
                continue
            if dd_pct >= lv:
                sell_ratio = drawdowns.get(lv, 0.0) / 100.0
                if sell_ratio > 0 and smh_shares > 0:
                    smh_value = smh_shares * smh_price
                    move = smh_value * sell_ratio
                    smh_shares -= move / smh_price
                    smh3_shares += move / smh3_price
                    trades.append((
                        date, "补仓",
                        f"{name_a}回撤-{lv}%，卖出{name_a}市值{move:.2f}"
                        f"买入{name_b}"))
                    trade_marks.append({
                        "date": date, "kind": "补仓",
                        "equity": smh_shares * smh_price
                        + smh3_shares * smh3_price})
                dd_fired.add(lv)

        # ===== 形成/刷新有效底部 active_trough =====
        # 底部由“回撤幅度是否达到 TROUGH_TRIGGER_PCT（=25%）”决定，与是否触发
        # 补仓档无关。每一段（自上个新高至下次新高之前）只要回撤达 25%，就以本段区间
        # 最低价 seg_low 作为该段独立的新底部——无论它比以前的底部更高还是更低：
        #   · 首次达标（本段尚未激活）：无条件把 active_trough 刷新为本段 seg_low、
        #     清 rb_fired、新增一条底部记录，并激活本段。这样后续反弹减仓改为相对
        #     “本段最新底部”重新计算，而非从远古全局最低点算起。
        #   · 已激活后本段继续下探（seg_low 走低）：把 active_trough 下移到更低的
        #     seg_low 并更新记录末条、清 rb_fired。
        # 未达 25% 回撤的微小回调不构成新底部。创新高时本段结束、seg_active/seg_low
        # 复位；有效底部 active_trough 始终保留供反弹减仓，直到下一段回撤≥25%再刷新。
        if dd_pct >= TROUGH_TRIGGER_PCT:
            if not seg_active:
                seg_active = True
                active_trough = seg_low
                rb_fired.clear()
                troughs.append(
                    (date, active_trough, "回撤≥25%区间最低点（反弹点）"))
            elif seg_low < active_trough:
                active_trough = seg_low
                rb_fired.clear()
                troughs[-1] = (
                    date, active_trough, "回撤≥25%区间最低点（反弹点）")

        # ===== 反弹减仓：卖 SMH3 买 SMH =====
        # 有效底部 active_trough 初始为建仓价，此后每当某段回撤达 25% 就刷新为该段
        # 区间最低价（无论比以前高低）。反弹幅度相对当前有效底部累计计算：即使从未回撤
        # 到 25%（买在低点后一路上涨），只要相对建仓价上涨达标也会减仓；创新高不会清空
        # 底部，反弹涨幅持续累计，直到下一段回撤≥25%形成本段自己的新底部才刷新重算。
        if active_trough is not None and active_trough > 0:
            rb_pct = (smh_price - active_trough) / active_trough * 100.0
        else:
            rb_pct = 0.0
        for lv in REBOUND_LEVELS:
            if lv in rb_fired:
                continue
            if rb_pct >= lv:
                sell_ratio = rebounds.get(lv, 0.0) / 100.0
                if sell_ratio > 0 and smh3_shares > 0:
                    smh3_value = smh3_shares * smh3_price
                    move = smh3_value * sell_ratio
                    smh3_shares -= move / smh3_price
                    smh_shares += move / smh_price
                    trades.append((
                        date, "减仓",
                        f"{name_a}反弹+{lv}%，卖出{name_b}市值{move:.2f}"
                        f"买入{name_a}"))
                    trade_marks.append({
                        "date": date, "kind": "减仓",
                        "equity": smh_shares * smh_price
                        + smh3_shares * smh3_price})
                rb_fired.add(lv)

    final_smh = smh_shares * smh_series[end_date]
    final_smh3 = smh3_shares * smh3_series[end_date]

    # 两个“假设收益”对照：把 SMH+SMH3 的初始资金合并后，全程只持有单一标的、
    # 不做任何补仓/减仓操作，到 end_date 的最终市值。
    hold_all_smh = total_capital / smh_price0 * smh_series[end_date]
    hold_all_smh3 = total_capital / smh3_price0 * smh3_series[end_date]

    return {
        "start_date": start_date,
        "end_date": end_date,
        "final_smh": final_smh,
        "final_smh3": final_smh3,
        "final_total": final_smh + final_smh3,
        "hold_all_smh": hold_all_smh,
        "hold_all_smh3": hold_all_smh3,
        "trades": trades,
        "troughs": troughs,
        # 逐日净值序列（供 GUI 绘制净值曲线对比图）
        "equity_dates": equity_dates,
        "equity_strategy": equity_strategy,
        "equity_hold_smh": equity_hold_smh,
        "equity_hold_smh3": equity_hold_smh3,
        "equity_5050": equity_5050,
        "trade_marks": trade_marks,
    }


def compute_live_state(smh_csv, smh3_csv):
    """计算截至最新交易日的实时状态，供 GUI 展示各档位触发价。

    复刻 run_backtest 的 peak / active_trough / seg_low / seg_active /
    dd_fired / rb_fired 状态跟踪逻辑，但不做任何资金/份额计算——
    因为触发价只与价格基准有关，与用户输入的资金和比例无关。

    返回:
      {
        "peak": float,                      # 当前历史新高（回撤补仓基准）
        "peak_date": str,                   # 新高对应的交易日
        "active_trough": float,             # 当前有效底部（反弹减仓基准）
        "trough_date": str,                 # 有效底部对应的交易日
        "latest_price": float,              # A 标的最新收盘价
        "latest_date": str,                 # 最新交易日
        "dd_trigger_prices": {lv: price},   # 各回撤档触发价 = peak*(1-lv/100)
        "rb_trigger_prices": {lv: price},   # 各反弹档触发价 = active_trough*(1+lv/100)
      }
    """
    smh_series = _load_close_series(smh_csv)
    smh3_series = _load_close_series(smh3_csv)

    all_common = sorted(set(smh_series) & set(smh3_series))
    if not all_common:
        raise ValueError("两标的历史数据没有共同交易日，无法计算实时状态")

    start_date = all_common[0]
    price0 = smh_series[start_date]

    peak = price0
    peak_date = start_date
    active_trough = price0
    trough_date = start_date
    dd_fired = set()
    rb_fired = set()
    seg_active = False
    seg_low = None
    seg_low_date = None

    for date in all_common[1:]:
        price = smh_series[date]

        # 创新高：peak 上移、清 dd_fired、结束本段最低点跟踪
        if price > peak:
            peak = price
            peak_date = date
            dd_fired.clear()
            seg_active = False
            seg_low = None
            seg_low_date = None
            continue

        # 跟踪本段区间最低价
        if seg_low is None or price < seg_low:
            seg_low = price
            seg_low_date = date

        # 回撤幅度（相对 peak）
        dd_pct = (peak - price) / peak * 100.0

        # 回撤档触发标记（只跟踪状态，不算资金）
        for lv in DRAWDOWN_LEVELS:
            if lv not in dd_fired and dd_pct >= lv:
                dd_fired.add(lv)

        # 形成/刷新有效底部
        if dd_pct >= TROUGH_TRIGGER_PCT:
            if not seg_active:
                seg_active = True
                active_trough = seg_low
                trough_date = seg_low_date
                rb_fired.clear()
            elif seg_low < active_trough:
                active_trough = seg_low
                trough_date = seg_low_date
                rb_fired.clear()

        # 反弹档触发标记（只跟踪状态，不算资金）
        if active_trough is not None and active_trough > 0:
            rb_pct = (price - active_trough) / active_trough * 100.0
        else:
            rb_pct = 0.0
        for lv in REBOUND_LEVELS:
            if lv not in rb_fired and rb_pct >= lv:
                rb_fired.add(lv)

    latest_date = all_common[-1]
    latest_price = smh_series[latest_date]

    dd_trigger_prices = {
        lv: round(peak * (1 - lv / 100.0), 2) for lv in DRAWDOWN_LEVELS}
    rb_trigger_prices = {
        lv: round(active_trough * (1 + lv / 100.0), 2)
        for lv in REBOUND_LEVELS}

    return {
        "peak": peak,
        "peak_date": peak_date,
        "active_trough": active_trough,
        "trough_date": trough_date,
        "latest_price": latest_price,
        "latest_date": latest_date,
        "dd_trigger_prices": dd_trigger_prices,
        "rb_trigger_prices": rb_trigger_prices,
    }