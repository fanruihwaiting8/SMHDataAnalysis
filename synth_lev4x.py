#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
合成「半导体 4 倍杠杆」序列并与真实 3x(SOXL) 做对比验证。

背景：市面上没有合规可交易的 4倍半导体 ETF（美国 1940 法案下杠杆 ETF 上限 3x），
因此 4x 只能用 SMH 日收益合成：
    P_t = P_{t-1} * (1 + k * r_t - c_daily)
其中 c_daily 为每日成本（管理费 + (k-1) 倍融资成本），用真实 SOXL 反推标定。

步骤：
  1) 用 SMH 日收益合成 3x，二分求出使合成 3x 末值等于真实 SOXL 末值的 c_daily；
     由此得到隐含年化成本 C3 = c_daily*252，并拆成 fee + 2*rate（fee 取 SOXL 费率）。
  2) 4x 成本按 C4 = fee + 3*rate 推出，生成 Input/SMH4X_synth_history.csv。
  3) 打印合成 3x 对真实 SOXL 的跟踪误差，作为合成方法可信度的证据。

用法（需用项目 .venv）：
  cd my-project/APP/SMHDataAnalysisBot
  .venv/bin/python synth_lev4x.py
"""
import math
import backtest as bt

SMH_CSV = "Input/SMH_full_history.csv"
SOXL_CSV = "Input/SOXL_full_history.csv"
OUT_CSV = "Input/SMH4X_synth_history.csv"

SOXL_FEE = 0.0090   # SOXL 总费率约 0.90%/年


def common_series():
    sa = bt._load_close_series(SMH_CSV)
    sb = bt._load_close_series(SOXL_CSV)
    dates = sorted(set(sa) & set(sb))
    return dates, [sa[d] for d in dates], [sb[d] for d in dates]


def synth(base_prices, k, c_daily, p0):
    """按 k 倍日收益 - 每日成本合成价格序列。"""
    out = [p0]
    for i in range(1, len(base_prices)):
        r = base_prices[i] / base_prices[i - 1] - 1.0
        nxt = out[-1] * (1.0 + k * r - c_daily)
        if nxt <= 1e-9:          # 杠杆归零保护（4x 单日跌 25% 即爆仓）
            nxt = 1e-9
        out.append(nxt)
    return out


def synth_from_lev(lev_prices, scale, extra_c_daily, p0):
    """把已有杠杆序列（真实 SOXL）的日收益再放大 scale 倍，额外扣每日成本。

    保留 SOXL 真实的指数路径与每日再平衡效果，只把倍数从 3 提到 3*scale。
    """
    out = [p0]
    for i in range(1, len(lev_prices)):
        r = lev_prices[i] / lev_prices[i - 1] - 1.0
        nxt = out[-1] * (1.0 + scale * r - extra_c_daily)
        if nxt <= 1e-9:
            nxt = 1e-9
        out.append(nxt)
    return out


def max_dd(series):
    peak, mdd = series[0], 0.0
    for v in series:
        peak = max(peak, v)
        mdd = max(mdd, (peak - v) / peak * 100.0)
    return mdd


def cagr(series, n_days):
    yrs = n_days / 252.0
    return ((series[-1] / series[0]) ** (1.0 / yrs) - 1.0) * 100.0


def calibrate(base, real, k):
    """二分求 c_daily：使合成 k 倍末值 == 真实末值。"""
    target = real[-1] / real[0]
    lo, hi = -0.001, 0.01
    for _ in range(200):
        mid = (lo + hi) / 2.0
        s = synth(base, k, mid, 1.0)
        if s[-1] > target:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2.0


def main():
    dates, smh, soxl = common_series()
    n = len(dates)
    print(f"区间 {dates[0]} ~ {dates[-1]}，共 {n} 个共同交易日\n")

    c3 = calibrate(smh, soxl, 3.0)
    s3 = synth(smh, 3.0, c3, soxl[0])
    # 跟踪误差：合成 3x 与真实 SOXL 的对数净值偏离
    errs = [abs(math.log(s3[i] / soxl[i])) for i in range(n)]
    rmse = math.sqrt(sum(e * e for e in errs) / n) * 100.0

    C3 = c3 * 252.0
    rate = max((C3 - SOXL_FEE) / 2.0, 0.0)
    C4 = SOXL_FEE + 3.0 * rate
    c4 = C4 / 252.0

    print("【标定】用真实 SOXL 反推 3x 每日成本")
    print(f"  隐含年化成本 C3 = {C3*100:.2f}%  (费率 {SOXL_FEE*100:.2f}% + 2×融资 {rate*100:.2f}%)")
    print(f"  合成 3x vs 真实 SOXL：末值比 {s3[-1]/soxl[-1]:.4f}，对数净值 RMSE {rmse:.2f}%")
    print(f"  合成 3x 年化 {cagr(s3, n):.2f}% / 最大回撤 {max_dd(s3):.1f}%")
    print(f"  真实 SOXL 年化 {cagr(soxl, n):.2f}% / 最大回撤 {max_dd(soxl):.1f}%\n")

    print("【推算】4x 成本")
    print(f"  C4 = 费率 {SOXL_FEE*100:.2f}% + 3×融资 {rate*100:.2f}% = {C4*100:.2f}%/年\n")

    # 方案 A：用 SMH 日收益 ×4 合成（缺点：SOXL 实际跟的是 ICE 半导体指数而非
    # SMH 所跟的指数，路径会偏离，见上面 RMSE）
    s4a = synth(smh, 4.0, c4, soxl[0])
    # 方案 B（主用）：直接把真实 SOXL 的日收益放大到 4/3 倍，只额外扣 1 份融资成本。
    # 这样杠杆端仍跟随 SOXL 真实的指数与每日再平衡路径，只是倍数从 3 变 4。
    s4b = synth_from_lev(soxl, 4.0 / 3.0, rate / 252.0, soxl[0])
    s4 = s4b
    print("【合成 4x 结果】")
    print(f"  SMH      年化 {cagr(smh, n):6.2f}%  最大回撤 {max_dd(smh):5.1f}%  末值倍数 {smh[-1]/smh[0]:10.1f}x")
    print(f"  SOXL(3x) 年化 {cagr(soxl, n):6.2f}%  最大回撤 {max_dd(soxl):5.1f}%  末值倍数 {soxl[-1]/soxl[0]:10.1f}x")
    print(f"  4x-A(SMH×4)  年化 {cagr(s4a, n):6.2f}%  最大回撤 {max_dd(s4a):5.1f}%  末值倍数 {s4a[-1]/s4a[0]:10.1f}x")
    print(f"  4x-B(SOXL×4/3) 年化 {cagr(s4b, n):6.2f}%  最大回撤 {max_dd(s4b):5.1f}%  末值倍数 {s4b[-1]/s4b[0]:10.1f}x")

    # 单日跌幅体检：4x 单日 -25% 即归零
    worst = min(smh[i] / smh[i - 1] - 1.0 for i in range(1, n))
    print(f"\n  SMH 区间内最差单日 {worst*100:.2f}%  → 4x 当日 {worst*400:.1f}%"
          f"（{'已触及归零风险' if worst*4 <= -1 else '未触及归零'}）")

    with open(OUT_CSV, "w", encoding="utf-8") as f:
        f.write("Date,Open,High,Low,Close,AdjClose,ChangePct,Volume\n")
        for i, d in enumerate(dates):
            p = s4[i]
            f.write(f"{d},{p:.6f},{p:.6f},{p:.6f},{p:.6f},{p:.6f},,0\n")
    print(f"\n已写出合成序列：{OUT_CSV}")


if __name__ == "__main__":
    main()