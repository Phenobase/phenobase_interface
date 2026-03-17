const STATS_API_URL = "https://biscicol.org/phenobase/api/v1/query//phenobase2/_search?size=0&from=0";
const STATS_HIDDEN_TRAIT = "plant structure present";
const STATS_PERCENTILES = [25, 50, 75];
const STATS_MIN_DOY = 1;
const STATS_MAX_DOY = 366;
const statsCharts = [];
let phenologyBoxPlotPluginRegistered = false;

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

function buildStatsRequestData() {
  const query = window.requestData?.query || { match_all: {} };
  const decadeBounds = getStatsDecadeBounds();

  return {
    size: 0,
    track_total_hits: false,
    query,
    aggs: {
      datasource_0: { terms: { field: "dataSource", size: 10 } },
      family_2: { terms: { field: "family", size: 50 } },
      genus_3: { terms: { field: "genus", size: 50 } },
      mappedTraitsByDecade_4: {
        terms: { field: "mappedTraits", size: 2000 },
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
      },
    },
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

  destroyStatsCharts();
  container.innerHTML = "";

  const title = document.createElement("h3");
  title.textContent = "Mapped Traits: Day of Year by Decade";
  title.className = "stats-section-title";
  container.appendChild(title);

  const note = document.createElement("p");
  note.className = "stats-note";
  note.textContent = "Each chart shows one trait. Boxes mark the middle 50% of day-of-year observations, the line inside each box is the median, and whiskers follow the Tukey box-plot rule to the nearest non-outlier day of year in each decade.";
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

function renderStats(aggregations) {
  const datasourceBuckets = aggregations?.datasource_0?.buckets || [];
  renderTable(
    "datasourceTable",
    ["Datasource", "Count"],
    datasourceBuckets.map((bucket) => [bucket.key, bucket.doc_count.toLocaleString()]),
    "Datasource Distribution"
  );

  renderTraitDecadeCharts(aggregations);

  const familyBuckets = aggregations?.family_2?.buckets || [];
  renderTable(
    "familyTable",
    ["Family", "Count"],
    familyBuckets.map((bucket) => [bucket.key, bucket.doc_count.toLocaleString()]),
    "Family Distribution"
  );

  const genusBuckets = aggregations?.genus_3?.buckets || [];
  renderTable(
    "genusTable",
    ["Genus", "Count"],
    genusBuckets.map((bucket) => [bucket.key, bucket.doc_count.toLocaleString()]),
    "Genus Distribution"
  );
}

function fetchStatsData() {
  $.ajax({
    url: STATS_API_URL,
    method: "POST",
    contentType: "application/json",
    data: JSON.stringify(buildStatsRequestData()),
    dataType: "json",
    success(response) {
      if (response && response.aggregations) {
        renderStats(response.aggregations);
        return;
      }

      console.error("No aggregations in response.");
      alert("No data available for stats view.");
    },
    error(error) {
      console.error("Error fetching stats:", error);
      alert("Failed to load stats data.");
    },
  });
}

window.fetchStatsData = fetchStatsData;
