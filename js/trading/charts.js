// Chart helpers for the trading tabs, carried from the Mac's sim-common.js: signs and colours that follow the value
// as shown, and Lightweight Charts that follow the theme. The library is vendored (vendor/) and attaches a global.

// Signs and colours follow the value as shown (two decimals of a percent): -0.003% shows as 0.00%, uncoloured.
const shown = (v) => Math.round(Number(v) * 10000);
export const signClass = (v) => (v == null ? "" : shown(v) > 0 ? "up" : shown(v) < 0 ? "down" : "");
export const pctOrDash = (v) => {
  if (v == null || !isFinite(v)) return "—";
  const r = shown(v);
  return `${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.abs(r / 100).toFixed(2)}%`;
};

export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function chartTheme() {
  return {
    layout: { background: { color: "rgba(0,0,0,0)" }, textColor: cssVar("--muted"), fontFamily: cssVar("--mono") },
    grid: { vertLines: { color: cssVar("--chart-grid") }, horzLines: { color: cssVar("--chart-grid") } },
    rightPriceScale: { borderColor: cssVar("--edge") },
    timeScale: { borderColor: cssVar("--edge") },
  };
}

/** Chart points sorted by date, with invalid points and repeated dates dropped (the library throws on either). */
export function cleanSeries(points) {
  const byTime = new Map();
  for (const p of Array.isArray(points) ? points : []) {
    if (!p || typeof p.time !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(p.time) || typeof p.value !== "number" || !Number.isFinite(p.value)) continue;
    byTime.set(p.time, { time: p.time, value: p.value });     // the later of two points on one day wins
  }
  return [...byTime.values()].sort((a, b) => a.time.localeCompare(b.time));
}

/** True when the vendored library has loaded (it is a deferred classic script). */
export const chartsReady = () => typeof LightweightCharts !== "undefined";

/** A line chart that follows the theme. Returns {chart, lines, dispose}. */
export function lineChart(container, series, extra = {}) {
  const chart = LightweightCharts.createChart(container, { autoSize: true, ...chartTheme(), ...extra });
  const lines = series.map(({ name, points, color }) => {
    const line = chart.addLineSeries({ color: color || cssVar("--accent"), lineWidth: 2, title: name, priceLineVisible: false });
    line.setData(cleanSeries(points));
    return line;
  });
  chart.timeScale().fitContent();
  const recolour = () => chart.applyOptions(chartTheme());
  window.addEventListener("themechange", recolour);
  return { chart, lines, dispose: () => { window.removeEventListener("themechange", recolour); chart.remove(); } };
}

/** The Research tab's six-month price chart: one area series that follows the theme. */
export function areaChart(container, points) {
  const chart = LightweightCharts.createChart(container, { autoSize: true });
  const series = chart.addAreaSeries({ lineWidth: 2 });
  const colour = () => {
    chart.applyOptions(chartTheme());
    series.applyOptions({ lineColor: cssVar("--accent"), topColor: cssVar("--accent-glow"), bottomColor: "rgba(0,0,0,0)" });
  };
  colour();
  series.setData(cleanSeries(points));
  chart.timeScale().fitContent();
  window.addEventListener("themechange", colour);
  return { chart, series, dispose: () => { window.removeEventListener("themechange", colour); chart.remove(); } };
}
