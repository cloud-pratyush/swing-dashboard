import math

import numpy as np
import pandas as pd


def _clip01(x):
    return float(min(max(x, 0.0), 1.0))


def metrics_frame(frames, spy_close):
    """One row of ranking inputs per ticker (percentiles are across the full liquid universe)."""
    rows = {}
    for t, df in frames.items():
        last = df.iloc[-1]
        rs = (df["Close"] / spy_close.reindex(df.index).ffill()).dropna()
        rs_up = bool(len(rs) > 50 and rs.iloc[-1] > rs.rolling(50).mean().iloc[-1])
        rows[t] = {
            "roc63": last["ROC63"],
            "roc126": last["ROC126"],
            "adx": last["ADX"],
            "stack": bool(last["Close"] > last["SMA50"] > last["SMA200"]),
            "near_high": last["Close"] / last["High52"] if last["High52"] else np.nan,
            "vol_ratio": last["Volume"] / last["Vol_Avg"] if last["Vol_Avg"] else np.nan,
            "obv_up": bool(last["OBV_Up"]),
            "rs_up": rs_up,
        }
    m = pd.DataFrame(rows).T
    m["rs_pct"] = (m["roc63"].astype(float).rank(pct=True) + m["roc126"].astype(float).rank(pct=True)) / 2
    return m


def composite_score(m, n_setups):
    """0-100. Relative strength 35, trend 25, volume 15, confluence 15, 52w-high proximity 10."""
    rs = 0.5 * (m["rs_pct"] if not math.isnan(m["rs_pct"]) else 0) + 0.5 * float(m["rs_up"])
    adx = m["adx"] if not pd.isna(m["adx"]) else 0
    trend = 0.5 * float(m["stack"]) + 0.5 * _clip01((adx - 15) / 20)
    vr = m["vol_ratio"] if not pd.isna(m["vol_ratio"]) else 0
    vol = 0.5 * _clip01(vr / 2) + 0.5 * float(m["obv_up"])
    conf = min(n_setups, 3) / 3
    nh = m["near_high"] if not pd.isna(m["near_high"]) else 0
    prox = _clip01((nh - 0.8) / 0.2)
    return round(100 * (0.35 * rs + 0.25 * trend + 0.15 * vol + 0.15 * conf + 0.10 * prox), 1)


def gate_reason(setup, direction, vix, sector_beats_spy, cfg):
    g = cfg["gating"]
    if setup not in g["regime_allowed"][direction]:
        return f"not allowed in {direction} regime"
    if vix is not None and vix > g["vix_block"] and setup in ("breakout", "pullback"):
        return f"VIX {vix:.0f} above {g['vix_block']}"
    if setup in g["sector_must_beat_spy"] and not sector_beats_spy:
        return "sector lagging SPY"
    return None


def trade_plan(last, cfg):
    t, a = cfg["trade_plan"], cfg["account"]
    close, atr = float(last["Close"]), float(last["ATR"])
    stop = close - t["stop_atr_mult"] * atr
    risk = close - stop
    if risk <= 0 or stop <= 0:
        return None
    target = close + t["reward_risk"] * risk
    shares = math.floor(min(a["size"] * a["risk_pct"] / risk, a["size"] * a["max_position_pct"] / close))
    return {
        "entry": round(close, 2),
        "stop": round(stop, 2),
        "target": round(target, 2),
        "rr": t["reward_risk"],
        "shares": max(shares, 0),
        "risk_usd": round(max(shares, 0) * risk, 2),
    }
