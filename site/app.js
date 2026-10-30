const $ = (s) => document.querySelector(s);
const dark = matchMedia("(prefers-color-scheme: dark)").matches;
const T = dark
  ? { bg: "#161b23", text: "#98a2b3", grid: "#262d38" }
  : { bg: "#ffffff", text: "#667085", grid: "#e3e6ec" };
const PALETTE = ["#2563eb", "#dc2626", "#16a34a", "#d97706", "#7c3aed", "#0891b2",
                 "#db2777", "#65a30d", "#475569", "#ea580c", "#0d9488"];
const LABELS = {
  breakout: "Momentum Breakout", mean_reversion: "Mean Reversion", squeeze: "Volatility Squeeze",
  pullback: "Trend Pullback", shock: "Momentum Shock",
};
const SHORT = { breakout: "BRK", mean_reversion: "MR", squeeze: "SQZ", pullback: "PB", shock: "SHK" };
const BUCKETS = [
  ["actionable", "Actionable"],
  ["wait", "Wait: earnings soon"],
  ["watch", "Watch only"],
  ["filtered", "Filtered by regime / sector / VIX"],
];
const cache = {};
const state = { rows: [], visible: [], selected: null, token: 0, filters: loadFilters() };

function loadFilters() {
  const d = { setups: Object.keys(LABELS), sector: "all", grade: "B", hideEarn: true, showFiltered: false };
  try {
    const s = JSON.parse(localStorage.getItem("filters") || "null");
    return s ? { ...d, ...s } : d;
  } catch { return d; }
}
function saveFilters() {
  try { localStorage.setItem("filters", JSON.stringify(state.filters)); } catch { /* ignore */ }
}

async function getJSON(path) {
  if (!cache[path]) {
    cache[path] = fetch(`data/${path}?v=${Date.now()}`).then((r) => {
      if (!r.ok) throw new Error(`${path}: ${r.status}`);
      return r.json();
    });
  }
  return cache[path];
}

const pct = (x) => (x == null ? "–" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`);
const cls = (x) => (x == null ? "" : x >= 0 ? "up" : "down");
const gradeBadge = (g) => `<span class="grade g-${g}" title="${g === "W" ? "Watch only" : "Grade " + g}">${g}</span>`;

/* ---------- charts ---------- */
function makeChart(el, height) {
  el.innerHTML = "";
  const chart = LightweightCharts.createChart(el, {
    width: el.clientWidth, height,
    layout: { background: { color: T.bg }, textColor: T.text },
    grid: { vertLines: { color: T.grid }, horzLines: { color: T.grid } },
    rightPriceScale: { borderColor: T.grid },
    timeScale: { borderColor: T.grid, fixLeftEdge: true, fixRightEdge: true },
  });
  if (el._ro) el._ro.disconnect();
  el._ro = new ResizeObserver(() => { try { chart.applyOptions({ width: el.clientWidth }); } catch { /* disposed */ } });
  el._ro.observe(el);
  el._chart = chart;
  return chart;
}

function priceChart(el, bars, { candles = false, sma200 = false, mini = false, lines = [] } = {}) {
  const chart = makeChart(el, el.clientHeight || 200);
  chart.priceScale("right").applyOptions({ scaleMargins: { top: 0.1, bottom: 0.25 } });
  const common = { priceLineVisible: false, lastValueVisible: !mini };
  const main = candles
    ? chart.addCandlestickSeries({ upColor: "#16a34a", downColor: "#dc2626", borderVisible: false,
                                   wickUpColor: "#16a34a", wickDownColor: "#dc2626", ...common })
    : chart.addLineSeries({ color: "#2563eb", lineWidth: 2, ...common });
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
  lines.forEach((l) => main.createPriceLine({ price: l.price, color: l.color, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: l.title }));
  const vol = chart.addHistogramSeries({ priceScaleId: "vol", priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: false });
  chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
  vol.setData(bars.map((b, i) => ({
    time: b.t, value: b.v,
    color: i > 0 && b.c < bars[i - 1].c ? "rgba(220,38,38,.45)" : "rgba(22,163,74,.45)",
  })));
  chart.timeScale().fitContent();
  return chart;
}

function rsiChart(el, bars) {
  const chart = makeChart(el, el.clientHeight || 90);
  const s = chart.addLineSeries({ color: "#7c3aed", lineWidth: 1.5, priceLineVisible: false, lastValueVisible: true });
  s.setData(bars.filter((b) => b.rsi != null).map((b) => ({ time: b.t, value: b.rsi })));
  [30, 70].forEach((p) => s.createPriceLine({ price: p, color: "#94a3b8", lineWidth: 1, lineStyle: 2, axisLabelVisible: false }));
  chart.timeScale().fitContent();
  return chart;
}

function spark(values) {
  const v = values.filter((x) => x != null);
  if (v.length < 2) return "";
  const lo = Math.min(...v), hi = Math.max(...v), w = 70, h = 22;
  const pts = v.map((x, i) => `${(i / (v.length - 1) * w).toFixed(1)},${(h - ((x - lo) / (hi - lo || 1)) * h).toFixed(1)}`).join(" ");
  const color = v[v.length - 1] >= v[0] ? "var(--up)" : "var(--down)";
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline fill="none" stroke="${color}" stroke-width="1.5" points="${pts}"/></svg>`;
}

/* ---------- left column ---------- */
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
  chart.priceScale("right").applyOptions({ scaleMargins: { top: 0.1, bottom: 0.1 } });
  chart.timeScale().fitContent();
  $("#sector-legend").innerHTML = legend.join("");
  $("#sector-table").innerHTML = `<tr><th>Sector</th><th>3M</th><th>1M</th><th>1W</th></tr>` +
    s.table.map((r) => `<tr><td>${r.name}</td><td class="${cls(r.r3m)}">${pct(r.r3m)}</td>
      <td class="${cls(r.r1m)}">${pct(r.r1m)}</td><td class="${cls(r.r1w)}">${pct(r.r1w)}</td></tr>`).join("");
}

/* ---------- filters ---------- */
function rowVisible(r) {
  const f = state.filters;
  const keys = [...new Set([...r.setups, ...Object.keys(r.filtered)])];
  if (!keys.some((k) => f.setups.includes(k))) return false;
  if (f.sector !== "all" && r.sector !== f.sector) return false;
  switch (r.bucket) {
    case "actionable": return f.grade !== "A" || r.grade === "A";
    case "watch": return f.grade === "all";
    case "wait": return !f.hideEarn;
    case "filtered": return f.showFiltered;
    default: return false;
  }
}

function initFilters() {
  const f = state.filters;
  $("#chips-setup").innerHTML = Object.keys(LABELS).map((k) =>
    `<button class="chip ${f.setups.includes(k) ? "on" : ""}" data-k="${k}" title="${LABELS[k]}">${SHORT[k]} · ${LABELS[k]}</button>`).join("");
  document.querySelectorAll("#chips-setup .chip").forEach((b) => b.addEventListener("click", () => {
    const k = b.dataset.k;
    f.setups = f.setups.includes(k) ? f.setups.filter((x) => x !== k) : [...f.setups, k];
    b.classList.toggle("on", f.setups.includes(k));
    onFilterChange();
  }));
  const sectors = [...new Set(state.rows.map((r) => r.sector))].sort();
  $("#f-sector").innerHTML = `<option value="all">All sectors</option>` + sectors.map((s) => `<option>${s}</option>`).join("");
  $("#f-sector").value = sectors.includes(f.sector) ? f.sector : "all";
  $("#f-grade").value = f.grade;
  $("#f-earn").checked = f.hideEarn;
  $("#show-filtered").checked = f.showFiltered;
  $("#f-sector").addEventListener("change", (e) => { f.sector = e.target.value; onFilterChange(); });
  $("#f-grade").addEventListener("change", (e) => { f.grade = e.target.value; onFilterChange(); });
  $("#f-earn").addEventListener("change", (e) => { f.hideEarn = e.target.checked; onFilterChange(); });
  $("#show-filtered").addEventListener("change", (e) => { f.showFiltered = e.target.checked; onFilterChange(); });
}

function onFilterChange() {
  saveFilters();
  renderRanking();
  renderSections();
}

/* ---------- ranking table ---------- */
function renderRanking() {
  state.visible = [];
  let body = "";
  for (const [bucket, title] of BUCKETS) {
    const rows = state.rows.filter((r) => r.bucket === bucket && rowVisible(r));
    if (!rows.length) continue;
    body += `<tr class="group"><td colspan="9">${title} (${rows.length})</td></tr>`;
    rows.forEach((r, i) => {
      state.visible.push(r.ticker);
      const tags = r.setups.map((s) => `<span class="tag" title="${LABELS[s]}">${SHORT[s]}</span>`).join("") +
        Object.keys(r.filtered).map((s) => `<span class="tag off" title="${LABELS[s]}: ${r.filtered[s]}">${SHORT[s]}</span>`).join("");
      const earn = r.earnings && r.earnings.soon ? `<span class="tag warn">Earn ${r.earnings.days}d</span>` : "";
      body += `<tr class="row ${state.selected === r.ticker ? "sel" : ""}" data-t="${r.ticker}">
        <td>${i + 1}</td><td><b>${r.ticker}</b></td><td class="${cls(r.chg)}">${r.close}</td>
        <td class="${cls(r.chg)}">${r.chg > 0 ? "+" : ""}${r.chg}%</td><td>${r.rsi}</td><td>${r.vol_ratio}×</td>
        <td>${gradeBadge(r.grade)} <span class="muted small">${r.score}</span></td>
        <td style="white-space:normal">${tags}${earn}</td><td>${spark(r.spark)}</td></tr>`;
    });
  }
  const head = `<tr><th>#</th><th>Ticker</th><th>Close</th><th>Chg</th><th>RSI</th><th>Vol</th><th>Grade</th><th>Setups</th><th></th></tr>`;
  $("#ranking").innerHTML = head + (body || `<tr><td colspan="9" class="empty">Nothing matches the current filters. Try "Include watch-only" or untick "hide earnings".</td></tr>`);
  document.querySelectorAll("#ranking tr.row").forEach((tr) => tr.addEventListener("click", () => select(tr.dataset.t)));
}

/* ---------- selection (big chart + detail) ---------- */
function highlight() {
  document.querySelectorAll("[data-t]").forEach((el) => el.classList.toggle("sel", el.dataset.t === state.selected));
}

async function select(ticker) {
  const r = state.rows.find((x) => x.ticker === ticker);
  if (!r) return;
  state.selected = ticker;
  const my = ++state.token;
  if (location.hash !== `#${ticker}`) history.replaceState(null, "", `#${ticker}`);
  highlight();
  renderDetail(r);
  $("#big-title").innerHTML = `${r.ticker} · ${r.sector} ${gradeBadge(r.grade)}`;
  $("#big-sub").textContent = "6M · SMA50 (orange) · Bollinger 20,2 (dashed)";
  let bars = null;
  try { bars = await getJSON(`charts/${ticker}.json`); } catch { /* handled below */ }
  if (my !== state.token) return;
  if (!bars) {
    $("#big-chart").innerHTML = '<div class="empty">Chart not available for this ticker.</div>';
    $("#big-rsi").innerHTML = "";
    return;
  }
  const p = r.plan;
  const lines = p ? [
    { price: p.entry, color: "#2563eb", title: "entry" },
    { price: p.stop, color: "#dc2626", title: "stop" },
    { price: p.target, color: "#16a34a", title: "target" },
  ] : [];
  priceChart($("#big-chart"), bars, { candles: true, lines });
  rsiChart($("#big-rsi"), bars);
  if (matchMedia("(max-width: 1100px)").matches) $("#big").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderDetail(r) {
  const p = r.plan;
  const order = [...r.setups, ...Object.keys(r.filtered)];
  const sigs = order.map((k) => {
    const s = r.signals[k];
    if (!s) return "";
    const off = r.filtered[k] ? `<span class="tag warn">filtered: ${r.filtered[k]}</span>` : "";
    return `<div class="sig"><h3><span>${LABELS[k]} ${off}</span><span>${gradeBadge(s.grade)} <span class="muted small">${s.score}</span></span></h3>
      <ul class="checks">${s.checks.map((c) => `<li class="${c.ok ? "ok" : "no"}">${c.ok ? "✓" : "✗"} ${c.t}</li>`).join("")}</ul>
      <div class="bars">${s.breakdown.map((b) => `<span>${b.n}</span><span class="bar"><i style="width:${Math.round(b.v * 100)}%"></i></span><span>${Math.round(b.w * 100)}%</span>`).join("")}</div></div>`;
  }).join("");
  $("#detail").innerHTML = `
    <div class="mini-title"><span>${r.ticker} trade plan</span><span class="muted small">RS pctile ${r.rs_pct ?? "–"} · ADX ${r.adx ?? "–"}</span></div>
    ${r.flags.length ? `<div class="flags">${r.flags.map((f) => `<span class="tag warn">${f}</span>`).join("")}</div>` : ""}
    <div class="kv">
      ${p ? `<span>Entry / Stop / Target (${p.rr}R)</span><span>${p.entry} / ${p.stop} / ${p.target}</span>
      <span>Suggested shares (risk $${p.risk_usd})</span><span>${p.shares}</span>` : "<span>Trade plan</span><span>n/a</span>"}
      ${r.earnings ? `<span>Next earnings</span><span class="${r.earnings.soon ? "down" : ""}">${r.earnings.date} (${r.earnings.days}d)</span>` : ""}
    </div>${sigs}`;
}

/* ---------- setup sections (small cards select into the big chart) ---------- */
async function miniCard(parent, r, key) {
  const card = document.createElement("div");
  card.className = "card";
  card.dataset.t = r.ticker;
  card.innerHTML = `<div class="mini-title"><span>${r.ticker}</span><span>${gradeBadge(r.signals[key].grade)} <span class="muted small">${r.signals[key].score}</span></span></div><div class="chart"></div>`;
  card.addEventListener("click", () => select(r.ticker));
  parent.appendChild(card);
  try {
    priceChart(card.querySelector(".chart"), await getJSON(`charts/${r.ticker}.json`), { mini: true });
  } catch { card.querySelector(".chart").innerHTML = '<div class="empty">chart unavailable</div>'; }
}

async function renderSections() {
  const setups = await getJSON("setups.json");
  const host = $("#setup-sections");
  host.innerHTML = "";
  for (const [key, s] of Object.entries(setups)) {
    if (!state.filters.setups.includes(key)) continue;
    const rows = s.tickers.map((t) => state.rows.find((r) => r.ticker === t)).filter((r) => r && rowVisible(r));
    const h = document.createElement("h2");
    h.textContent = `${s.label} (${rows.length})`;
    host.appendChild(h);
    if (!rows.length) {
      const extra = [s.watch && `${s.watch} watch`, s.wait && `${s.wait} wait (earnings)`, s.filtered && `${s.filtered} filtered`].filter(Boolean).join(" · ");
      host.insertAdjacentHTML("beforeend", `<div class="empty">No actionable signals${extra ? ` · ${extra}` : ""}</div>`);
      continue;
    }
    const wrap = document.createElement("div");
    wrap.className = "minis";
    host.appendChild(wrap);
    for (const r of rows) await miniCard(wrap, r, key);
  }
  highlight();
}

/* ---------- init ---------- */
document.addEventListener("keydown", (e) => {
  if (["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName)) return;
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  const v = state.visible;
  if (!v.length) return;
  let i = v.indexOf(state.selected);
  i = e.key === "ArrowDown" ? Math.min(i + 1, v.length - 1) : Math.max(i - 1, 0);
  e.preventDefault();
  select(v[i]);
  const row = document.querySelector(`#ranking tr[data-t="${v[i]}"]`);
  if (row) row.scrollIntoView({ block: "nearest" });
});
window.addEventListener("hashchange", () => {
  const t = location.hash.slice(1);
  if (t && t !== state.selected) select(t);
});

async function init() {
  try {
    const meta = await getJSON("meta.json");
    const f = meta.funnel;
    $("#updated").textContent = `Updated ${new Date(meta.generated).toLocaleString()}`;
    $("#funnel").innerHTML = `<b>${f.scanned}</b> scanned → <b>${f.liquid}</b> liquid → <b>${f.signals}</b> signals → <b>${f.actionable}</b> actionable` +
      ` <span class="small">(${f.wait} wait for earnings · ${f.watch} watch · ${f.filtered} filtered)</span>`;
    if (meta.warnings.length) { const b = $("#banner"); b.textContent = meta.warnings.join(" | "); b.hidden = false; }
    state.rows = await getJSON("ranking.json");
    await renderMarket();
    initFilters();
    renderRanking();
    const fromHash = location.hash.slice(1);
    const first = state.rows.find((r) => r.ticker === fromHash) || state.rows.find((r) => state.visible.includes(r.ticker)) || state.rows[0];
    if (first) await select(first.ticker);
    else $("#detail").innerHTML = '<div class="empty">No signals today.</div>';
    await renderSections();
  } catch (e) {
    const b = $("#banner"); b.textContent = `Could not load data: ${e.message}`; b.hidden = false;
  }
}
init();
