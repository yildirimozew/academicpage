const AXES = {
  alpha: { label: "Alpha · AR weight", short: "Alpha", scale: "linear", format: formatDecimal },
  repetition: { label: "Repetition · R", short: "R", scale: "log", format: formatDecimal },
  modelParams: { label: "Model parameters", short: "Model size", scale: "log", format: formatCompact },
  uniqueBytes: { label: "Unique corpus bytes", short: "Unique bytes", scale: "log", format: formatCompact },
  uniqueTokens: { label: "Unique corpus tokens", short: "Unique tokens", scale: "log", format: formatCompact },
  compression: { label: "Compression · bytes/token", short: "Compression", scale: "linear", format: formatDecimal },
  tokensSeen: { label: "Training tokens seen", short: "Tokens seen", scale: "log", format: formatCompact },
  tokenShare: { label: "Token share", short: "Token share", scale: "linear", format: formatPercent },
  causalBpb: { label: "Causal BPB", short: "Causal BPB", scale: "linear", format: formatDecimal },
  legacyLoss: { label: "Legacy validation loss", short: "Legacy loss", scale: "linear", format: formatDecimal },
  arPasses: { label: "AR-equivalent passes · αR", short: "AR passes", scale: "log", format: formatDecimal },
  mdPasses: { label: "MD-equivalent passes · (1−α)R", short: "MD passes", scale: "log", format: formatDecimal },
  arTokens: { label: "AR-weighted tokens", short: "AR tokens", scale: "log", format: formatCompact },
  mdTokens: { label: "MD-weighted tokens", short: "MD tokens", scale: "log", format: formatCompact },
};

const COLORS = [
  "#6ee7d0", "#ffca7a", "#8fb3ff", "#f28cb1", "#c29cff", "#79d3ff", "#ff9e76", "#a9df78",
  "#e6a5ff", "#73e1a2", "#ffd166", "#b0c7e8", "#ff7d8e", "#8ee3ef", "#d7bc79", "#b3a7ff",
  "#e59c63", "#84c99b", "#f6a6d7", "#9aa7ff", "#c8d878", "#ffb3a7", "#7fd3c5", "#d4a8ff",
];

const STATUS_ORDER = [
  "Current / valid",
  "Current / protocol variant",
  "Current / partial",
  "Legacy / bugged BPB",
  "Legacy / no causal BPB",
  "No final causal BPB",
  "Debug / support",
];

const DEFAULT_STATUSES = new Set(["Current / valid", "Current / protocol variant", "Current / partial"]);
const DEFAULTS = { dimensions: 2, x: "alpha", y: "repetition", z: "causalBpb", color: "language" };

const state = {
  payload: null,
  points: [],
  filtered: [],
  languages: [],
  languageColors: new Map(),
  selectedLanguages: new Set(),
  selectedStatuses: new Set(DEFAULT_STATUSES),
  dimensions: DEFAULTS.dimensions,
  activeView: "explorer",
};

const el = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  cacheElements();
  wireStaticEvents();
  populateAxisSelectors();

  try {
    const response = await fetch("./data/runs.json");
    if (!response.ok) throw new Error(`Data request failed: ${response.status}`);
    state.payload = await response.json();
    state.points = state.payload.points;
    prepareDimensions();
    populateFilters();
    renderAll();
    el.snapshotLabel.textContent = `Snapshot ${state.payload.meta.snapshot} · ${formatInteger(state.payload.meta.points)} points`;
    el.loadStatus.textContent = "Snapshot ready";
    el.heroStatus.classList.add("ready");
  } catch (error) {
    console.error(error);
    el.loadStatus.textContent = "Could not load run data";
    el.mainPlot.innerHTML = `<div class="empty-state"><strong>Data failed to load.</strong><span>${escapeHtml(error.message)}</span></div>`;
  }
}

function cacheElements() {
  const ids = [
    "snapshot-label", "load-status", "x-axis", "y-axis", "z-axis", "z-field", "color-axis",
    "status-options", "experiment-filter", "state-filter", "language-search", "language-options",
    "main-plot", "parallel-plot", "plot-title", "plot-caption", "empty-state", "point-detail",
    "metric-points", "metric-runs", "metric-languages", "metric-experiments", "parallel-color",
    "coverage-grid", "reset-button", "status-all", "languages-all", "languages-none", "download-button",
  ];
  ids.forEach((id) => { el[toCamel(id)] = document.getElementById(id); });
  el.heroStatus = document.querySelector(".hero-status");
}

function wireStaticEvents() {
  document.querySelectorAll("[data-dimensions]").forEach((button) => {
    button.addEventListener("click", () => {
      state.dimensions = Number(button.dataset.dimensions);
      document.querySelectorAll("[data-dimensions]").forEach((item) => item.classList.toggle("active", item === button));
      el.zField.hidden = state.dimensions !== 3;
      renderExplorer();
    });
  });

  [el.xAxis, el.yAxis, el.zAxis, el.colorAxis].forEach((control) => control.addEventListener("change", renderExplorer));
  [el.experimentFilter, el.stateFilter].forEach((control) => control.addEventListener("change", renderAll));
  el.parallelColor.addEventListener("change", renderParallel);
  el.languageSearch.addEventListener("input", filterLanguageButtons);
  el.resetButton.addEventListener("click", resetControls);
  el.statusAll.addEventListener("click", () => {
    const allSelected = state.selectedStatuses.size === STATUS_ORDER.length;
    state.selectedStatuses = new Set(allSelected ? DEFAULT_STATUSES : STATUS_ORDER);
    syncStatusInputs();
    renderAll();
  });
  el.languagesAll.addEventListener("click", () => {
    state.selectedLanguages = new Set(state.languages);
    syncLanguageButtons();
    renderAll();
  });
  el.languagesNone.addEventListener("click", () => {
    state.selectedLanguages.clear();
    syncLanguageButtons();
    renderAll();
  });
  el.downloadButton.addEventListener("click", downloadFilteredCsv);

  document.querySelectorAll(".view-tab").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeView = button.dataset.view;
      document.querySelectorAll(".view-tab").forEach((item) => {
        const selected = item === button;
        item.classList.toggle("active", selected);
        item.setAttribute("aria-selected", String(selected));
      });
      document.querySelectorAll(".view-panel").forEach((panel) => panel.classList.remove("active"));
      document.getElementById(`view-${state.activeView}`).classList.add("active");
      if (state.activeView === "dimensions") renderParallel();
      window.setTimeout(() => {
        const target = state.activeView === "dimensions" ? el.parallelPlot : el.mainPlot;
        if (target && window.Plotly) Plotly.Plots.resize(target);
      }, 0);
    });
  });
}

function populateAxisSelectors() {
  Object.entries(AXES).forEach(([key, axis]) => {
    [el.xAxis, el.yAxis, el.zAxis].forEach((select) => {
      const option = document.createElement("option");
      option.value = key;
      option.textContent = axis.label;
      select.appendChild(option);
    });
  });
  el.xAxis.value = DEFAULTS.x;
  el.yAxis.value = DEFAULTS.y;
  el.zAxis.value = DEFAULTS.z;
  el.colorAxis.value = DEFAULTS.color;
}

function prepareDimensions() {
  state.languages = [...new Set(state.points.map((point) => point.language).filter(Boolean))].sort();
  state.selectedLanguages = new Set(state.languages);
  state.languages.forEach((language, index) => state.languageColors.set(language, COLORS[index % COLORS.length]));
}

function populateFilters() {
  const statusCounts = countBy(state.points, "bpbStatus");
  STATUS_ORDER.filter((status) => statusCounts.has(status)).forEach((status) => {
    const label = document.createElement("label");
    label.className = "check-item";
    label.innerHTML = `<input type="checkbox" value="${escapeHtml(status)}"><span>${escapeHtml(status)}</span><span class="count">${formatInteger(statusCounts.get(status))}</span>`;
    const input = label.querySelector("input");
    input.checked = state.selectedStatuses.has(status);
    input.addEventListener("change", () => {
      input.checked ? state.selectedStatuses.add(status) : state.selectedStatuses.delete(status);
      renderAll();
    });
    el.statusOptions.appendChild(label);
  });

  const experiments = [...new Set(state.points.map((point) => `${point.family} · ${point.experiment}`))].sort();
  experiments.forEach((experiment) => el.experimentFilter.appendChild(new Option(experiment, experiment.split(" · ")[0])));

  const states = [...new Set(state.points.map((point) => point.state).filter(Boolean))].sort();
  states.forEach((runState) => el.stateFilter.appendChild(new Option(runState, runState)));

  const languageCounts = countBy(state.points, "language");
  state.languages.forEach((language) => {
    const button = document.createElement("button");
    button.className = "language-chip active";
    button.dataset.language = language;
    button.title = `${formatInteger(languageCounts.get(language))} observations`;
    button.innerHTML = `<span class="swatch" style="background:${state.languageColors.get(language)}"></span><span>${escapeHtml(language)}</span>`;
    button.addEventListener("click", () => {
      state.selectedLanguages.has(language) ? state.selectedLanguages.delete(language) : state.selectedLanguages.add(language);
      syncLanguageButtons();
      renderAll();
    });
    el.languageOptions.appendChild(button);
  });
}

function renderAll() {
  state.filtered = applyFilters(state.points);
  updateMetrics();
  renderExplorer();
  renderCoverage();
  if (state.activeView === "dimensions") renderParallel();
}

function applyFilters(points) {
  const family = el.experimentFilter.value;
  const runState = el.stateFilter.value;
  return points.filter((point) =>
    state.selectedStatuses.has(point.bpbStatus)
    && state.selectedLanguages.has(point.language)
    && (family === "all" || point.family === family)
    && (runState === "all" || point.state === runState)
  );
}

function renderExplorer() {
  if (!state.payload || !window.Plotly) return;
  const xKey = el.xAxis.value;
  const yKey = el.yAxis.value;
  const zKey = el.zAxis.value;
  const colorKey = el.colorAxis.value;
  const required = state.dimensions === 3 ? [xKey, yKey, zKey] : [xKey, yKey];
  const visible = state.filtered.filter((point) =>
    required.every((key) => isPlottable(point[key], AXES[key].scale))
    && (colorKey !== "causalBpb" || Number.isFinite(point.causalBpb))
  );

  el.plotTitle.textContent = state.dimensions === 3
    ? `${AXES[xKey].short} × ${AXES[yKey].short} × ${AXES[zKey].short}`
    : `${AXES[xKey].short} × ${AXES[yKey].short}`;
  el.plotCaption.textContent = `${formatInteger(visible.length)} points with complete values · click any point for provenance`;

  if (!visible.length) {
    Plotly.purge(el.mainPlot);
    el.mainPlot.hidden = true;
    el.emptyState.hidden = false;
    return;
  }
  el.mainPlot.hidden = false;
  el.emptyState.hidden = true;

  const groups = buildColorGroups(visible, colorKey);
  const traces = groups.map(({ name, color, points, continuous }) => {
    const trace = {
      type: state.dimensions === 3 ? "scatter3d" : "scattergl",
      mode: "markers",
      name,
      x: points.map((point) => point[xKey]),
      y: points.map((point) => point[yKey]),
      customdata: points.map((point) => point.id),
      text: points.map(hoverText),
      hovertemplate: "%{text}<extra></extra>",
      marker: {
        size: state.dimensions === 3 ? 4 : 7,
        opacity: state.dimensions === 3 ? 0.74 : 0.68,
        color: continuous ? points.map((point) => point[colorKey]) : color,
        line: state.dimensions === 3 ? { width: 0 } : { width: 0.4, color: "rgba(255,255,255,0.18)" },
      },
    };
    if (continuous) {
      trace.marker.colorscale = "Viridis";
      trace.marker.colorbar = { title: "Causal<br>BPB", thickness: 12, len: 0.56, x: 1.02, tickfont: { color: "#8295aa" }, titlefont: { color: "#8295aa" } };
      trace.marker.showscale = true;
      trace.showlegend = false;
    }
    if (state.dimensions === 3) trace.z = points.map((point) => point[zKey]);
    return trace;
  });

  const axisLayout = (key) => ({
    title: { text: AXES[key].label, font: { color: "#9db1c5", size: 12 } },
    type: AXES[key].scale,
    gridcolor: "rgba(151,178,202,0.12)",
    zerolinecolor: "rgba(151,178,202,0.18)",
    tickfont: { color: "#71869a", size: 10 },
    exponentformat: "SI",
    showspikes: false,
  });

  const layout = {
    autosize: true,
    margin: state.dimensions === 3 ? { l: 0, r: 0, t: 18, b: 0 } : { l: 74, r: colorKey === "causalBpb" ? 76 : 24, t: 24, b: 62 },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { family: "Inter, ui-sans-serif, sans-serif", color: "#9db1c5" },
    hoverlabel: { bgcolor: "#102236", bordercolor: "rgba(110,231,208,0.28)", font: { color: "#dce9f6", size: 12 } },
    legend: { orientation: "h", yanchor: "bottom", y: 1.01, xanchor: "left", x: 0, font: { size: 10, color: "#8295aa" }, bgcolor: "rgba(0,0,0,0)" },
    showlegend: colorKey !== "causalBpb",
  };

  if (state.dimensions === 3) {
    layout.scene = {
      xaxis: axisLayout(xKey), yaxis: axisLayout(yKey), zaxis: axisLayout(zKey),
      bgcolor: "rgba(0,0,0,0)",
      camera: { eye: { x: 1.45, y: 1.45, z: 1.1 } },
    };
  } else {
    layout.xaxis = axisLayout(xKey);
    layout.yaxis = axisLayout(yKey);
  }

  Plotly.react(el.mainPlot, traces, layout, { responsive: true, displaylogo: false, scrollZoom: true, modeBarButtonsToRemove: ["lasso2d", "select2d"] });
  el.mainPlot.removeAllListeners?.("plotly_click");
  el.mainPlot.on("plotly_click", (event) => {
    const id = event.points?.[0]?.customdata;
    const point = state.points.find((candidate) => candidate.id === id);
    if (point) renderPointDetail(point);
  });
}

function buildColorGroups(points, key) {
  if (key === "causalBpb") {
    return [{ name: "Causal BPB", color: null, continuous: true, points: points.filter((point) => Number.isFinite(point.causalBpb)) }];
  }
  const buckets = new Map();
  points.forEach((point) => {
    const group = point[key] || "Unknown";
    if (!buckets.has(group)) buckets.set(group, []);
    buckets.get(group).push(point);
  });
  return [...buckets.entries()].sort(([a], [b]) => String(a).localeCompare(String(b))).map(([name, bucket], index) => ({
    name,
    points: bucket,
    continuous: false,
    color: key === "language" ? state.languageColors.get(name) : COLORS[index % COLORS.length],
  }));
}

function renderPointDetail(point) {
  el.pointDetail.innerHTML = `
    <div class="point-detail-grid">
      <div><strong>${escapeHtml(point.language || "—")}</strong><small>Language</small></div>
      <div><strong>${formatDecimal(point.alpha)} / ${formatDecimal(point.repetition)}</strong><small>Alpha / R</small></div>
      <div><strong>${formatCompact(point.modelParams)}</strong><small>Model parameters</small></div>
      <div><strong>${formatDecimal(point.causalBpb)}</strong><small>Causal BPB</small></div>
      <div><strong>${escapeHtml(point.bpbStatus || "—")}</strong><small>Evidence status</small></div>
      <div><strong>${escapeHtml(point.family || "—")}</strong><small>${escapeHtml(point.group || "No group")}</small></div>
      <div><strong>${escapeHtml(point.runId || "—")}</strong><small>${escapeHtml(point.date || "No date")}</small></div>
      <a class="wandb-link" href="${escapeAttribute(point.wandb)}" target="_blank" rel="noreferrer">Open run in W&amp;B ↗</a>
    </div>`;
}

function renderParallel() {
  if (!state.payload || !window.Plotly || state.activeView !== "dimensions") return;
  const candidates = state.filtered.filter((point) => Number.isFinite(point.causalBpb));
  const sample = stratifiedSample(candidates, 1400);
  const dimensions = [
    parallelDimension(sample, "modelParams", "log params", true),
    parallelDimension(sample, "uniqueBytes", "log unique B", true),
    parallelDimension(sample, "compression", "bytes/token"),
    parallelDimension(sample, "tokenShare", "token share"),
    parallelDimension(sample, "alpha", "alpha"),
    parallelDimension(sample, "repetition", "log R", true),
    parallelDimension(sample, "arPasses", "log(1+AR)", true, true),
    parallelDimension(sample, "mdPasses", "log(1+MD)", true, true),
    parallelDimension(sample, "tokensSeen", "log tokens", true),
    parallelDimension(sample, "causalBpb", "causal BPB"),
  ].filter(Boolean);

  const colorKey = el.parallelColor.value;
  let colorValues;
  let colorTitle;
  let colorscale = "Viridis";
  if (colorKey === "language") {
    const index = new Map(state.languages.map((language, i) => [language, i]));
    colorValues = sample.map((point) => index.get(point.language));
    colorTitle = "Language<br>index";
    colorscale = state.languages.map((_, i) => [i / Math.max(1, state.languages.length - 1), state.languageColors.get(state.languages[i])]);
  } else {
    colorValues = sample.map((point) => point[colorKey]);
    colorTitle = colorKey === "causalBpb" ? "Causal BPB" : "Alpha";
  }

  const trace = {
    type: "parcoords",
    dimensions,
    line: {
      color: colorValues,
      colorscale,
      showscale: true,
      colorbar: { title: colorTitle, thickness: 12, len: 0.55, tickfont: { color: "#8295aa" }, titlefont: { color: "#8295aa" } },
    },
    labelfont: { color: "#a8bbcd", size: 11 },
    tickfont: { color: "#70869b", size: 9 },
    rangefont: { color: "#70869b", size: 9 },
  };

  const layout = {
    autosize: true,
    margin: { l: 54, r: 72, t: 42, b: 42 },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { family: "Inter, ui-sans-serif, sans-serif", color: "#9db1c5" },
  };
  Plotly.react(el.parallelPlot, [trace], layout, { responsive: true, displaylogo: false });
}

function parallelDimension(points, key, label, log = false, logOnePlus = false) {
  let values = points.map((point) => point[key]);
  if (log) values = values.map((value) => {
    if (!Number.isFinite(value)) return null;
    if (logOnePlus) return Math.log10(1 + Math.max(0, value));
    return value > 0 ? Math.log10(value) : null;
  });
  if (!values.some(Number.isFinite)) return null;
  return { label, values };
}

function renderCoverage() {
  if (!state.payload) return;
  const dimensions = Object.entries(AXES);
  el.coverageGrid.innerHTML = dimensions.map(([key, axis]) => {
    const values = state.filtered.map((point) => point[key]).filter(Number.isFinite);
    const percentage = state.filtered.length ? (100 * values.length / state.filtered.length) : 0;
    const range = values.length ? `${axis.format(Math.min(...values))} – ${axis.format(Math.max(...values))}` : "No values";
    return `<article class="coverage-card">
      <strong>${escapeHtml(axis.short)}</strong>
      <div class="coverage-bar"><span style="width:${percentage.toFixed(1)}%"></span></div>
      <small><span>${percentage.toFixed(0)}% filled</span><span>${escapeHtml(range)}</span></small>
    </article>`;
  }).join("");
}

function updateMetrics() {
  el.metricPoints.textContent = formatInteger(state.filtered.length);
  el.metricRuns.textContent = formatInteger(new Set(state.filtered.map((point) => point.runId)).size);
  el.metricLanguages.textContent = formatInteger(new Set(state.filtered.map((point) => point.language)).size);
  el.metricExperiments.textContent = formatInteger(new Set(state.filtered.map((point) => point.family)).size);
}

function resetControls() {
  state.dimensions = DEFAULTS.dimensions;
  state.selectedStatuses = new Set(DEFAULT_STATUSES);
  state.selectedLanguages = new Set(state.languages);
  el.xAxis.value = DEFAULTS.x;
  el.yAxis.value = DEFAULTS.y;
  el.zAxis.value = DEFAULTS.z;
  el.colorAxis.value = DEFAULTS.color;
  el.experimentFilter.value = "all";
  el.stateFilter.value = "all";
  el.languageSearch.value = "";
  el.zField.hidden = true;
  document.querySelectorAll("[data-dimensions]").forEach((button) => button.classList.toggle("active", button.dataset.dimensions === "2"));
  syncStatusInputs();
  syncLanguageButtons();
  filterLanguageButtons();
  renderAll();
}

function syncStatusInputs() {
  el.statusOptions.querySelectorAll("input").forEach((input) => { input.checked = state.selectedStatuses.has(input.value); });
}

function syncLanguageButtons() {
  el.languageOptions.querySelectorAll(".language-chip").forEach((button) => button.classList.toggle("active", state.selectedLanguages.has(button.dataset.language)));
}

function filterLanguageButtons() {
  const query = el.languageSearch.value.trim().toLowerCase();
  el.languageOptions.querySelectorAll(".language-chip").forEach((button) => { button.hidden = !button.dataset.language.toLowerCase().includes(query); });
}

function downloadFilteredCsv() {
  const fields = ["family", "experiment", "group", "runId", "language", ...Object.keys(AXES), "state", "bpbStatus", "wandb"];
  const lines = [fields.join(","), ...state.filtered.map((point) => fields.map((field) => csvCell(point[field])).join(","))];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "dual-objective-filtered-language-points.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}

function hoverText(point) {
  return `<b>${escapeHtml(point.language)}</b> · ${escapeHtml(point.family)}<br>`
    + `Alpha ${formatDecimal(point.alpha)} · R ${formatDecimal(point.repetition)}<br>`
    + `Causal BPB ${formatDecimal(point.causalBpb)}<br>`
    + `${escapeHtml(point.bpbStatus)}<br>${escapeHtml(point.group || "")}`;
}

function stratifiedSample(points, limit) {
  if (points.length <= limit) return points;
  const groups = new Map();
  points.forEach((point) => {
    if (!groups.has(point.language)) groups.set(point.language, []);
    groups.get(point.language).push(point);
  });
  const result = [];
  const quota = Math.max(1, Math.floor(limit / groups.size));
  groups.forEach((items) => {
    const step = Math.max(1, items.length / quota);
    for (let index = 0; index < items.length && result.length < limit; index += step) result.push(items[Math.floor(index)]);
  });
  if (result.length < limit) {
    const used = new Set(result.map((point) => point.id));
    for (const point of points) {
      if (!used.has(point.id)) result.push(point);
      if (result.length >= limit) break;
    }
  }
  return result.slice(0, limit);
}

function countBy(points, key) {
  const counts = new Map();
  points.forEach((point) => counts.set(point[key], (counts.get(point[key]) || 0) + 1));
  return counts;
}

function isPlottable(value, scale) { return Number.isFinite(value) && (scale !== "log" || value > 0); }
function toCamel(value) { return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()); }
function formatInteger(value) { return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value ?? 0); }
function formatCompact(value) { return Number.isFinite(value) ? new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(value) : "—"; }
function formatDecimal(value) { return Number.isFinite(value) ? new Intl.NumberFormat("en-US", { maximumSignificantDigits: 4 }).format(value) : "—"; }
function formatPercent(value) { return Number.isFinite(value) ? `${(value * 100).toFixed(value < 0.01 ? 2 : 1)}%` : "—"; }
function csvCell(value) { const text = value == null ? "" : String(value); return `"${text.replaceAll('"', '""')}"`; }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]); }
function escapeAttribute(value) { return escapeHtml(value || "#"); }

