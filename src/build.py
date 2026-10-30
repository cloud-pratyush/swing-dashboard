"""Daily build: download data, compute signals, write JSON for the static dashboard.

Usage:  python -m src.build            (writes site/data/*.json)
"""
import json
import math
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import yaml

from .data import download_all, drop_partial_bar, expected_last_session, next_earnings
from .indicators import compute_indicators
from .regime import breadth, sector_series, sector_table, spy_regime
from .score import bucket_for, gate_reason, grade_for, metrics_frame, signal_score, trade_plan
from .setups import SETUP_LABELS, detect_setups

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "site" / "data"
BUCKET_ORDER = {"actionable": 0, "wait": 1, "watch": 2, "filtered": 3}


def num(x, nd=2):
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(x) or math.isinf(x) else round(x, nd)


def write(name, obj):
    path = OUT / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, separators=(",", ":"), allow_nan=False), encoding="utf-8")


def bars_json(df, n):
    d = df.tail(n)
    rows = []
    for ts, r in d.iterrows():
        rows.append({
            "t": ts.strftime("%Y-%m-%d"),
            "o": num(r["Open"]), "h": num(r["High"]), "l": num(r["Low"]), "c": num(r["Close"]),
            "v": int(r["Volume"]) if not math.isnan(r["Volume"]) else 0,
            "s50": num(r["SMA50"]), "s200": num(r["SMA200"]),
            "bu": num(r["BB_U20"]), "bl": num(r["BB_L20"]),
            "rsi": num(r["RSI"], 1),
        })
    return rows


def main():
    cfg = yaml.safe_load((ROOT / "config.yaml").read_text(encoding="utf-8"))
    now_et = datetime.now(ZoneInfo("America/New_York"))
    warnings = []

    sectors = cfg["sectors"]
    etfs = list(sectors)
    ticker_sector = {t: etf for etf, s in sectors.items() for t in s["tickers"]}
    symbols = list(ticker_sector) + etfs + ["SPY", "^VIX"]

    print(f"Downloading {len(symbols)} symbols...")
    raw, failed = download_all(symbols, cfg["data"]["period"], cfg["data"]["chunk_size"])
    if failed:
        warnings.append(f"No data for: {', '.join(sorted(set(failed)))}")
    if "SPY" not in raw:
        raise SystemExit("SPY data unavailable; aborting so yesterday's page is kept.")
    raw = {k: drop_partial_bar(v, now_et) for k, v in raw.items()}

    ind = cfg["indicators"]
    spy = compute_indicators(raw["SPY"], ind)
    direction, vol_state = spy_regime(spy)
    vix = num(raw["^VIX"]["Close"].iloc[-1]) if "^VIX" in raw else None
    vix_trend = None
    if "^VIX" in raw and len(raw["^VIX"]) > 20:
        vix_trend = "rising" if raw["^VIX"]["Close"].iloc[-1] > raw["^VIX"]["Close"].tail(20).mean() else "falling"

    last_bar = spy.index[-1].date()
    if last_bar < expected_last_session(now_et):
        warnings.append(f"Data may be stale: latest SPY bar is {last_bar}.")

    # Universe: enough history + liquidity filter
    frames, dropped = {}, []
    liq = cfg["liquidity"]
    for t in ticker_sector:
        df = raw.get(t)
        if df is None or len(df) < cfg["data"]["min_bars"]:
            continue
        df = compute_indicators(df, ind)
        last = df.iloc[-1]
        if last["Close"] < liq["min_price"] or not last["Dollar_Vol"] >= liq["min_dollar_volume"]:
            dropped.append(t)
            continue
        frames[t] = df

    b50, b200 = breadth(frames)
    spy_close = spy["Close"]
    metrics = metrics_frame(frames, spy_close)

    etf_closes = {e: raw[e]["Close"] for e in etfs if e in raw}
    sec_rows = sector_table(etf_closes, sectors)
    spy_3m = float(spy_close.iloc[-1] / spy_close.iloc[-64] - 1)
    sector_beats = {r["etf"]: (r["r3m"] is not None and r["r3m"] >= spy_3m) for r in sec_rows}

    # Signals
    ranking = []
    for t, df in frames.items():
        found = detect_setups(df, cfg)
        if not found:
            continue
        etf = ticker_sector[t]
        m = metrics.loc[t]
        passed, filtered = [], {}
        for s in found:
            reason = gate_reason(s, direction, vix, sector_beats.get(etf, False), cfg)
            if reason:
                filtered[s] = reason
            else:
                passed.append(s)

        signals = {}
        for s, checks in found.items():
            sc, breakdown = signal_score(s, m, df, cfg)
            signals[s] = {"score": sc, "grade": grade_for(s, sc, cfg), "checks": checks, "breakdown": breakdown}

        pool = passed or list(found)
        top = max(pool, key=lambda s: signals[s]["score"])
        bonus = min(max(len(passed) - 1, 0) * 5, 10)  # confluence
        score = round(min(signals[top]["score"] + bonus, 100), 1)
        grade = grade_for(top, score, cfg)

        last = df.iloc[-1]
        flags = []
        if "shock" in passed:
            flags.append("Watch only: sharp drop, no confirmation (falling-knife risk)")
        for s, why in filtered.items():
            flags.append(f"{SETUP_LABELS[s]} filtered: {why}")
        if not sector_beats.get(etf, False):
            flags.append("Sector lagging SPY (3M)")

        ranking.append({
            "ticker": t,
            "sector": sectors[etf]["name"],
            "open": num(last["Open"]), "close": num(last["Close"]),
            "chg": num(last["Ret"] * 100),
            "rsi": num(last["RSI"], 1),
            "vol_ratio": num(last["Volume"] / last["Vol_Avg"]),
            "adx": num(last["ADX"], 1),
            "rs_pct": num(m["rs_pct"] * 100, 0),
            "score": score, "grade": grade, "top": top,
            "setups": passed,
            "filtered": filtered,
            "signals": signals,
            "flags": flags,
            "bucket": None,
            "plan": trade_plan(last, cfg),
            "earnings": None,
            "spark": [num(x) for x in df["Close"].tail(30)],
        })

    # Earnings check, only for names with signals; earnings soon -> "wait" bucket
    warn_days = cfg["earnings"]["warn_days"]
    today = now_et.date()
    for r in ranking:
        d = next_earnings(r["ticker"])
        soon = False
        if d:
            days = (d - today).days
            soon = 0 <= days <= warn_days
            r["earnings"] = {"date": d.isoformat(), "days": days, "soon": soon}
            if soon:
                r["flags"].insert(0, f"Earnings in {days} day(s): wait until after the report")
        r["bucket"] = bucket_for(not r["setups"], soon, r["grade"])
    ranking.sort(key=lambda r: (BUCKET_ORDER[r["bucket"]], -r["score"]))

    # Per-setup sections: actionable only, best first, capped
    cap = cfg["output"]["max_per_setup"]
    setups_out = {}
    for key, label in SETUP_LABELS.items():
        members = [r for r in ranking if key in r["setups"]]
        act = sorted((r for r in members if r["bucket"] == "actionable"),
                     key=lambda r: -r["signals"][key]["score"])
        setups_out[key] = {
            "label": label,
            "tickers": [r["ticker"] for r in act[:cap]],
            "actionable": len(act),
            "watch": sum(r["bucket"] == "watch" for r in members),
            "wait": sum(r["bucket"] == "wait" for r in members),
            "filtered": sum(key in r["filtered"] for r in ranking),
        }

    # Charts for every signal ticker (ranking order, capped)
    n = cfg["output"]["chart_bars"]
    for r in ranking[: cfg["output"]["max_chart_tickers"]]:
        write(f"charts/{r['ticker']}.json", bars_json(frames[r["ticker"]], n))
    write("charts/SPY.json", bars_json(spy, n))

    funnel = {
        "scanned": len(ticker_sector),
        "liquid": len(frames),
        "signals": len(ranking),
        "actionable": sum(r["bucket"] == "actionable" for r in ranking),
        "wait": sum(r["bucket"] == "wait" for r in ranking),
        "watch": sum(r["bucket"] == "watch" for r in ranking),
        "filtered": sum(r["bucket"] == "filtered" for r in ranking),
    }

    write("market.json", {
        "regime": f"{direction} {vol_state}",
        "direction": direction,
        "vol_state": vol_state,
        "spy_close": num(spy_close.iloc[-1]),
        "sma50": num(spy["SMA50"].iloc[-1]),
        "sma200": num(spy["SMA200"].iloc[-1]),
        "breadth50": b50,
        "breadth200": b200,
        "vix": vix,
        "vix_trend": vix_trend,
        "last_bar": last_bar.isoformat(),
        "spy_3m": num(spy_3m * 100),
    })
    write("sectors.json", {"table": sec_rows, "series": sector_series(etf_closes)})
    write("ranking.json", ranking)
    write("setups.json", setups_out)
    write("meta.json", {
        "generated": datetime.now(timezone.utc).isoformat(timespec="minutes"),
        "universe": len(frames),
        "excluded_illiquid": dropped,
        "warnings": warnings,
        "funnel": funnel,
    })
    print(f"Done: {funnel['scanned']} scanned -> {funnel['liquid']} liquid -> {funnel['signals']} signals "
          f"-> {funnel['actionable']} actionable. Regime {direction} {vol_state}.")


if __name__ == "__main__":
    main()
