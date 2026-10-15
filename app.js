const DATA_URL = "dashboard.json";

const state = {
  data: null,
  view: "rankings",
  rankingScope: "north-west",
  rankingTop: 5,
  search: "",
  region: "",
  visibleRows: [],
  comparisonMode: "trust",
  comparisonMetric: "type1_within4_pct",
  comparisonTrusts: ["", "", ""],
  comparisonSites: ["", "", ""],
};
const fmtInt = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });
const fmtCompact = new Intl.NumberFormat("en-GB", { notation: "compact", maximumFractionDigits: 1 });
const comparisonColours = ["#005eb8", "#d5281b", "#6f42c1", "#00856a"];
const comparisonMetrics = {
  type1_within4_pct: { label: "Type 1 within four hours", format: pct, percent: true },
  utc_within4_pct: { label: "UTC / Other A&E within four hours", format: pct, percent: true },
  provider_combined_within4_pct: { label: "Provider combined within four hours", format: pct, percent: true },
  type1_attendances: { label: "Type 1 attendances", format: integer, percent: false },
  utc_attendances: { label: "UTC / Other A&E attendances", format: integer, percent: false },
};
const siteComparisonMetrics = {
  type12_within4_pct: { label: "Type 1/2 ED within four hours", format: pct, percent: true },
  type12_over12_pct: { label: "Type 1/2 ED over 12 hours from arrival", format: pct, percent: true },
  type12_attendances: { label: "Type 1/2 ED attendances", format: integer, percent: false },
  type12_over12: { label: "Type 1/2 ED attendances over 12 hours", format: integer, percent: false },
  paediatric_type12_within4_pct: { label: "Paediatric Type 1/2 within four hours", format: pct, percent: true },
};

function pct(value) {
  return value === null || value === undefined ? "—" : `${Number(value).toFixed(1)}%`;
}
function integer(value) {
  return value === null || value === undefined ? "—" : fmtInt.format(value);
}
function compact(value) {
  return value === null || value === undefined ? "—" : fmtCompact.format(value);
}
function safe(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function metric(value, formatter = integer, primary = false) {
  const missing = value === null || value === undefined;
  return `<span class="metric ${missing ? "na" : ""} ${primary ? "primary" : ""}">${formatter(value)}</span>`;
}
function parseMonth(period) {
  const [year, month] = period.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1));
}
function monthLabel(period, short = false) {
  return new Intl.DateTimeFormat("en-GB", {
    month: short ? "short" : "long",
    year: short ? "2-digit" : "numeric",
    timeZone: "UTC",
  }).format(parseMonth(period));
}

function renderLineChart(containerId, points, valueKey, options = {}) {
  const container = document.getElementById(containerId);
  const valid = points.filter((point) => Number.isFinite(Number(point[valueKey])));
  if (!valid.length) {
    container.textContent = "No trend data available.";
    return;
  }
  const width = 560;
  const height = 225;
  const pad = { top: 16, right: 18, bottom: 35, left: 52 };
  const values = valid.map((point) => Number(point[valueKey]));
  let min = options.min ?? Math.min(...values);
  let max = options.max ?? Math.max(...values);
  const spread = max - min || Math.max(Math.abs(max), 1);
  min = options.min ?? Math.max(0, min - spread * 0.12);
  max = options.max ?? max + spread * 0.12;
  const x = (index) => pad.left + (index * (width - pad.left - pad.right)) / Math.max(valid.length - 1, 1);
  const y = (value) => pad.top + ((max - value) * (height - pad.top - pad.bottom)) / (max - min || 1);
  const line = valid.map((point, index) => `${index ? "L" : "M"}${x(index)},${y(point[valueKey])}`).join(" ");
  const area = `${line} L${x(valid.length - 1)},${height - pad.bottom} L${x(0)},${height - pad.bottom} Z`;
  const yTicks = Array.from({ length: 4 }, (_, index) => min + ((max - min) * index) / 3);
  const xIndexes = [...new Set([0, Math.floor((valid.length - 1) / 2), valid.length - 1])];
  const label = options.format || ((value) => value.toFixed(1));
  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img">
      ${yTicks.map((tick) => `<line class="grid-line" x1="${pad.left}" x2="${width - pad.right}" y1="${y(tick)}" y2="${y(tick)}" />`).join("")}
      ${yTicks.map((tick) => `<text class="axis-text" x="${pad.left - 8}" y="${y(tick) + 3}" text-anchor="end">${safe(label(tick))}</text>`).join("")}
      ${xIndexes.map((index) => `<text class="axis-text" x="${x(index)}" y="${height - 10}" text-anchor="middle">${safe(monthLabel(valid[index].period, true))}</text>`).join("")}
      <path class="trend-area" d="${area}" />
      <path class="trend-line" d="${line}" />
      ${valid.map((point, index) => `<circle class="trend-dot" cx="${x(index)}" cy="${y(point[valueKey])}" r="4" tabindex="0"><title>${monthLabel(point.period)}: ${label(point[valueKey])}</title></circle>`).join("")}
    </svg>`;
}

function hydrateSummary() {
  const { data } = state;
  document.getElementById("periodLabel").textContent = data.latest_period_display;
  document.getElementById("updatedLabel").textContent = new Date(data.generated_at).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
  });
  document.getElementById("kpiType1Performance").textContent = pct(data.national.type1_within4_pct);
  document.getElementById("kpiType1Attendances").textContent = compact(data.national.type1_attendances);
  document.getElementById("kpiUtcAttendances").textContent = compact(data.national.utc_attendances);
  document.getElementById("kpiDta12").textContent = compact(data.national.dta_12_plus);
  document.getElementById("sourceLink").href = data.sources.publication_page || data.sources.latest_monthly_csv;
  renderLineChart("performanceChart", data.national_trend, "type1_within4_pct", {
    format: (value) => `${value.toFixed(1)}%`,
  });
  renderLineChart("attendanceChart", data.national_trend, "type1_attendances", {
    format: (value) => fmtCompact.format(value),
  });
}

function regionOptions() {
  const regions = new Set();
  state.data.providers.forEach((row) => row.region && regions.add(row.region));
  state.data.sites.forEach((row) => row.region && row.region !== "Not mapped" && regions.add(row.region));
  const select = document.getElementById("regionSelect");
  [...regions].sort().forEach((region) => {
    const option = document.createElement("option");
    option.value = region;
    option.textContent = region;
    select.appendChild(option);
  });
}

function filterRows(rows, fields) {
  const query = state.search.trim().toLowerCase();
  return rows.filter((row) => {
    if (state.region && row.region !== state.region) return false;
    if (!query) return true;
    return fields.some((field) => String(row[field] ?? "").toLowerCase().includes(query));
  });
}

function trustView() {
  const rows = filterRows(
    state.data.providers.filter((row) => row.type1_attendances > 0),
    ["name", "code", "region"],
  ).sort((a, b) => b.type1_attendances - a.type1_attendances);
  state.visibleRows = rows.map((row) => ({
    Trust: row.name,
    Region: row.region,
    "Type 1 attendances": row.type1_attendances,
    "Type 1 within 4h": pct(row.type1_within4_pct),
    "UTC attendances": row.utc_attendances,
    "UTC within 4h": pct(row.utc_within4_pct),
    "Provider combined": pct(row.provider_combined_within4_pct),
    "Official footprint": pct(row.footprint_within4_pct),
    "12h+ after DTA": row.dta_12_plus,
  }));
  return `<table>
    <thead><tr><th>Trust / provider</th><th>Region</th><th>Type 1 attendances</th><th>Type 1 within 4h</th><th>UTC attendances</th><th>UTC within 4h</th><th>Provider combined</th><th>Official footprint</th><th>12h+ after DTA</th></tr></thead>
    <tbody>${rows.map((row) => `
      <tr class="${row.code === "RWW" ? "highlight" : ""}">
        <td class="name-cell">${safe(row.name)}${row.code === "RWW" ? '<span class="subtext">Highlighted: North Cheshire and Mersey</span>' : `<span class="subtext">${safe(row.code)}</span>`}</td>
        <td>${safe(row.region)}</td><td>${metric(row.type1_attendances)}</td><td>${metric(row.type1_within4_pct, pct, true)}</td>
        <td>${metric(row.utc_attendances)}</td><td>${metric(row.utc_within4_pct, pct)}</td><td>${metric(row.provider_combined_within4_pct, pct)}</td>
        <td>${metric(row.footprint_within4_pct, pct)}</td><td>${metric(row.dta_12_plus)}</td>
      </tr>`).join("")}</tbody>
  </table>`;
}

function edSiteView() {
  const rows = filterRows(
    state.data.sites.filter((row) => row.type12_attendances > 0),
    ["name", "code", "provider_name", "region"],
  ).sort((a, b) => b.type12_attendances - a.type12_attendances);
  state.visibleRows = rows.map((row) => ({
    Site: row.name, Trust: row.provider_name, Region: row.region, Type: row.site_type,
    Attendances: row.type12_attendances, "Within 4h": pct(row.type12_within4_pct),
    "Over 12h": row.type12_over12, "Over 12h %": pct(row.type12_over12_pct),
    "Paediatric within 4h": pct(row.paediatric_type12_within4_pct),
  }));
  return `<table>
    <thead><tr><th>Hospital site</th><th>Trust</th><th>Region</th><th>Type</th><th>Attendances</th><th>Within 4h</th><th>Over 12h</th><th>Over 12h %</th><th>Paediatric within 4h</th></tr></thead>
    <tbody>${rows.map((row) => `
      <tr class="${row.code === "RWWWH" ? "highlight" : ""}">
        <td class="name-cell">${safe(row.name)}<span class="subtext">${safe(row.code)}</span></td><td>${safe(row.provider_name)}</td>
        <td>${safe(row.region)}</td><td>${safe(row.site_type)}</td><td>${metric(row.type12_attendances)}</td>
        <td>${metric(row.type12_within4_pct, pct, true)}</td><td>${metric(row.type12_over12)}</td><td>${metric(row.type12_over12_pct, pct)}</td>
        <td>${metric(row.paediatric_type12_within4_pct, pct)}</td>
      </tr>`).join("")}</tbody>
  </table>`;
}

function utcSiteView() {
  const rows = filterRows(
    state.data.sites.filter((row) => row.utc_attendances > 0),
    ["name", "code", "provider_name", "region"],
  ).sort((a, b) => b.utc_attendances - a.utc_attendances);
  state.visibleRows = rows.map((row) => ({
    Site: row.name, Trust: row.provider_name, Region: row.region, Type: row.site_type,
    "UTC attendances": row.utc_attendances, "All-type over 12h": row.all_over12,
    "All-type over 12h %": pct(row.all_over12_pct),
    "Paediatric UTC attendances": row.paediatric_utc_attendances,
    "Paediatric UTC within 4h": pct(row.paediatric_utc_within4_pct),
  }));
  return `<table>
    <thead><tr><th>Urgent-care site</th><th>Trust / provider</th><th>Region</th><th>Type</th><th>UTC attendances</th><th>All-type over 12h</th><th>Over 12h %</th><th>Paediatric UTC attendances</th><th>Paediatric within 4h</th></tr></thead>
    <tbody>${rows.map((row) => `
      <tr class="${row.code === "RWWHG" ? "highlight" : ""}">
        <td class="name-cell">${safe(row.name)}${row.code === "RWWHG" ? '<span class="subtext">Highlighted: Halton Hospital</span>' : `<span class="subtext">${safe(row.code)}</span>`}</td>
        <td>${safe(row.provider_name)}</td><td>${safe(row.region)}</td><td>${safe(row.site_type)}</td><td>${metric(row.utc_attendances)}</td>
        <td>${metric(row.all_over12)}</td><td>${metric(row.all_over12_pct, pct)}</td><td>${metric(row.paediatric_utc_attendances)}</td>
        <td>${metric(row.paediatric_utc_within4_pct, pct)}</td>
      </tr>`).join("")}</tbody>
  </table>`;
}

function comparisonProviderOptions(selectedCode) {
  return state.data.providers
    .filter((provider) => state.data.provider_trends[provider.code]?.length)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((provider) => `<option value="${safe(provider.code)}" ${provider.code === selectedCode ? "selected" : ""}>${safe(provider.name)}</option>`)
    .join("");
}

function comparisonSiteOptions(selectedCode) {
  return state.data.sites
    .filter((site) => site.type12_attendances > 0 && state.data.site_trends?.[site.code]?.length)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((site) => `<option value="${safe(site.code)}" ${site.code === selectedCode ? "selected" : ""}>${safe(site.name)} — ${safe(site.provider_name)}</option>`)
    .join("");
}

function comparisonChart(series, periods, metricKey, metricDefinitions) {
  const metricDefinition = metricDefinitions[metricKey];
  const width = 960;
  const height = 350;
  const pad = { top: 22, right: 24, bottom: 48, left: 66 };
  const allValues = series.flatMap((item) => item.points)
    .map((point) => point[metricKey])
    .filter((value) => value !== null && value !== undefined && Number.isFinite(Number(value)))
    .map(Number);
  if (!allValues.length) return '<p class="comparison-empty">No comparable data are available for this selection.</p>';

  const min = 0;
  const max = metricDefinition.percent ? 100 : Math.max(...allValues) * 1.1;
  const x = (period) => {
    const index = periods.indexOf(period);
    return pad.left + (index * (width - pad.left - pad.right)) / Math.max(periods.length - 1, 1);
  };
  const y = (value) => pad.top + ((max - value) * (height - pad.top - pad.bottom)) / Math.max(max - min, 1);
  const yTicks = Array.from({ length: 5 }, (_, index) => min + ((max - min) * index) / 4);
  const xIndexes = periods.map((_, index) => index).filter((index) => index % 2 === 0 || index === periods.length - 1);
  const axisLabel = metricDefinition.percent
    ? (value) => `${Math.round(value)}%`
    : (value) => fmtCompact.format(value);

  const paths = series.map((item, seriesIndex) => {
    const valid = item.points.filter((point) => (
      periods.includes(point.period)
      && point[metricKey] !== null
      && point[metricKey] !== undefined
      && Number.isFinite(Number(point[metricKey]))
    ));
    const path = valid.map((point, index) => `${index ? "L" : "M"}${x(point.period)},${y(Number(point[metricKey]))}`).join(" ");
    const colour = comparisonColours[seriesIndex % comparisonColours.length];
    return `
      <path class="comparison-line" stroke="${colour}" d="${path}" />
      ${valid.map((point) => `<circle class="comparison-dot" fill="${colour}" cx="${x(point.period)}" cy="${y(Number(point[metricKey]))}" r="4" tabindex="0"><title>${safe(item.name)} — ${monthLabel(point.period)}: ${metricDefinition.format(point[metricKey])}</title></circle>`).join("")}`;
  }).join("");

  return `<div class="comparison-chart-scroll"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${safe(metricDefinition.label)} monthly comparison">
    ${yTicks.map((tick) => `<line class="grid-line" x1="${pad.left}" x2="${width - pad.right}" y1="${y(tick)}" y2="${y(tick)}" />`).join("")}
    ${yTicks.map((tick) => `<text class="axis-text" x="${pad.left - 9}" y="${y(tick) + 4}" text-anchor="end">${safe(axisLabel(tick))}</text>`).join("")}
    ${xIndexes.map((index) => `<text class="axis-text" x="${x(periods[index])}" y="${height - 14}" text-anchor="middle">${safe(monthLabel(periods[index], true))}</text>`).join("")}
    ${paths}
  </svg></div>`;
}

function comparisonView() {
  const siteMode = state.comparisonMode === "site";
  const metricDefinitions = siteMode ? siteComparisonMetrics : comparisonMetrics;
  if (!metricDefinitions[state.comparisonMetric]) {
    state.comparisonMetric = siteMode ? "type12_within4_pct" : "type1_within4_pct";
  }
  const metricDefinition = metricDefinitions[state.comparisonMetric];
  const allSitePeriods = [...new Set(Object.values(state.data.site_trends || {})
    .flatMap((points) => points.map((point) => point.period)))].sort().slice(-12);
  const periods = siteMode
    ? allSitePeriods
    : state.data.national_trend.slice(-12).map((point) => point.period);
  const selections = siteMode ? state.comparisonSites : state.comparisonTrusts;
  const selectedCodes = [...new Set(selections.filter(Boolean))];
  const providerByCode = Object.fromEntries(state.data.providers.map((provider) => [provider.code, provider]));
  const siteByCode = Object.fromEntries(state.data.sites.map((site) => [site.code, site]));
  const series = siteMode
    ? selectedCodes.map((code) => ({
      name: siteByCode[code]?.name || code,
      points: (state.data.site_trends?.[code] || []).filter((point) => periods.includes(point.period)),
    }))
    : [
      { name: "England", points: state.data.national_trend.filter((point) => periods.includes(point.period)) },
      ...selectedCodes.map((code) => ({
        name: providerByCode[code]?.name || code,
        points: (state.data.provider_trends[code] || []).filter((point) => periods.includes(point.period)),
      })),
    ];

  state.visibleRows = periods.map((period) => {
    const row = { Month: monthLabel(period) };
    series.forEach((item) => {
      const point = item.points.find((candidate) => candidate.period === period);
      row[item.name] = metricDefinition.format(point?.[state.comparisonMetric]);
    });
    return row;
  });

  const tableHeaders = ["Month", ...series.map((item) => item.name)];
  const selectors = selections.map((code, index) => `
    <label><span>${siteMode ? "ED site" : "Trust"} ${index + 1}</span><select class="${siteMode ? "comparison-site" : "comparison-trust"}" data-slot="${index}">
      <option value="">Select ${siteMode ? "an ED site" : "a trust"}</option>
      ${siteMode ? comparisonSiteOptions(code) : comparisonProviderOptions(code)}
    </select></label>`).join("");
  const metricOptions = Object.entries(metricDefinitions).map(([key, definition]) => (
    `<option value="${key}" ${key === state.comparisonMetric ? "selected" : ""}>${safe(definition.label)}</option>`
  )).join("");

  return `<div class="comparison-view">
    <div class="comparison-intro">
      <div><p class="section-kicker">Historical performance</p><h3>Compare monthly ${siteMode ? "ED-site" : "trust"} results</h3></div>
      <p>${siteMode ? `Choose up to three individual Type 1/2 ED sites. ${periods.length} comparable published month${periods.length === 1 ? " is" : "s are"} currently available, up to a maximum of 12.` : "Choose up to three trusts. England is retained as a reference. The most recent 12 published months are shown."}</p>
    </div>
    <div class="comparison-controls">
      <label><span>Compare</span><select id="comparisonMode">
        <option value="trust" ${siteMode ? "" : "selected"}>Trusts</option>
        <option value="site" ${siteMode ? "selected" : ""}>Individual ED sites</option>
      </select></label>
      <label><span>Measure</span><select id="comparisonMetric">${metricOptions}</select></label>
      ${selectors}
    </div>
    <div class="comparison-legend">
      ${series.map((item, index) => `<span><i style="background:${comparisonColours[index % comparisonColours.length]}"></i>${safe(item.name)}</span>`).join("")}
    </div>
    <div class="comparison-chart">${comparisonChart(series, periods, state.comparisonMetric, metricDefinitions)}</div>
    ${selectedCodes.length ? "" : `<p class="comparison-hint">Select ${siteMode ? "an ED site" : "a trust"} above to add it to the comparison.</p>`}
    <div class="comparison-table-wrap"><table class="comparison-table">
      <thead><tr>${tableHeaders.map((heading) => `<th>${safe(heading)}</th>`).join("")}</tr></thead>
      <tbody>${state.visibleRows.map((row) => `<tr>${tableHeaders.map((heading) => `<td>${safe(row[heading])}</td>`).join("")}</tr>`).join("")}</tbody>
    </table></div>
    <p class="comparison-note">${siteMode ? "Site-level figures use NHS England's ECDS supplementary analysis. Comparable site reporting begins with the newer 2025 publication format; 12-hour-from-arrival measures apply to Type 1/2 attendances and not UTC-only sites." : "Provider-reported Type 1, UTC and combined measures are shown consistently across the selected period. The official acute trust-footprint methodology changed from April 2026 and is therefore not used in this historical comparison."}</p>
  </div>`;
}

function bindComparisonControls() {
  document.getElementById("comparisonMode").addEventListener("change", (event) => {
    state.comparisonMode = event.target.value;
    state.comparisonMetric = state.comparisonMode === "site" ? "type12_within4_pct" : "type1_within4_pct";
    renderExplorer();
  });
  document.getElementById("comparisonMetric").addEventListener("change", (event) => {
    state.comparisonMetric = event.target.value;
    renderExplorer();
  });
  document.querySelectorAll(".comparison-trust").forEach((select) => {
    select.addEventListener("change", (event) => {
      state.comparisonTrusts[Number(event.target.dataset.slot)] = event.target.value;
      renderExplorer();
    });
  });
  document.querySelectorAll(".comparison-site").forEach((select) => {
    select.addEventListener("change", (event) => {
      state.comparisonSites[Number(event.target.dataset.slot)] = event.target.value;
      renderExplorer();
    });
  });
}

// NHS England North West trust directory, checked 15 October 2026.
// Explicit Type 1 provider membership avoids ambiguous source regional labels.
const cheshireMerseysideCodes = new Set(["RBS", "RJN", "RBT", "REM", "RBN", "RJR", "RWW", "RBL"]);
const northWestCodes = new Set([...cheshireMerseysideCodes, "RTX", "RXL", "R0A", "RMP", "RWJ", "RXR", "RM3", "RRF", "RMC", "RXN"]);
const rankingScopes = { "england": "England", "north-west": "North West", "cheshire-merseyside": "Cheshire and Merseyside" };

function rankedProviders(providers, scope) {
  const membership = scope === "cheshire-merseyside" ? cheshireMerseysideCodes : scope === "north-west" ? northWestCodes : null;
  const rows = providers.filter(row => row.type1_attendances > 0 &&
    typeof row.type1_within4_pct === "number" && Number.isFinite(row.type1_within4_pct) &&
    row.type1_within4_pct >= 0 && row.type1_within4_pct <= 100 && (!membership || membership.has(row.code)))
    .slice().sort((a, b) => b.type1_within4_pct - a.type1_within4_pct || a.name.localeCompare(b.name));
  let rank = 0;
  return rows.map((row, index) => {
    if (index === 0 || row.type1_within4_pct !== rows[index - 1].type1_within4_pct) rank = index + 1;
    return { ...row, rank };
  });
}

function rankingsView() {
  const rows = rankedProviders(state.data.providers, state.rankingScope);
  const englandRanks = new Map(rankedProviders(state.data.providers, "england").map(row => [row.code, row.rank]));
  const leaders = rows.filter(row => row.rank <= state.rankingTop);
  const area = rankingScopes[state.rankingScope];
  state.visibleRows = rows.map(row => ({ Rank: row.rank, Trust: row.name, Code: row.code,
    Area: area, Period: state.data.latest_period, "Type 1 within four hours (%)": row.type1_within4_pct,
    "Type 1 attendances": row.type1_attendances, "England rank": englandRanks.get(row.code) }));
  return `<div class="ranking-view">
    <p class="section-kicker">Monthly Type 1 ED ranking</p>
    <h3>Four-hour performance · ${safe(state.data.latest_period_display)}</h3>
    <p class="ranking-intro">Ranked by the percentage of Type 1 major ED attendances completed within four hours. Higher is better.</p>
    <div class="ranking-controls">
      <label>Area<select id="rankingScope">${Object.entries(rankingScopes).map(([value, label]) => `<option value="${value}" ${state.rankingScope === value ? "selected" : ""}>${label}</option>`).join("")}</select></label>
      <label>Highlights<select id="rankingTop"><option value="3" ${state.rankingTop === 3 ? "selected" : ""}>Top three</option><option value="5" ${state.rankingTop === 5 ? "selected" : ""}>Top five</option></select></label>
    </div>
    <p class="ranking-context" aria-live="polite">${safe(area)} · ${rows.length} trusts ranked · Latest published month</p>
    <div class="ranking-leaders">${leaders.map(row => `<article class="ranking-card ${row.code === "RWW" ? "ranking-local" : ""}"><span class="ranking-position">#${row.rank}</span><h4>${safe(row.name)}</h4><strong>${pct(row.type1_within4_pct)}</strong><p>${integer(row.type1_attendances)} Type 1 attendances</p></article>`).join("") || "<p>No comparable Type 1 results are available for this area.</p>"}</div>
    <h4>Full ranking · ${safe(area)}</h4>
    <div class="ranking-table-wrap"><table><caption class="sr-only">${safe(area)} Type 1 four-hour ranking for ${safe(state.data.latest_period_display)}</caption><thead><tr><th scope="col">Rank</th><th scope="col">Trust</th><th scope="col">Within four hours</th><th scope="col">Type 1 attendances</th><th scope="col">England rank</th></tr></thead><tbody>${rows.map(row => `<tr class="${row.code === "RWW" ? "highlight" : ""}"><td>${row.rank}</td><td class="name-cell">${safe(row.name)}<span class="subtext">${safe(row.code)}${row.code === "RBS" ? " · Specialist children's trust" : ""}</span></td><td class="metric primary">${pct(row.type1_within4_pct)}</td><td>${integer(row.type1_attendances)}</td><td>${englandRanks.get(row.code)}</td></tr>`).join("")}</tbody></table></div>
    <p class="ranking-note">Equal published percentages share a rank; all ties within the top ${state.rankingTop} positions are highlighted. Missing percentages and trusts with no Type 1 attendances are excluded. This measures four-hour performance, not overall quality of care; case mix and specialist children's services differ.</p>
    <p class="ranking-note">Trust-level results include all of a trust's Type 1 services, including services across area boundaries. North West and Cheshire and Merseyside membership uses provider codes checked against the <a href="https://www.england.nhs.uk/north-west/ccgs-and-trusts/icbs-trusts-in-the-north-west/" target="_blank" rel="noreferrer">NHS England directory</a> and <a href="https://www.cheshireandmerseyside.nhs.uk/your-health/cheshire-and-merseyside-provider-collaborative/" target="_blank" rel="noreferrer">local provider list</a> (October 2026). Membership needs review after trust reorganisations. Rankings refresh when the monthly dashboard data updates.</p>
  </div>`;
}

function notesView() {
  const { definitions, sources } = state.data;
  state.visibleRows = [];
  const notes = [
    ["Type 1 major ED", definitions.type1],
    ["Urgent-care / Other A&E", definitions.utc],
    ["Provider combined", definitions.provider_combined],
    ["Official trust footprint", definitions.footprint],
    ["ECDS site data", "ECDS site figures may be provisional and are published as official statistics in development. Type 1 and Type 2 are grouped in the current site-level four-hour workbook."],
    ["UTC site limitation", "Individual UTC activity is available for many sites, but public four-hour performance is not consistently available for every adult UTC site. A dash means the source does not publish a comparable value."],
    ["Methodology break", "From April 2026, NHS England changed the acute-provider four-hour metric to the acute trust footprint. Trends crossing that date should be interpreted with care."],
    ["Primary source", `<a href="${safe(sources.publication_page)}" target="_blank" rel="noreferrer">NHS England A&E Attendances and Emergency Admissions</a>`],
  ];
  return notes.map(([title, body]) => `<article class="note-card"><h3>${safe(title)}</h3><p>${body}</p></article>`).join("");
}

function renderExplorer() {
  const controls = document.getElementById("tableControls");
  const table = document.getElementById("tableContainer");
  const notes = document.getElementById("notesContainer");
  if (state.view === "notes") {
    controls.hidden = true;
    table.hidden = true;
    notes.hidden = false;
    notes.innerHTML = notesView();
    document.getElementById("downloadButton").hidden = true;
    return;
  }
  table.classList.toggle("ranking-mode", state.view === "rankings");
  if (state.view === "rankings") {
    controls.hidden = true;
    table.hidden = false;
    table.classList.remove("comparison-mode");
    notes.hidden = true;
    document.getElementById("downloadButton").hidden = false;
    table.innerHTML = rankingsView();
    document.getElementById("rankingScope").addEventListener("change", event => {
      state.rankingScope = event.target.value;
      renderExplorer();
    });
    document.getElementById("rankingTop").addEventListener("change", event => {
      state.rankingTop = Number(event.target.value);
      renderExplorer();
    });
    return;
  }
  if (state.view === "trends") {
    controls.hidden = true;
    table.hidden = false;
    table.classList.add("comparison-mode");
    notes.hidden = true;
    document.getElementById("downloadButton").hidden = false;
    table.innerHTML = comparisonView();
    bindComparisonControls();
    return;
  }
  controls.hidden = false;
  table.hidden = false;
  table.classList.remove("comparison-mode");
  notes.hidden = true;
  document.getElementById("downloadButton").hidden = false;
  table.innerHTML = state.view === "trusts" ? trustView() : state.view === "eds" ? edSiteView() : utcSiteView();
  document.getElementById("resultCount").textContent = `${integer(state.visibleRows.length)} results`;
}

function downloadVisibleRows() {
  if (!state.visibleRows.length) return;
  const headers = Object.keys(state.visibleRows[0]);
  const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const csv = [headers.map(quote).join(","), ...state.visibleRows.map((row) => headers.map((header) => quote(row[header])).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `nhs-ed-dashboard-${state.view}${state.view === "rankings" ? `-${state.rankingScope}` : ""}-${state.data.latest_period}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function bindEvents() {
  document.querySelectorAll(".tab-button").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".tab-button").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      state.view = button.dataset.view;
      renderExplorer();
    });
  });
  document.getElementById("searchInput").addEventListener("input", (event) => {
    state.search = event.target.value;
    renderExplorer();
  });
  document.getElementById("regionSelect").addEventListener("change", (event) => {
    state.region = event.target.value;
    renderExplorer();
  });
  document.getElementById("downloadButton").addEventListener("click", downloadVisibleRows);
  document.getElementById("themeToggle").addEventListener("click", () => {
    const root = document.documentElement;
    const dark = root.dataset.theme === "dark";
    root.dataset.theme = dark ? "light" : "dark";
    document.getElementById("themeToggle").textContent = dark ? "Dark mode" : "Light mode";
  });
}

async function init() {
  try {
    const response = await fetch(DATA_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`Data request failed (${response.status})`);
    state.data = await response.json();
    hydrateSummary();
    regionOptions();
    bindEvents();
    renderExplorer();
  } catch (error) {
    const banner = document.getElementById("errorBanner");
    banner.hidden = false;
    banner.textContent = `The dashboard data could not be loaded. ${error.message}`;
  }
}

init();
