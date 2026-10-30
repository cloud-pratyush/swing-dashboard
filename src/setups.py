SETUP_LABELS = {
    "breakout": "Momentum Breakout",
    "mean_reversion": "Mean Reversion",
    "squeeze": "Volatility Squeeze",
    "pullback": "Trend Pullback",
    "shock": "Momentum Shock",
}


def detect_setups(df, cfg):
    """Return every setup the latest bar satisfies (not just the first)."""
    s = cfg["setups"]
    last, prev = df.iloc[-1], df.iloc[-2]
    found = []

    b = s["breakout"]
    if (
        last["Close"] >= last["BB_U20"]
        and last["ATR"] / last["Close"] >= b["atr_pct"]
        and last["Volume"] > b["vol_mult"] * last["Vol_Avg"]
        and last["Range"] > last["Range_Avg3"]
    ):
        found.append("breakout")

    m = s["mean_reversion"]
    if (
        last["Close"] <= last["BB_L80"] * m["bb80_tol"]
        and last["RSI"] < m["rsi_max"]
        and prev["Stoch_K"] <= prev["Stoch_D"]
        and last["Stoch_K"] > last["Stoch_D"]
        and last["Stoch_K"] < m["stoch_max"]
    ):
        found.append("mean_reversion")

    p = s["pullback"]
    if (
        last["Close"] > last["SMA50"]
        and last["Low"] <= last["EMA21"] * p["ema_tol"]
        and last["Close"] >= last["EMA21"]
        and last["Volume"] < last["Vol_Avg"]
    ):
        found.append("pullback")

    q = s["squeeze"]
    min_width = df["BB_Width"].rolling(q["lookback"]).min().iloc[-1]
    if (
        last["BB_Width"] <= min_width * q["width_tol"]
        and last["BB_U20"] <= last["KC_U"]
        and last["BB_L20"] >= last["KC_L"]
        and q["rsi_min"] <= last["RSI"] <= q["rsi_max"]
    ):
        found.append("squeeze")

    if last["Ret"] <= s["shock"]["drop_pct"]:
        found.append("shock")

    return found
