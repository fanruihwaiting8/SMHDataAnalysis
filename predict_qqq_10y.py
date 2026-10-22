# -*- coding: utf-8 -*-
"""基于 QQQ 历史数据的 10 年价格预测分析（多情景 + 蒙特卡洛）。"""
import csv, math, statistics, os, random, sys

TICKER = sys.argv[1] if len(sys.argv) > 1 else "QQQ"
BASE = os.path.dirname(os.path.abspath(__file__))
PATH = os.path.join(BASE, "Input", f"{TICKER}_full_history.csv")
print(f"### 标的: {TICKER} ###")

rows = []
with open(PATH, newline="") as f:
    for r in csv.DictReader(f):
        try:
            rows.append((r["Date"], float(r["AdjClose"])))
        except (ValueError, KeyError):
            pass

rows.sort(key=lambda x: x[0])
d0, p0 = rows[0]
d1, p1 = rows[-1]
years = (int(d1[:4]) + int(d1[5:7]) / 12) - (int(d0[:4]) + int(d0[5:7]) / 12)

def cagr(pa, pb, yrs):
    return (pb / pa) ** (1 / yrs) - 1

full_cagr = cagr(p0, p1, years)
print(f"数据范围: {d0}  ->  {d1}  ({years:.1f} 年)")
print(f"起始价: {p0:.2f}   最新价: {p1:.2f}")
print(f"全期年化收益(CAGR): {full_cagr*100:.2f}%\n")

# 分段 CAGR
for back in (5, 10, 15):
    target_year = int(d1[:4]) - back
    cand = [(d, p) for d, p in rows if d[:4] == str(target_year)]
    if cand:
        pd, pp = cand[0]
        print(f"近 {back} 年 CAGR: {cagr(pp, p1, back)*100:.2f}%  (自 {pd} 的 {pp:.2f})")

# 日收益 -> 年化波动率
closes = [p for _, p in rows]
rets = [math.log(closes[i] / closes[i-1]) for i in range(1, len(closes))]
daily_mu = statistics.mean(rets)
daily_sd = statistics.pstdev(rets)
ann_sd = daily_sd * math.sqrt(252)
print(f"\n年化波动率: {ann_sd*100:.1f}%")

# 情景预测（10 年）
print("\n===== 10 年后 QQQ 价格情景预测（基于最新价 {:.2f}）=====".format(p1))
scenarios = {
    "保守 (8%/年)": 0.08,
    "历史全期 ({:.1f}%/年)".format(full_cagr*100): full_cagr,
    "AI 乐观 (15%/年)": 0.15,
    "AI 强牛 (18%/年)": 0.18,
}
for name, g in scenarios.items():
    print(f"  {name:28s} -> {p1*(1+g)**10:,.0f}")

# 蒙特卡洛：几何布朗运动
print("\n===== 蒙特卡洛模拟 (10000 次, GBM) =====")
N, DAYS = 10000, 252 * 10
drift = daily_mu - 0.5 * daily_sd**2
finals = []
random.seed(42)
for _ in range(N):
    logp = math.log(p1)
    for _ in range(DAYS):
        logp += drift + daily_sd * random.gauss(0, 1)
    finals.append(math.exp(logp))
finals.sort()
def pct(q):
    return finals[int(q * (N - 1))]
print(f"  P5  (悲观): {pct(0.05):,.0f}")
print(f"  P25       : {pct(0.25):,.0f}")
print(f"  中位数 P50: {pct(0.50):,.0f}")
print(f"  P75       : {pct(0.75):,.0f}")
print(f"  P95 (乐观): {pct(0.95):,.0f}")
print(f"  均值      : {statistics.mean(finals):,.0f}")