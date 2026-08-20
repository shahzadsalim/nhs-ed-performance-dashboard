const DATA_URL = "data/dashboard.json";

const state = { data: null, view: "trusts", search: "", region: "", visibleRows: [] };
const fmtInt = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });
const fmtCompact = new Intl.NumberFormat("en-GB", { notation: "compact", maximumFractionDigits: 1 });

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
  controls.hidden = false;
  table.hidden = false;
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
  link.download = `nhs-ed-dashboard-${state.view}-${state.data.latest_period}.csv`;
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
