const $ = (s) => document.querySelector(s);
const dark = matchMedia("(prefers-color-scheme: dark)").matches;
const T = dark
  ? { bg: "#161b23", text: "#98a2b3", grid: "#262d38" }
  : { bg: "#ffffff", text: "#667085", grid: "#e3e6ec" };
const PALETTE = ["#2563eb", "#dc2626", "#16a34a", "#d97706", "#7c3aed", "#0891b2",
                 "#db2777", "#65a30d", "#475569", "#ea580c", "#0d9488"];
const cache = {};

async function getJSON(path) {
  if (!cache[path]) {
    const r = await fetch(`data/${path}?v=${Date.now()}`);
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    cache[path] = r.json();
  }
  return cache[path];
}

const pct = (x) => (x == null ? "–" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`);
const cls = (x) => (x == null ? "" : x >= 0 ? "up" : "down");
const LABELS = {
  breakout: "Momentum Breakout", mean_reversion: "Mean Reversion", squeeze: "Volatility Squeeze",
  pullback: "Trend Pullback", shock: "Momentum Shock",
};

function makeChart(el, height) {
  const chart = LightweightCharts.createChart(el, {
    width: el.clientWidth, height,
    layout: { background: { color: T.bg }, textColor: T.text },
    grid: { vertLines: { color: T.grid }, horzLines: { color: T.grid } },
    rightPriceScale: { borderColor: T.grid }, timeScale: { borderColor: T.grid },
  });
  new ResizeObserver(() => chart.applyOptions({ width: el.clientWidth })).observe(el);
  return chart;
}

function priceChart(el, bars, { candles = false, sma200 = false } = {}) {
  const chart = makeChart(el, el.clientHeight || 200);
  const main = candles
    ? chart.addCandlestickSeries({ upColor: "#16a34a", downColor: "#dc2626", borderVisible: false,
                                   wickUpColor: "#16a34a", wickDownColor: "#dc2626" })
    : chart.addLineSeries({ color: "#2563eb", lineWidth: 2 });
  main.setData(bars.map((b) => candles
    ? { time: b.t, open: b.o, high: b.h, low: b.l, close: b.c }
    : { time: b.t, value: b.c }));
  const line = (key, color, style = 0) => {
    const s = chart.addLineSeries({ color, lineWidth: 1, lineStyle: style, priceLineVisible: false, lastValueVisible: false });
    s.setData(bars.filter((b) => b[key] != null).map((b) => ({ time: b.t, value: b[key] })));
  };
  line("s50", "#f59e0b");
  if (sma200) line("s200", "#a855f7");
  line("bu", "#94a3b8", 2);
  line("bl", "#94a3b8", 2);
  const vol = chart.addHistogramSeries({ priceScaleId: "vol", priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: false });
  chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
  vol.setData(bars.map((b, i) => ({
    time: b.t, value: b.v,
    color: i > 0 && b.c < bars[i - 1].c ? "rgba(220,38,38,.45)" : "rgba(22,163,74,.45)",
  })));
  chart.timeScale().fitContent();
  return chart;
}

function spark(values) {
  const v = values.filter((x) => x != null);
  if (v.length < 2) return "";
  const lo = Math.min(...v), hi = Math.max(...v), w = 80, h = 22;
  const pts = v.map((x, i) => `${(i / (v.length - 1) * w).toFixed(1)},${(h - ((x - lo) / (hi - lo || 1)) * h).toFixed(1)}`).join(" ");
  const color = v[v.length - 1] >= v[0] ? "var(--up)" : "var(--down)";
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline fill="none" stroke="${color}" stroke-width="1.5" points="${pts}"/></svg>`;
}

async function miniCard(parent, ticker, extra = "") {
  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `<div class="mini-title"><span>${ticker}</span><span class="muted small">${extra}</span></div><div class="chart"></div>`;
  parent.appendChild(card);
  try {
    priceChart(card.querySelector(".chart"), await getJSON(`charts/${ticker}.json`));
  } catch { card.querySelector(".chart").innerHTML = '<div class="empty">chart unavailable</div>'; }
}

/* ---------- Left column ---------- */
async function renderMarket() {
  const [m, s] = await Promise.all([getJSON("market.json"), getJSON("sectors.json")]);
  priceChart($("#spy-chart"), await getJSON("charts/SPY.json"), { sma200: true });
  const rc = m.direction === "Bull" ? "up" : m.direction === "Bear" ? "down" : "";
  $("#regime-box").innerHTML = `<div class="kv">
    <span>Regime</span><b class="${rc}">${m.regime}</b>
    <span>SPY close</span><span>${m.spy_close}</span>
    <span>SMA50 / SMA200</span><span>${m.sma50} / ${m.sma200}</span>
    <span>Above SMA50 / SMA200</span><span>${m.breadth50}% / ${m.breadth200}%</span>
    <span>VIX</span><span>${m.vix ?? "–"} ${m.vix_trend ? `(${m.vix_trend})` : ""}</span>
    <span>Data current as of</span><span>${m.last_bar}</span></div>`;

  const chart = makeChart($("#sector-chart"), 200);
  const legend = [];
  Object.entries(s.series).forEach(([etf, pts], i) => {
    const color = PALETTE[i % PALETTE.length];
    const ser = chart.addLineSeries({ color, lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false });
    ser.setData(pts.map((p) => ({ time: p.t, value: p.v })));
    legend.push(`<span><i style="background:${color}"></i>${etf}</span>`);
  });
  chart.timeScale().fitContent();
  $("#sector-legend").innerHTML = legend.join("");
  $("#sector-table").innerHTML = `<tr><th>Sector</th><th>3M</th><th>1M</th><th>1W</th></tr>` +
    s.table.map((r) => `<tr><td>${r.name}</td><td class="${cls(r.r3m)}">${pct(r.r3m)}</td>
      <td class="${cls(r.r1m)}">${pct(r.r1m)}</td><td class="${cls(r.r1w)}">${pct(r.r1w)}</td></tr>`).join("");
}

/* ---------- Middle column ---------- */
let selected = null;
async function renderRanking() {
  const rows = await getJSON("ranking.json");
  const showFiltered = $("#show-filtered").checked;
  const list = rows.filter((r) => showFiltered || !r.gated);
  const head = `<tr><th>#</th><th>Ticker</th><th>Open</th><th>Close</th><th>RSI</th><th>Vol×</th><th>Score</th><th>Setups</th><th></th></tr>`;
  const body = list.map((r, i) => {
    const tags = r.setups.map((s) => `<span class="tag">${LABELS[s]}</span>`).join("") +
      Object.keys(r.filtered).map((s) => `<span class="tag" style="opacity:.6" title="${r.filtered[s]}">${LABELS[s]} ✕</span>`).join("");
    const earn = r.earnings && r.earnings.soon ? `<span class="tag warn">Earnings ${r.earnings.days}d</span>` : "";
    return `<tr class="row ${r.gated ? "gated" : ""} ${selected === r.ticker ? "sel" : ""}" data-t="${r.ticker}">
      <td>${i + 1}</td><td><b>${r.ticker}</b></td><td>${r.open}</td>
      <td class="${cls(r.chg)}">${r.close}</td><td>${r.rsi}</td><td>${r.vol_ratio}</td>
      <td><b>${r.score}</b></td><td style="white-space:normal">${tags}${earn}</td><td>${spark(r.spark)}</td></tr>`;
  }).join("");
  $("#ranking").innerHTML = head + (body || `<tr><td colspan="9" class="empty">No signals today.</td></tr>`);
  document.querySelectorAll("#ranking tr.row").forEach((tr) => tr.addEventListener("click", () => select(tr.dataset.t)));
}

/* ---------- Right column ---------- */
async function select(ticker) {
  selected = ticker;
  const rows = await getJSON("ranking.json");
  const r = rows.find((x) => x.ticker === ticker);
  document.querySelectorAll("#ranking tr.row").forEach((tr) => tr.classList.toggle("sel", tr.dataset.t === ticker));
  const p = r.plan;
  const filt = Object.entries(r.filtered).map(([s, why]) => `${LABELS[s]}: ${why}`).join("; ");
  $("#plan").innerHTML = `<div class="mini-title"><span>${r.ticker} · ${r.sector}</span><span>Score ${r.score}</span></div>
    <div class="kv">
      <span>Setups</span><span>${r.setups.map((s) => LABELS[s]).join(", ") || "none passed"}</span>
      <span>Relative strength pctile</span><span>${r.rs_pct ?? "–"}</span>
      <span>ADX</span><span>${r.adx ?? "–"}</span>
      ${p ? `<span>Entry / Stop / Target (${p.rr}R)</span><span>${p.entry} / ${p.stop} / ${p.target}</span>
      <span>Suggested shares (risk $${p.risk_usd})</span><span>${p.shares}</span>` : ""}
      ${r.earnings ? `<span>Next earnings</span><span class="${r.earnings.soon ? "down" : ""}">${r.earnings.date} (${r.earnings.days}d)</span>` : ""}
      ${filt ? `<span>Filtered</span><span>${filt}</span>` : ""}
    </div>`;
  const host = $("#trend");
  host.innerHTML = "";
  const big = document.createElement("div");
  big.className = "card big";
  big.innerHTML = `<div class="mini-title"><span>${ticker}</span><span class="muted small">6M · SMA50 · Bollinger(20,2)</span></div><div class="chart"></div>`;
  host.appendChild(big);
  try { priceChart(big.querySelector(".chart"), await getJSON(`charts/${ticker}.json`), { candles: true }); }
  catch { big.querySelector(".chart").innerHTML = '<div class="empty">chart unavailable for this ticker</div>'; }
  if (matchMedia("(max-width: 1100px)").matches) big.scrollIntoView({ behavior: "smooth" });
}

async function renderSetups() {
  const setups = await getJSON("setups.json");
  const host = $("#setup-sections");
  host.innerHTML = "";
  for (const [key, s] of Object.entries(setups)) {
    const h = document.createElement("h2");
    h.textContent = `${s.label} (${s.tickers.length})`;
    host.appendChild(h);
    if (!s.tickers.length) {
      host.insertAdjacentHTML("beforeend", `<div class="empty">No chart${s.filtered.length ? ` · ${s.filtered.length} filtered by regime/sector/VIX` : ""}</div>`);
      continue;
    }
    const wrap = document.createElement("div");
    wrap.className = "minis";
    host.appendChild(wrap);
    const rows = await getJSON("ranking.json");
    for (const t of s.tickers.slice(0, 5)) {
      const r = rows.find((x) => x.ticker === t);
      await miniCard(wrap, t, r ? `score ${r.score}` : "");
    }
  }
}

async function init() {
  try {
    const meta = await getJSON("meta.json");
    $("#updated").textContent = `Updated ${new Date(meta.generated).toLocaleString()} · ${meta.universe} stocks · ${meta.signals} signals`;
    if (meta.warnings.length) { const b = $("#banner"); b.textContent = meta.warnings.join(" | "); b.hidden = false; }
    await renderMarket();
    await renderRanking();
    $("#show-filtered").addEventListener("change", renderRanking);
    if (meta.top.length) await select(meta.top[0]);
    else $("#plan").innerHTML = '<div class="empty">No signals today.</div>';
    await renderSetups();
  } catch (e) {
    const b = $("#banner"); b.textContent = `Could not load data: ${e.message}`; b.hidden = false;
  }
}
init();
