const STATS_API_URL = "https://biscicol.org/phenobase/api/v1/query//phenobase2/_search?size=0&from=0";
const STATS_HIDDEN_TRAIT = "plant structure present";
const STATS_MIN_DOY = 1;
const STATS_MAX_DOY = 366;
const STATS_MAX_TRAIT_BUCKETS = 24;
const STATS_TRAIT_HIERARCHY_URL = "https://raw.githubusercontent.com/Phenobase/phenobase_data/version2/data/traits.csv";
const statsCharts = [];
let phenologyBoxPlotPluginRegistered = false;
let statsDecadeHistogramPluginRegistered = false;
let statsTraitHierarchyPromise = null;
const statsLoadState = {
  requestId: 0,
  signature: "",
  stale: true,
  loading: false,
  completed: false,
  activeRequest: null,
  statusMessage: "",
  statusTone: "info",
};
const GLOBAL_STATS_SNAPSHOT_URL = String(window.phenobaseGlobalStatsSnapshotUrl || "global-stats-snapshot.json");
const DATA_RELEASE_HISTORY_URL = String(window.phenobaseDataReleaseHistoryUrl || "data-release-history.json");
const STATS_SIMPLE_PHASES = [
  { key: "unfolded true leaf", label: "Unfolded true leaf" },
  { key: "breaking vegetative bud", label: "Breaking vegetative bud" },
  { key: "senescing true leaf", label: "Senescing true leaf" },
  { key: "flower", label: "Flower" },
  { key: "open flower", label: "Open flower" },
  { key: "simple fruit or compound fruit", label: "Simple or compound fruit" },
  { key: "ripe fruit", label: "Ripe fruit" },
];
let dataReleaseHistoryPromise = null;
let globalStatsSnapshotPromise = null;

function currentStatsQuery() {
  return window.requestData?.query || { match_all: {} };
}

function isUnfilteredStatsQuery(query) {
  if (!query || typeof query !== "object") return false;
  if (query.match_all) return true;
  const must = query?.bool?.must;
  return Array.isArray(must) && must.length === 0;
}

function formatStatsSnapshotTimestamp(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
}

function formatReleaseDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function getDataReleaseHistoryContainer() {
  return document.getElementById("dataReleaseHistorySection");
}

function shouldUseGlobalSummaryStats() {
  return isUnfilteredStatsQuery(currentStatsQuery());
}

function summaryAggNameForPhase(phaseKey, suffix) {
  return `${String(phaseKey || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_")}_${suffix}`;
}

function clearDataReleaseHistorySection() {
  const container = getDataReleaseHistoryContainer();
  if (!container) return;
  container.innerHTML = "";
}

function snapshotHasCommonAggregations(snapshot) {
  return !!(
    snapshot?.aggregations?.datasource_0
    && snapshot?.aggregations?.decadeDistribution_1
    && snapshot?.aggregations?.family_2
    && snapshot?.aggregations?.genus_3
  );
}

function isUsableGlobalStatsSnapshot(snapshot) {
  if (snapshot?.ready !== true) return false;
  if (!snapshotHasCommonAggregations(snapshot)) return false;
  if (snapshot?.summaryOnly) {
    return !!snapshot?.aggregations?.phenophasePresenceSummary_4;
  }
  return !!snapshot?.aggregations?.mappedTraitsByDecade_4;
}

function releaseHistoryEntriesSorted(payload) {
  const entries = Array.isArray(payload?.entries) ? payload.entries.slice() : [];
  return entries.sort((a, b) => {
    const aTime = new Date(a?.publishedAt || 0).getTime();
    const bTime = new Date(b?.publishedAt || 0).getTime();
    return bTime - aTime;
  });
}

async function getDataReleaseHistory() {
  if (dataReleaseHistoryPromise) return dataReleaseHistoryPromise;

  dataReleaseHistoryPromise = $.getJSON(DATA_RELEASE_HISTORY_URL)
    .then((payload) => payload)
    .catch((error) => {
      console.warn("Failed to load data release history:", error);
      dataReleaseHistoryPromise = null;
      return null;
    });

  return dataReleaseHistoryPromise;
}

async function getGlobalStatsSnapshot() {
  if (window.phenobaseGlobalStatsSnapshot?.aggregations) {
    return window.phenobaseGlobalStatsSnapshot;
  }

  if (globalStatsSnapshotPromise) return globalStatsSnapshotPromise;

  globalStatsSnapshotPromise = $.getJSON(GLOBAL_STATS_SNAPSHOT_URL)
    .then((payload) => payload)
    .catch((error) => {
      console.warn("Failed to load global stats snapshot:", error);
      globalStatsSnapshotPromise = null;
      return null;
    });

  return globalStatsSnapshotPromise;
}

function appendReleaseHistoryList(title, items, container) {
  const cleanedItems = Array.isArray(items)
    ? items.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  if (!cleanedItems.length || !container) return;

  const subtitle = document.createElement("div");
  subtitle.className = "release-history-subtitle";
  subtitle.textContent = title;
  container.appendChild(subtitle);

  const list = document.createElement("ul");
  list.className = "release-history-points";
  cleanedItems.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    list.appendChild(li);
  });
  container.appendChild(list);
}

function renderDataReleaseHistory(payload) {
  const container = getDataReleaseHistoryContainer();
  if (!container) return;

  const entries = releaseHistoryEntriesSorted(payload);
  if (!entries.length) {
    clearDataReleaseHistorySection();
    return;
  }

  container.innerHTML = "";

  const wrap = document.createElement("section");
  wrap.className = "release-history-wrap";

  const title = document.createElement("h3");
  title.className = "stats-section-title";
  title.textContent = "Data Release History";
  wrap.appendChild(title);

  const intro = document.createElement("p");
  intro.className = "stats-note";
  intro.textContent = "Most recent data loads are shown first. Edit app/data-release-history.json to add new release notes and publication methodology entries.";
  wrap.appendChild(intro);

  const list = document.createElement("div");
  list.className = "release-history-list";

  entries.forEach((entry) => {
    const card = document.createElement("article");
    card.className = "release-history-card";

    const header = document.createElement("div");
    header.className = "release-history-header";

    const version = document.createElement("h4");
    version.className = "release-history-version";
    version.textContent = entry?.title
      ? `${entry.title} (${entry.datasetVersion || "Unversioned"})`
      : String(entry?.datasetVersion || "Unversioned release");
    header.appendChild(version);

    const date = document.createElement("div");
    date.className = "release-history-date";
    date.textContent = formatReleaseDate(entry?.publishedAt);
    header.appendChild(date);
    card.appendChild(header);

    const summary = document.createElement("p");
    summary.className = "release-history-summary";
    summary.textContent = String(entry?.summary || "");
    card.appendChild(summary);

    if (entry?.recordCount) {
      const meta = document.createElement("p");
      meta.className = "release-history-meta";
      meta.textContent = `Record count: ${Number(entry.recordCount).toLocaleString()}`;
      card.appendChild(meta);
    }

    appendReleaseHistoryList("Methodology", entry?.methodology, card);
    appendReleaseHistoryList("Changes", entry?.changes, card);
    appendReleaseHistoryList("Notes", entry?.notes, card);

    list.appendChild(card);
  });

  wrap.appendChild(list);
  container.appendChild(wrap);
}

async function refreshDataReleaseHistorySection() {
  if (!isUnfilteredStatsQuery(currentStatsQuery())) {
    clearDataReleaseHistorySection();
    return;
  }

  const payload = await getDataReleaseHistory();
  if (!payload) {
    clearDataReleaseHistorySection();
    return;
  }

  renderDataReleaseHistory(payload);
}

function getStatsStatusEl() {
  return document.getElementById("statsStatus");
}

function setStatsStatus(message, tone) {
  statsLoadState.statusMessage = message || "";
  statsLoadState.statusTone = tone || "info";

  const el = getStatsStatusEl();
  const text = document.getElementById("statsStatusText");
  if (!el) return;

  if (window.currentMainTab !== "stats") {
    if (text) text.textContent = "";
    el.style.display = "none";
    el.classList.remove("is-error", "is-success");
    return;
  }

  if (!message) {
    if (text) text.textContent = "";
    el.style.display = "none";
    el.classList.remove("is-error", "is-success");
    return;
  }

  if (text) text.textContent = message;
  el.style.display = "block";
  el.classList.toggle("is-error", tone === "error");
  el.classList.toggle("is-success", tone === "success");
}

function syncStatsStatusVisibility() {
  setStatsStatus(statsLoadState.statusMessage, statsLoadState.statusTone);
}

function getStatsQuerySignature() {
  try {
    return JSON.stringify(window.requestData?.query || { match_all: {} });
  } catch (_error) {
    return String(Date.now());
  }
}

function statsNormalizeLower(value) {
  return String(value || "").trim().toLowerCase();
}

function statsToArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === "") return [];
  return [value];
}

async function getStatsTraitHierarchy() {
  if (statsTraitHierarchyPromise) return statsTraitHierarchyPromise;
  if (!window.PhenoTraits || typeof window.PhenoTraits.loadHierarchy !== "function") {
    return null;
  }

  statsTraitHierarchyPromise = window.PhenoTraits.loadHierarchy(STATS_TRAIT_HIERARCHY_URL)
    .catch((error) => {
      console.warn("Failed to load stats trait hierarchy:", error);
      statsTraitHierarchyPromise = null;
      return null;
    });

  return statsTraitHierarchyPromise;
}

function expandStatsTraitTermsWithAncestors(terms, hierarchy) {
  const cleanedTerms = statsToArray(terms)
    .map((term) => String(term || "").trim())
    .filter(Boolean)
    .filter((term) => statsNormalizeLower(term) !== STATS_HIDDEN_TRAIT);
  if (!cleanedTerms.length) return cleanedTerms;
  if (!hierarchy || !window.PhenoTraits || typeof window.PhenoTraits.findNodeByLabel !== "function") {
    return cleanedTerms;
  }

  const expanded = [];
  const expandedSet = new Set();

  function addTerm(label) {
    const cleaned = String(label || "").trim();
    if (!cleaned) return;
    if (statsNormalizeLower(cleaned) === STATS_HIDDEN_TRAIT) return;
    const key = cleaned.toLowerCase();
    if (expandedSet.has(key)) return;
    expandedSet.add(key);
    expanded.push(cleaned);
  }

  cleanedTerms.forEach((term) => {
    addTerm(term);
    const node = window.PhenoTraits.findNodeByLabel(hierarchy.nodesByLabel, term);
    if (!node) return;

    const stack = Array.from(node.parents || []);
    const seen = new Set();
    while (stack.length) {
      const parent = stack.pop();
      if (!parent || seen.has(parent)) continue;
      seen.add(parent);
      addTerm(parent.label);
      Array.from(parent.parents || []).forEach((nextParent) => stack.push(nextParent));
    }
  });

  return expanded;
}

function statsGetSelectedPhenophaseTraitTerms() {
  const filters = window.portalFilters || {};
  const selected = statsToArray(filters.selectedPhenophases).filter(Boolean);
  if (!selected.length) return [];

  const mode = String(filters.presenceMode || "both").toLowerCase();
  const terms = new Set();

  selected.forEach((phaseBase) => {
    const base = String(phaseBase || "").trim();
    if (!base) return;
    if (mode !== "absent") terms.add(`${base} present`);
    if (mode !== "present") terms.add(`${base} absent`);
  });

  return Array.from(terms);
}

async function getStatsTraitAggregationConfig() {
  const selectedFacets = window.selectedFacets || {};
  const explicitTraitTerms = statsToArray(selectedFacets.mappedTraits)
    .filter(Boolean)
    .filter((term) => statsNormalizeLower(term) !== STATS_HIDDEN_TRAIT);

  if (explicitTraitTerms.length) {
    const hierarchy = await getStatsTraitHierarchy();
    const expandedTerms = expandStatsTraitTermsWithAncestors(explicitTraitTerms, hierarchy);
    const expandedCount = Math.max(0, expandedTerms.length - explicitTraitTerms.length);
    return {
      terms: {
        field: "mappedTraits",
        size: expandedTerms.length,
        include: expandedTerms,
      },
      note: expandedCount
        ? `Showing ${explicitTraitTerms.length} selected trait${explicitTraitTerms.length === 1 ? "" : "s"} plus ${expandedCount} broader parent trait${expandedCount === 1 ? "" : "s"}.`
        : `Showing ${explicitTraitTerms.length} selected trait${explicitTraitTerms.length === 1 ? "" : "s"}.`,
    };
  }

  const phenophaseTerms = statsGetSelectedPhenophaseTraitTerms()
    .filter((term) => statsNormalizeLower(term) !== STATS_HIDDEN_TRAIT);

  if (phenophaseTerms.length) {
    const hierarchy = await getStatsTraitHierarchy();
    const expandedTerms = expandStatsTraitTermsWithAncestors(phenophaseTerms, hierarchy);
    const expandedCount = Math.max(0, expandedTerms.length - phenophaseTerms.length);
    return {
      terms: {
        field: "mappedTraits",
        size: expandedTerms.length,
        include: expandedTerms,
      },
      note: expandedCount
        ? `Showing traits for the selected phenophase filter${phenophaseTerms.length === 1 ? "" : "s"}, including ${expandedCount} broader parent trait${expandedCount === 1 ? "" : "s"}.`
        : `Showing traits for the selected phenophase filter${phenophaseTerms.length === 1 ? "" : "s"}.`,
    };
  }

  return {
    terms: {
      field: "mappedTraits",
      size: STATS_MAX_TRAIT_BUCKETS,
    },
    note: `Showing the top ${STATS_MAX_TRAIT_BUCKETS} mapped traits by record count for the current filters.`,
  };
}

function abortActiveStatsRequest() {
  const req = statsLoadState.activeRequest;
  if (req && typeof req.abort === "function") {
    req.abort();
  }
  statsLoadState.activeRequest = null;
  statsLoadState.loading = false;
}

function markStatsNeedsRefresh() {
  const nextSignature = getStatsQuerySignature();
  const signatureChanged = statsLoadState.signature !== nextSignature;

  if (signatureChanged) {
    statsLoadState.signature = nextSignature;
    statsLoadState.stale = true;
    statsLoadState.completed = false;
  }

  if ($("#statsContainer").is(":visible") && statsLoadState.stale) {
    setStatsStatus('Stats are out of date for the current filters. Click "Refresh Stats" to update. If the query is broad, try filtering by phenophase, scientific name, geographic scope, or time period.', "info");
  }
}

function ensurePhenologyBoxPlotPlugin() {
  if (phenologyBoxPlotPluginRegistered || typeof Chart !== "function") return;

  Chart.register({
    id: "phenologyBoxPlotOverlay",
    afterDatasetsDraw(chart, _args, pluginOptions) {
      const options = pluginOptions || {};
      const boxStats = Array.isArray(options.boxStats) ? options.boxStats : [];
      const datasetIndex = Number.isInteger(options.datasetIndex) ? options.datasetIndex : 0;
      const meta = chart.getDatasetMeta(datasetIndex);
      const yScale = chart.scales?.y;
      if (!meta?.data?.length || !yScale) return;

      const ctx = chart.ctx;
      ctx.save();
      ctx.strokeStyle = options.strokeColor || "#0f172a";
      ctx.lineWidth = options.lineWidth || 1.5;

      boxStats.forEach((stats, index) => {
        if (!stats) return;
        const element = meta.data[index];
        if (!element) return;

        const centerX = element.x;
        const boxWidth = Math.max(14, (element.width || 24) - 4);
        const capHalfWidth = Math.max(5, Math.min(10, boxWidth * 0.28));
        const medianHalfWidth = Math.max(8, boxWidth * 0.5);

        const q1Y = yScale.getPixelForValue(stats.q1);
        const q3Y = yScale.getPixelForValue(stats.q3);
        const medianY = yScale.getPixelForValue(stats.median);
        const whiskerLowY = yScale.getPixelForValue(stats.whiskerLow);
        const whiskerHighY = yScale.getPixelForValue(stats.whiskerHigh);

        ctx.beginPath();
        ctx.moveTo(centerX, whiskerHighY);
        ctx.lineTo(centerX, q3Y);
        ctx.moveTo(centerX, q1Y);
        ctx.lineTo(centerX, whiskerLowY);
        ctx.moveTo(centerX - capHalfWidth, whiskerHighY);
        ctx.lineTo(centerX + capHalfWidth, whiskerHighY);
        ctx.moveTo(centerX - capHalfWidth, whiskerLowY);
        ctx.lineTo(centerX + capHalfWidth, whiskerLowY);
        ctx.stroke();

        ctx.save();
        ctx.strokeStyle = options.medianColor || "#1d4ed8";
        ctx.lineWidth = options.medianLineWidth || 2.5;
        ctx.beginPath();
        ctx.moveTo(centerX - medianHalfWidth, medianY);
        ctx.lineTo(centerX + medianHalfWidth, medianY);
        ctx.stroke();
        ctx.restore();
      });

      ctx.restore();
    },
  });

  phenologyBoxPlotPluginRegistered = true;
}

function ensureStatsDecadeHistogramPlugin() {
  if (statsDecadeHistogramPluginRegistered || typeof Chart !== "function") return;

  Chart.register({
    id: "statsDecadeHistogramLabels",
    afterDatasetsDraw(chart, _args, pluginOptions) {
      const options = pluginOptions || {};
      if (!options.enabled) return;

      const datasetIndex = Number.isInteger(options.datasetIndex) ? options.datasetIndex : 0;
      const meta = chart.getDatasetMeta(datasetIndex);
      const dataset = chart.data?.datasets?.[datasetIndex];
      if (!meta?.data?.length || !dataset?.data?.length) return;

      const ctx = chart.ctx;
      const chartArea = chart.chartArea || {};
      const fixedLabelY = Math.max(
        Number(chartArea.top || 0) + 18,
        Number(chartArea.bottom || 0) - (options.verticalOffset || 24)
      );
      ctx.save();
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillStyle = options.color || "#1f2937";
      ctx.font = options.font || "italic 11px sans-serif";

      meta.data.forEach((bar, index) => {
        const value = Number(dataset.data[index]);
        if (!Number.isFinite(value) || value <= 0) return;
        ctx.save();
        ctx.translate(bar.x, fixedLabelY);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(value.toLocaleString(), 0, 0);
        ctx.restore();
      });

      ctx.restore();
    },
  });

  statsDecadeHistogramPluginRegistered = true;
}

function destroyStatsCharts() {
  while (statsCharts.length) {
    const chart = statsCharts.pop();
    if (chart && typeof chart.destroy === "function") chart.destroy();
  }
}

function isStatsHiddenTrait(value) {
  return String(value || "").trim().toLowerCase() === STATS_HIDDEN_TRAIT;
}

function statsFormatDecadeLabel(decadeStart) {
  return `${decadeStart}s`;
}

function getStatsDecadeBounds() {
  const filters = window.portalFilters || {};
  const fallbackMin = Number.isFinite(window.DEFAULT_MIN_DECADE) ? window.DEFAULT_MIN_DECADE : 1800;
  const fallbackMax = Number.isFinite(window.DEFAULT_MAX_DECADE) ? window.DEFAULT_MAX_DECADE : Math.floor(new Date().getFullYear() / 10) * 10;
  const min = Number.isFinite(Number(filters.decadeStart)) ? Math.floor(Number(filters.decadeStart) / 10) * 10 : fallbackMin;
  const max = Number.isFinite(Number(filters.decadeEnd)) ? Math.floor(Number(filters.decadeEnd) / 10) * 10 : fallbackMax;
  return { min: Math.min(min, max), max: Math.max(min, max) };
}

function buildStatsRequestData(traitAggConfig) {
  const query = window.requestData?.query || { match_all: {} };
  const decadeBounds = getStatsDecadeBounds();
  const summaryOnly = shouldUseGlobalSummaryStats();

  const aggs = {
    datasource_0: { terms: { field: "dataSource", size: 10 } },
    decadeDistribution_1: {
      histogram: {
        field: "decadeStart",
        interval: 10,
        min_doc_count: 0,
        extended_bounds: {
          min: decadeBounds.min,
          max: decadeBounds.max,
        },
      },
    },
    family_2: { terms: { field: "family", size: 50 } },
    genus_3: { terms: { field: "genus", size: 50 } },
  };

  if (summaryOnly) {
    aggs.phenophasePresenceSummary_4 = {
      filters: {
        filters: STATS_SIMPLE_PHASES.reduce((filters, phase) => {
          filters[summaryAggNameForPhase(phase.key, "present")] = {
            term: { mappedTraits: `${phase.key} present` },
          };
          filters[summaryAggNameForPhase(phase.key, "absent")] = {
            term: { mappedTraits: `${phase.key} absent` },
          };
          return filters;
        }, {}),
      },
    };
  } else {
    aggs.mappedTraitsByDecade_4 = {
      terms: traitAggConfig.terms,
      aggs: {
        doy_records: {
          filter: { exists: { field: "dayOfYear" } },
          aggs: {
            decades: {
              histogram: {
                field: "decadeStart",
                interval: 10,
                min_doc_count: 0,
                extended_bounds: {
                  min: decadeBounds.min,
                  max: decadeBounds.max,
                },
              },
              aggs: {
                doy_histogram: {
                  histogram: {
                    field: "dayOfYear",
                    interval: 1,
                    min_doc_count: 0,
                    extended_bounds: {
                      min: STATS_MIN_DOY,
                      max: STATS_MAX_DOY,
                    },
                  },
                },
              },
            },
          },
        },
      },
    };
  }

  return {
    size: 0,
    track_total_hits: false,
    query,
    aggs,
  };
}

function renderTable(id, headers, rows, title) {
  const container = document.getElementById(id);
  if (!container) return;

  container.innerHTML = "";

  const titleElement = document.createElement("h3");
  titleElement.textContent = title;
  titleElement.className = "stats-section-title";
  container.appendChild(titleElement);

  const table = document.createElement("table");
  table.classList.add("table", "table-striped");

  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  headers.forEach((header) => {
    const th = document.createElement("th");
    th.textContent = header;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    row.forEach((cell) => {
      const td = document.createElement("td");
      td.textContent = cell;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  container.appendChild(table);
}

function shouldUseLogScaleForDistribution(counts) {
  const positiveCounts = (counts || []).filter((value) => Number.isFinite(value) && value > 0);
  if (positiveCounts.length < 3) return false;

  const max = Math.max(...positiveCounts);
  const min = Math.min(...positiveCounts);
  if (!Number.isFinite(max) || !Number.isFinite(min) || min <= 0) return false;

  return max >= 100 && (max / min) >= 25;
}

function formatStatsCount(value, { compact = false } = {}) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return String(value);
  if (!compact) return numericValue.toLocaleString();

  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: numericValue >= 100 ? 0 : 1,
  }).format(numericValue);
}

function renderTopDistributionChart(containerId, buckets, options = {}) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const {
    title = "Distribution",
    entityLabel = "items",
    emptyText = "No distribution is available for the current filters.",
    barColor = "rgba(71, 85, 105, 0.72)",
    barBorderColor = "rgba(51, 65, 85, 1)",
    limit = 20,
    step = 20,
    baseLimit = 20,
  } = options;

  container.innerHTML = "";

  const titleEl = document.createElement("h3");
  titleEl.textContent = title;
  titleEl.className = "stats-section-title";
  container.appendChild(titleEl);

  const allBuckets = (buckets || [])
    .filter((bucket) => String(bucket?.key || "").trim() !== "")
    .filter((bucket) => (bucket?.doc_count || 0) > 0);

  const topBuckets = allBuckets.slice(0, limit);

  if (!topBuckets.length) {
    const empty = document.createElement("div");
    empty.className = "stats-empty-state";
    empty.textContent = emptyText;
    container.appendChild(empty);
    return;
  }

  if (typeof Chart !== "function") {
    const fallback = document.createElement("div");
    fallback.className = "stats-empty-state";
    fallback.textContent = "Chart.js is not available, so this distribution chart could not be rendered.";
    container.appendChild(fallback);
    return;
  }

  const labels = topBuckets.map((bucket) => String(bucket.key));
  const counts = topBuckets.map((bucket) => Number(bucket.doc_count) || 0);
  const useLogScale = shouldUseLogScaleForDistribution(counts);
  const useCompactCountLabels = useLogScale;

  const wrap = document.createElement("section");
  wrap.className = "stats-chart-card";

  const note = document.createElement("p");
  note.className = "stats-note";
  note.textContent = useLogScale
    ? `Showing ${topBuckets.length} of ${allBuckets.length} ${entityLabel} by record count for the current filters. Log scale is used because counts differ substantially across the visible bars.`
    : `Showing ${topBuckets.length} of ${allBuckets.length} ${entityLabel} by record count for the current filters.`;
  wrap.appendChild(note);

  const chartWrap = document.createElement("div");
  chartWrap.className = "stats-chart-wrap stats-chart-wrap-tall";
  chartWrap.style.height = `${Math.max(360, topBuckets.length * 24 + 80)}px`;
  const canvas = document.createElement("canvas");
  chartWrap.appendChild(canvas);
  wrap.appendChild(chartWrap);
  container.appendChild(wrap);

  const chart = new Chart(canvas.getContext("2d"), {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Records",
          data: counts,
          backgroundColor: barColor,
          borderColor: barBorderColor,
          borderWidth: 1,
          borderRadius: 4,
        },
      ],
    },
    options: {
      animation: false,
      maintainAspectRatio: false,
      responsive: true,
      indexAxis: "y",
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label(context) {
              const value = Number(context.parsed?.x || 0);
              return `${value.toLocaleString()} records`;
            },
          },
        },
      },
      scales: {
        x: {
          type: useLogScale ? "logarithmic" : "linear",
          beginAtZero: !useLogScale,
          grid: {
            color: "rgba(148, 163, 184, 0.2)",
          },
          ticks: {
            callback(value) {
              const numericValue = Number(value);
              if (!Number.isFinite(numericValue)) return value;
              if (useLogScale) {
                if (numericValue >= 1000) return formatStatsCount(numericValue, { compact: useCompactCountLabels });
                if (numericValue === 1 || numericValue === 2 || numericValue === 5 || numericValue % 10 === 0) {
                  return formatStatsCount(numericValue, { compact: useCompactCountLabels });
                }
                return "";
              }
              return formatStatsCount(numericValue, { compact: useCompactCountLabels });
            },
          },
          title: {
            display: true,
            text: useLogScale ? "Record count (log scale)" : "Record count",
          },
        },
        y: {
          grid: { display: false },
          ticks: {
            autoSkip: false,
            font: { size: 11 },
          },
        },
      },
    },
  });

  statsCharts.push(chart);

  if (allBuckets.length > limit) {
    const moreWrap = document.createElement("div");
    moreWrap.className = "stats-chart-actions";

    const moreButton = document.createElement("button");
    moreButton.type = "button";
    moreButton.className = "btn btn-default btn-sm";
    moreButton.textContent = `Show more ${entityLabel}`;
    moreButton.addEventListener("click", () => {
      renderTopDistributionChart(containerId, buckets, {
        ...options,
        limit: limit + step,
      });
    });

    moreWrap.appendChild(moreButton);

    if (limit > baseLimit) {
      const lessButton = document.createElement("button");
      lessButton.type = "button";
      lessButton.className = "btn btn-default btn-sm";
      lessButton.textContent = `Show less ${entityLabel}`;
      lessButton.addEventListener("click", () => {
        renderTopDistributionChart(containerId, buckets, {
          ...options,
          limit: Math.max(baseLimit, limit - step),
        });
      });
      moreWrap.appendChild(lessButton);
    }

    wrap.appendChild(moreWrap);
  } else if (limit > baseLimit) {
    const actionWrap = document.createElement("div");
    actionWrap.className = "stats-chart-actions";

    const lessButton = document.createElement("button");
    lessButton.type = "button";
    lessButton.className = "btn btn-default btn-sm";
    lessButton.textContent = `Show less ${entityLabel}`;
    lessButton.addEventListener("click", () => {
      renderTopDistributionChart(containerId, buckets, {
        ...options,
        limit: Math.max(baseLimit, limit - step),
      });
    });

    actionWrap.appendChild(lessButton);
    wrap.appendChild(actionWrap);
  }
}

function renderDecadeDistributionChart(aggregations) {
  const container = document.getElementById("decadeTable");
  if (!container) return;

  container.innerHTML = "";

  const title = document.createElement("h3");
  title.textContent = "Decade Distribution";
  title.className = "stats-section-title";
  container.appendChild(title);

  const buckets = (aggregations?.decadeDistribution_1?.buckets || [])
    .filter((bucket) => (bucket?.doc_count || 0) > 0);

  if (!buckets.length) {
    const empty = document.createElement("div");
    empty.className = "stats-empty-state";
    empty.textContent = "No decade distribution is available for the current filters.";
    container.appendChild(empty);
    return;
  }

  ensureStatsDecadeHistogramPlugin();

  const wrap = document.createElement("section");
  wrap.className = "stats-chart-card";

  const note = document.createElement("p");
  note.className = "stats-note";
  note.textContent = "Overall record counts by decade for the current filters.";
  wrap.appendChild(note);

  const chartWrap = document.createElement("div");
  chartWrap.className = "stats-chart-wrap";
  const canvas = document.createElement("canvas");
  chartWrap.appendChild(canvas);
  wrap.appendChild(chartWrap);
  container.appendChild(wrap);

  const labels = buckets.map((bucket) => `${Math.floor(Number(bucket.key) / 10) * 10}s`);
  const counts = buckets.map((bucket) => Number(bucket.doc_count) || 0);

  const chart = new Chart(canvas.getContext("2d"), {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Records",
          data: counts,
          backgroundColor: "rgba(47, 93, 58, 0.72)",
          borderColor: "rgba(47, 93, 58, 1)",
          borderWidth: 1,
          borderRadius: 4,
        },
      ],
    },
    options: {
      animation: false,
      maintainAspectRatio: false,
      responsive: true,
      plugins: {
        statsDecadeHistogramLabels: {
          enabled: true,
          datasetIndex: 0,
          color: "#1f2937",
          font: "11px sans-serif",
        },
        legend: { display: false },
        tooltip: {
          callbacks: {
            label(context) {
              const value = Number(context.parsed?.y || 0);
              return `${value.toLocaleString()} records`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            autoSkip: true,
            maxRotation: 0,
            minRotation: 0,
            font: { size: 10 },
          },
        },
        y: {
          beginAtZero: true,
          ticks: {
            callback(value) {
              return Number(value).toLocaleString();
            },
          },
          title: {
            display: true,
            text: "Record count",
          },
        },
      },
    },
  });

  statsCharts.push(chart);
}

function doyHistogramEntries(buckets) {
  return (buckets || [])
    .map((bucket) => ({
      value: Number(bucket?.key),
      count: Number(bucket?.doc_count) || 0,
    }))
    .filter((entry) => Number.isFinite(entry.value) && entry.count > 0)
    .sort((a, b) => a.value - b.value);
}

function totalHistogramCount(entries) {
  return entries.reduce((sum, entry) => sum + entry.count, 0);
}

function histogramValueAtRank(entries, rank) {
  let seen = 0;
  for (const entry of entries) {
    seen += entry.count;
    if (rank < seen) return entry.value;
  }
  return entries.length ? entries[entries.length - 1].value : null;
}

function histogramQuantile(entries, percentile) {
  const total = totalHistogramCount(entries);
  if (!total) return null;
  if (total === 1) return entries[0].value;

  const index = (total - 1) * percentile;
  const lowerRank = Math.floor(index);
  const upperRank = Math.ceil(index);
  const lowerValue = histogramValueAtRank(entries, lowerRank);
  const upperValue = histogramValueAtRank(entries, upperRank);
  if (lowerValue == null || upperValue == null) return null;
  if (lowerRank === upperRank) return lowerValue;

  const weight = index - lowerRank;
  return lowerValue + (upperValue - lowerValue) * weight;
}

function firstHistogramValueAtOrAbove(entries, threshold) {
  for (const entry of entries) {
    if (entry.value >= threshold) return entry.value;
  }
  return entries.length ? entries[0].value : null;
}

function lastHistogramValueAtOrBelow(entries, threshold) {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (entries[index].value <= threshold) return entries[index].value;
  }
  return entries.length ? entries[entries.length - 1].value : null;
}

function computeTukeyBoxStatsFromHistogram(buckets) {
  const entries = doyHistogramEntries(buckets);
  const count = totalHistogramCount(entries);
  if (!count) return null;

  const q1 = histogramQuantile(entries, 0.25);
  const median = histogramQuantile(entries, 0.5);
  const q3 = histogramQuantile(entries, 0.75);
  if (q1 == null || median == null || q3 == null) return null;

  const iqr = q3 - q1;
  const lowerFence = q1 - 1.5 * iqr;
  const upperFence = q3 + 1.5 * iqr;
  const whiskerLow = firstHistogramValueAtOrAbove(entries, lowerFence);
  const whiskerHigh = lastHistogramValueAtOrBelow(entries, upperFence);
  if (whiskerLow == null || whiskerHigh == null) return null;

  return {
    q1,
    median,
    q3,
    whiskerLow,
    whiskerHigh,
  };
}

function renderTraitDecadeCharts(aggregations) {
  const container = document.getElementById("mappedTraitsTable");
  if (!container) return;
  container.innerHTML = "";

  const title = document.createElement("h3");
  title.textContent = "Mapped Traits: Day of Year by Decade";
  title.className = "stats-section-title";
  container.appendChild(title);

  const note = document.createElement("p");
  note.className = "stats-note";
  const traitNote = window.lastStatsMeta?.traitNote ? ` ${window.lastStatsMeta.traitNote}` : "";
  note.textContent = `Each chart shows one trait. Boxes mark the middle 50% of day-of-year observations, the line inside each box is the median, and whiskers follow the Tukey box-plot rule to the nearest non-outlier day of year in each decade.${traitNote}`;
  container.appendChild(note);

  if (typeof Chart !== "function") {
    const fallback = document.createElement("div");
    fallback.className = "stats-empty-state";
    fallback.textContent = "Chart.js is not available, so the mapped trait charts could not be rendered.";
    container.appendChild(fallback);
    return;
  }

  ensurePhenologyBoxPlotPlugin();

  const traitBuckets = (aggregations?.mappedTraitsByDecade_4?.buckets || [])
    .filter((bucket) => !isStatsHiddenTrait(bucket?.key))
    .filter((bucket) => (bucket?.doy_records?.doc_count || 0) > 0);

  if (!traitBuckets.length) {
    const empty = document.createElement("div");
    empty.className = "stats-empty-state";
    empty.textContent = "No mapped-trait day-of-year observations are available for the current filters.";
    container.appendChild(empty);
    return;
  }

  const grid = document.createElement("div");
  grid.className = "trait-decade-grid";

  traitBuckets.forEach((bucket) => {
    const decadeBuckets = bucket?.doy_records?.decades?.buckets || [];
    const labels = [];
    const rangeData = [];
    const boxStatsByIndex = [];
    const countsByIndex = [];

    decadeBuckets.forEach((decadeBucket) => {
      const decadeStart = Math.floor(Number(decadeBucket?.key) / 10) * 10;
      labels.push(statsFormatDecadeLabel(decadeStart));

      const count = decadeBucket?.doc_count || 0;
      countsByIndex.push(count);

      if (!count) {
        rangeData.push(null);
        boxStatsByIndex.push(null);
        return;
      }

      const stats = computeTukeyBoxStatsFromHistogram(decadeBucket?.doy_histogram?.buckets || []);
      if (!stats) {
        rangeData.push(null);
        boxStatsByIndex.push(null);
        return;
      }

      const clampedQ1 = Math.max(STATS_MIN_DOY, stats.q1);
      const clampedMedian = Math.max(STATS_MIN_DOY, Math.min(STATS_MAX_DOY, stats.median));
      const clampedQ3 = Math.min(STATS_MAX_DOY, stats.q3);
      const clampedWhiskerLow = Math.max(STATS_MIN_DOY, stats.whiskerLow);
      const clampedWhiskerHigh = Math.min(STATS_MAX_DOY, stats.whiskerHigh);

      rangeData.push([
        clampedQ1,
        clampedQ3,
      ]);
      boxStatsByIndex.push({
        q1: clampedQ1,
        median: clampedMedian,
        q3: clampedQ3,
        whiskerLow: clampedWhiskerLow,
        whiskerHigh: clampedWhiskerHigh,
      });
    });

    const hasVisibleData = rangeData.some((value) => Array.isArray(value));
    if (!hasVisibleData) return;

    const card = document.createElement("section");
    card.className = "trait-decade-card";

    const header = document.createElement("div");
    header.className = "trait-decade-card-header";

    const traitTitle = document.createElement("h4");
    traitTitle.className = "trait-decade-title";
    traitTitle.textContent = bucket.key;
    header.appendChild(traitTitle);

    const traitMeta = document.createElement("div");
    traitMeta.className = "trait-decade-meta";
    traitMeta.textContent = `${bucket.doc_count.toLocaleString()} total record${bucket.doc_count === 1 ? "" : "s"} • ${bucket.doy_records.doc_count.toLocaleString()} with day of year`;
    header.appendChild(traitMeta);

    card.appendChild(header);

    const chartWrap = document.createElement("div");
    chartWrap.className = "trait-decade-canvas-wrap";
    const canvas = document.createElement("canvas");
    chartWrap.appendChild(canvas);
    card.appendChild(chartWrap);
    grid.appendChild(card);

    const chart = new Chart(canvas.getContext("2d"), {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            type: "bar",
            label: "Box plot",
            data: rangeData,
            backgroundColor: "rgba(147, 197, 253, 0.65)",
            borderColor: "rgba(37, 99, 235, 0.95)",
            borderWidth: 1,
            borderSkipped: false,
            borderRadius: 4,
          },
        ],
      },
      options: {
        animation: false,
        maintainAspectRatio: false,
        responsive: true,
        interaction: {
          mode: "index",
          intersect: false,
        },
        plugins: {
          phenologyBoxPlotOverlay: {
            boxStats: boxStatsByIndex,
            datasetIndex: 0,
            strokeColor: "#0f172a",
            medianColor: "#1d4ed8",
          },
          legend: {
            position: "top",
            labels: {
              boxWidth: 12,
              font: {
                size: 11,
                weight: "400",
              },
            },
          },
          tooltip: {
            callbacks: {
              label(context) {
                const count = countsByIndex[context.dataIndex] || 0;
                const stats = boxStatsByIndex[context.dataIndex];
                if (!stats) return "No day-of-year observations";
                return [
                  `Median: ${Math.round(stats.median)}`,
                  `IQR: ${Math.round(stats.q1)}-${Math.round(stats.q3)}`,
                  `Whiskers: ${Math.round(stats.whiskerLow)}-${Math.round(stats.whiskerHigh)}`,
                  `n: ${count.toLocaleString()}`,
                ];
              },
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              autoSkip: true,
              maxRotation: 0,
              minRotation: 0,
              font: { size: 10 },
            },
          },
          y: {
            min: STATS_MIN_DOY,
            max: STATS_MAX_DOY,
            title: {
              display: true,
              text: "Day of year",
            },
            ticks: {
              stepSize: 60,
            },
          },
        },
      },
    });

    statsCharts.push(chart);
  });

  if (!grid.childElementCount) {
    const empty = document.createElement("div");
    empty.className = "stats-empty-state";
    empty.textContent = "No mapped-trait day-of-year observations are available for the current filters.";
    container.appendChild(empty);
    return;
  }

  container.appendChild(grid);
}

function renderGlobalPhenophaseSummary(aggregations) {
  const container = document.getElementById("mappedTraitsTable");
  if (!container) return;
  container.innerHTML = "";
  const summaryNoteText = "This lighter global summary shows high-level present and absent counts for the main simple phenophases. Detailed day-of-year trait charts are skipped here so the global overview renders faster.";

  const buckets = aggregations?.phenophasePresenceSummary_4?.buckets || {};
  const rows = STATS_SIMPLE_PHASES.map((phase) => {
    const present = Number(buckets?.[summaryAggNameForPhase(phase.key, "present")]?.doc_count || 0);
    const absent = Number(buckets?.[summaryAggNameForPhase(phase.key, "absent")]?.doc_count || 0);
    return {
      label: phase.label,
      present,
      absent,
      total: present + absent,
    };
  }).sort((a, b) => b.total - a.total);

  if (!rows.some((row) => row.total > 0)) {
    const empty = document.createElement("div");
    empty.className = "stats-empty-state";
    empty.textContent = "No phenophase summary is available for the current filters.";
    container.appendChild(empty);
    return;
  }

  renderTable(
    "mappedTraitsTable",
    ["Phenophase", "Present", "Absent", "Total"],
    rows.map((row) => [
      row.label,
      row.present.toLocaleString(),
      row.absent.toLocaleString(),
      row.total.toLocaleString(),
    ]),
    "Phenophase Presence Summary"
  );

  const renderedTable = container.querySelector("table");
  if (renderedTable) renderedTable.classList.add("table-striped");

  const renderedTitle = container.querySelector(".stats-section-title");
  if (renderedTitle) {
    const renderedNote = document.createElement("p");
    renderedNote.className = "stats-note";
    renderedNote.textContent = summaryNoteText;
    renderedTitle.insertAdjacentElement("afterend", renderedNote);
  }
}

function renderStats(aggregations, options = {}) {
  destroyStatsCharts();
  const summaryOnly = !!options.summaryOnly;

  const datasourceBuckets = aggregations?.datasource_0?.buckets || [];
  renderTable(
    "datasourceTable",
    ["Datasource", "Count"],
    datasourceBuckets.map((bucket) => [bucket.key, bucket.doc_count.toLocaleString()]),
    "Datasource Distribution"
  );

  renderDecadeDistributionChart(aggregations);

  if (summaryOnly) {
    renderGlobalPhenophaseSummary(aggregations);
  } else {
    renderTraitDecadeCharts(aggregations);
  }

  const familyBuckets = aggregations?.family_2?.buckets || [];
  renderTopDistributionChart("familyTable", familyBuckets, {
    title: "Family Distribution",
    entityLabel: "families",
    emptyText: "No family distribution is available for the current filters.",
    barColor: "rgba(34, 94, 64, 0.72)",
    barBorderColor: "rgba(22, 78, 51, 1)",
    limit: 20,
    step: 20,
    baseLimit: 20,
  });

  const genusBuckets = aggregations?.genus_3?.buckets || [];
  renderTopDistributionChart("genusTable", genusBuckets, {
    title: "Genus Distribution",
    entityLabel: "genera",
    emptyText: "No genus distribution is available for the current filters.",
    barColor: "rgba(37, 99, 235, 0.68)",
    barBorderColor: "rgba(29, 78, 216, 1)",
    limit: 20,
    step: 20,
    baseLimit: 20,
  });

  refreshDataReleaseHistorySection();
}

function isSummaryOnlyStatsSnapshot(snapshot) {
  if (snapshot?.summaryOnly != null) return !!snapshot.summaryOnly;
  return !!snapshot?.aggregations?.phenophasePresenceSummary_4 && !snapshot?.aggregations?.mappedTraitsByDecade_4;
}

async function renderPrebuiltGlobalStatsSnapshot() {
  const snapshot = await getGlobalStatsSnapshot();
  if (!snapshot?.aggregations) return false;
  if (!isUnfilteredStatsQuery(currentStatsQuery())) return false;
  if (!isUsableGlobalStatsSnapshot(snapshot)) return false;

  window.lastStatsMeta = { traitNote: snapshot.traitNote || "" };
  renderStats(snapshot.aggregations, { summaryOnly: isSummaryOnlyStatsSnapshot(snapshot) });
  statsLoadState.activeRequest = null;
  statsLoadState.loading = false;
  statsLoadState.completed = true;
  statsLoadState.stale = false;
  statsLoadState.signature = getStatsQuerySignature();

  const generatedAt = formatStatsSnapshotTimestamp(snapshot.generatedAt || snapshot.cachedAt);
  const suffix = generatedAt ? ` from ${generatedAt}` : "";
  setStatsStatus(`Showing prebuilt global summary${suffix}. Click "Refresh Stats" to request live data.`, "info");
  if (typeof window.setResultsHeadingText === "function") {
    window.setResultsHeadingText("Showing global stats snapshot");
  }
  return true;
}

function showInitialStatsView() {
  if (!shouldUseGlobalSummaryStats()) return fetchStatsData();

  return renderPrebuiltGlobalStatsSnapshot().then((rendered) => {
    if (rendered) return null;
    return fetchStatsData();
  });
}

async function fetchStatsData() {
  const requestId = ++statsLoadState.requestId;
  const signature = getStatsQuerySignature();
  const summaryOnly = shouldUseGlobalSummaryStats();

  abortActiveStatsRequest();
  statsLoadState.loading = true;
  statsLoadState.stale = false;
  refreshDataReleaseHistorySection();

  if (window.currentMainTab === "stats" && typeof showLoader === "function") {
    showLoader(summaryOnly ? "Loading global summary..." : "Loading stats...", 16);
  }

  setStatsStatus("Stats are refreshing... please wait.", "info");

  const statsMeta = summaryOnly
    ? { note: "Showing a lighter high-level phenophase summary for the unfiltered global view." }
    : await getStatsTraitAggregationConfig();
  if (requestId !== statsLoadState.requestId) {
    if (typeof hideLoader === "function") {
      hideLoader();
    }
    return null;
  }
  if (window.currentMainTab === "stats" && typeof setLoaderStage === "function") {
    setLoaderStage(summaryOnly ? "Summarizing global records..." : "Preparing stats charts...", 42);
  }
  const requestBody = buildStatsRequestData(statsMeta);

  const request = $.ajax({
    url: STATS_API_URL,
    method: "POST",
    contentType: "application/json",
    data: JSON.stringify(requestBody),
    dataType: "json",
    success(response) {
      if (requestId !== statsLoadState.requestId) return;
      statsLoadState.activeRequest = null;
      statsLoadState.loading = false;
      if (typeof setLoaderStage === "function") {
        setLoaderStage(summaryOnly ? "Rendering global summary..." : "Rendering stats...", 92);
      }

      if (response && response.aggregations) {
        window.lastStatsMeta = { traitNote: statsMeta.note };
        renderStats(response.aggregations, { summaryOnly });
        statsLoadState.signature = signature;
        statsLoadState.completed = true;
        statsLoadState.stale = false;
        setStatsStatus(summaryOnly ? "Global summary updated." : "Stats updated.", "success");
        if (typeof window.setResultsHeadingText === "function" && window.currentMainTab === "stats") {
          window.setResultsHeadingText(isUnfilteredStatsQuery(currentStatsQuery()) ? "Showing global stats overview" : "Showing filtered stats");
        }
        if (typeof hideLoader === "function") {
          hideLoader();
        }
        return;
      }

      console.error("No aggregations in response.");
      statsLoadState.completed = false;
      statsLoadState.stale = true;
      if (typeof hideLoader === "function") {
        hideLoader();
      }
      setStatsStatus('No stats data is available for the current filters. Click "Refresh Stats" to try again. If needed, narrow by phenophase, scientific name, geographic scope, or time period.', "error");
    },
    error(error) {
      if (error?.statusText === "abort") {
        if (typeof hideLoader === "function") {
          hideLoader();
        }
        return;
      }
      if (requestId !== statsLoadState.requestId) return;
      statsLoadState.activeRequest = null;
      statsLoadState.loading = false;
      statsLoadState.completed = false;
      statsLoadState.stale = true;
      if (typeof hideLoader === "function") {
        hideLoader();
      }
      console.error("Error fetching stats:", error);
      const reason = error?.responseJSON?.error?.reason
        || error?.responseJSON?.error?.root_cause?.[0]?.reason
        || error?.statusText
        || error?.responseText
        || "Failed to load stats data.";
      setStatsStatus(`Failed to load stats data. ${reason} If the query is broad, try filtering by phenophase, scientific name, geographic scope, or time period.`, "error");
    },
  });

  statsLoadState.activeRequest = request;
  return request;
}

window.fetchStatsData = fetchStatsData;
window.markStatsNeedsRefresh = markStatsNeedsRefresh;
window.showInitialStatsView = showInitialStatsView;
window.hasRenderedStats = function hasRenderedStats() {
  return !!statsLoadState.completed && !statsLoadState.stale;
};

$(document).ready(function () {
  const refreshBtn = document.getElementById("refreshStatsButton");
  if (refreshBtn && !refreshBtn.dataset.bound) {
    refreshBtn.addEventListener("click", function () {
      fetchStatsData();
    });
    refreshBtn.dataset.bound = "true";
  }

  if (!statsLoadState.loading && !statsLoadState.completed) {
    markStatsNeedsRefresh();
  }
});

window.syncStatsStatusVisibility = syncStatsStatusVisibility;
