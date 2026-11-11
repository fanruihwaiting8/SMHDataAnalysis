#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SMH 日线行情的备用数据源：stockanalysis.com。

背景：原先 SMH 真实段走 Nasdaq 官方 api（build_smh_nasdaq.py），
该接口自 2026-11 起对本机/云端 IP 一律返回 403 Forbidden，导致
SMH 永远回退到本地旧 CSV、末日停在旧日期（其余标的走 FT 正常更新）。

本模块改用 stockanalysis.com 的公开行情接口：
  https://stockanalysis.com/api/symbol/e/smh/history?range=5Y
  返回 JSON：{"status":200,"data":[{"t":"YYYY-MM-DD","o","h","l","c","v","a"}...]}
  （无 range 参数时 data 为 {"data": [...]}，故两种结构都要兼容）

实测口径与原 Nasdaq 源逐日一致（2026-11-02~11-09 收盘价完全吻合），
最长可取 range=5Y（约 1255 条），足够做增量续写；更早的真实段沿用
本地已落盘数据，2016 之前仍由 SOXX 缩放回填。

注意：接口会把「当天盘中价」也作为一行返回，必须按美东收盘时间剔除，
否则会把未收盘的实时价当成收盘价入库。
"""
import gzip
import io
import json
import ssl
import urllib.request
from datetime import datetime, timedelta, timezone

SYMBOL = "smh"
URL = "https://stockanalysis.com/api/symbol/e/{sym}/history?range={rng}"
HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                   "AppleWebKit/537.36 (KHTML, like Gecko) "
                   "Version/18.0 Safari/605.1.15"),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
}

SSL_CTX = ssl.create_default_context()
SSL_CTX.check_hostname = False
SSL_CTX.verify_mode = ssl.CERT_NONE
_OPENER = urllib.request.build_opener(
    urllib.request.HTTPSHandler(context=SSL_CTX))


def us_last_closed_day():
    """返回美股最近一个「已收盘」的自然日（不含周末回退之外的节假日）。

    美东 16:05 之前视为当天尚未收盘，cutoff 退到前一天。
    """
    try:
        from zoneinfo import ZoneInfo
        now = datetime.now(ZoneInfo("America/New_York"))
    except Exception:
        now = datetime.now(timezone.utc) - timedelta(hours=5)
    d = now.date()
    if (now.hour, now.minute) < (16, 5):
        d -= timedelta(days=1)
    while d.weekday() >= 5:          # 周六/周日回退到周五
        d -= timedelta(days=1)
    return d


def _num(x):
    return float(str(x).replace(",", "").replace("$", "").strip())


def fetch(rng="5Y", drop_unclosed=True):
    """抓取 SMH 日线，返回 [(date, o, h, l, c, vol), ...] 升序。"""
    req = urllib.request.Request(URL.format(sym=SYMBOL, rng=rng),
                                 headers=HEADERS)
    with _OPENER.open(req, timeout=30) as resp:
        raw = resp.read()
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.GzipFile(fileobj=io.BytesIO(raw)).read()
    obj = json.loads(raw.decode("utf-8", errors="replace"))
    data = obj.get("data")
    if isinstance(data, dict):
        data = data.get("data")
    if not data:
        raise RuntimeError("stockanalysis 返回空数据")

    cutoff = us_last_closed_day() if drop_unclosed else None
    rows = {}
    for r in data:
        try:
            d = datetime.strptime(str(r["t"]).strip(), "%Y-%m-%d").date()
            o, h, l, c = (_num(r[k]) for k in ("o", "h", "l", "c"))
            vol = int(_num(r.get("v") or 0))
        except (KeyError, ValueError, TypeError):
            continue
        if cutoff is not None and d > cutoff:
            continue
        rows[d] = (d, o, h, l, c, vol)
    return sorted(rows.values(), key=lambda x: x[0])


if __name__ == "__main__":
    rs = fetch()
    print(f"rows={len(rs)}  {rs[0][0]} ~ {rs[-1][0]}")
    for r in rs[-3:]:
        print(r)