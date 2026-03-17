const STATS_API_URL = "https://biscicol.org/phenobase/api/v1/query//phenobase2/_search?size=0&from=0";
const STATS_HIDDEN_TRAIT = "plant structure present";
const STATS_PERCENTILES = [25, 50, 75];
const STATS_MIN_DOY = 1;
const STATS_MAX_DOY = 366;
const statsCharts = [];

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
                  doy_percentiles: {
                    percentiles: {
                      field: "dayOfYear",
                      percents: STATS_PERCENTILES,
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

function percentileValue(values, key) {
  const value = Number(values?.[key]);
  return Number.isFinite(value) ? value : null;
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
  note.textContent = "Each chart shows one trait. Bars mark the middle 50% of day-of-year observations in each decade and the line marks the median.";
  container.appendChild(note);

  if (typeof Chart !== "function") {
    const fallback = document.createElement("div");
    fallback.className = "stats-empty-state";
    fallback.textContent = "Chart.js is not available, so the mapped trait charts could not be rendered.";
    container.appendChild(fallback);
    return;
  }

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
    const medianData = [];
    const countsByIndex = [];

    decadeBuckets.forEach((decadeBucket) => {
      const decadeStart = Math.floor(Number(decadeBucket?.key) / 10) * 10;
      labels.push(statsFormatDecadeLabel(decadeStart));

      const count = decadeBucket?.doc_count || 0;
      countsByIndex.push(count);

      if (!count) {
        rangeData.push(null);
        medianData.push(null);
        return;
      }

      const percentiles = decadeBucket?.doy_percentiles?.values || {};
      const q1 = percentileValue(percentiles, "25.0");
      const median = percentileValue(percentiles, "50.0");
      const q3 = percentileValue(percentiles, "75.0");

      if (q1 == null || median == null || q3 == null) {
        rangeData.push(null);
        medianData.push(null);
        return;
      }

      rangeData.push([
        Math.max(STATS_MIN_DOY, q1),
        Math.min(STATS_MAX_DOY, q3),
      ]);
      medianData.push(Math.max(STATS_MIN_DOY, Math.min(STATS_MAX_DOY, median)));
    });

    const hasVisibleData = rangeData.some((value) => Array.isArray(value)) || medianData.some((value) => value != null);
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
            label: "Middle 50%",
            data: rangeData,
            backgroundColor: "rgba(147, 197, 253, 0.65)",
            borderColor: "rgba(37, 99, 235, 0.95)",
            borderWidth: 1,
            borderRadius: 4,
          },
          {
            type: "line",
            label: "Median",
            data: medianData,
            borderColor: "#1d4ed8",
            backgroundColor: "#1d4ed8",
            borderWidth: 2,
            pointRadius: 2.5,
            pointHoverRadius: 4,
            tension: 0.2,
            spanGaps: false,
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
                if (context.dataset.type === "bar") {
                  const value = context.raw;
                  if (!Array.isArray(value)) return "No day-of-year observations";
                  return `Middle 50%: ${Math.round(value[0])}-${Math.round(value[1])} (${count.toLocaleString()} obs)`;
                }
                if (context.parsed?.y == null) return "Median: n/a";
                return `Median: ${Math.round(context.parsed.y)} (${count.toLocaleString()} obs)`;
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
