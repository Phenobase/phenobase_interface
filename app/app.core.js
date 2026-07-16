// Pagination & URLs
let currentPage = 1;
// make pageSize mutable so we can auto-size it
let pageSize = 15;

var apiUrl = `https://biscicol.org/phenobase/api/v1/query//phenobase2/_search?size=${pageSize}&from=0`;
var taxonSuggestUrl = "/api/taxa/suggest";
var downloadUrl = "/api/download";
var downloadLink = "";
const DOWNLOAD_LIMIT = 100000;
const TABLE_SOURCE_FIELDS = [
  "annotationID",
  "dataSource",
  "scientificName",
  "year",
  "dayOfYear",
  "standardizedFamily",
  "verbatimFamily",
  "genus",
  "trait",
  "verbatimTrait",
  "sourceRecordUrl",
  "observedMetadataUrl",
];
const defaultTimeConfig = window.phenobaseTimeConfig || {};
const DEFAULT_MIN_YEAR = Number.isFinite(Number(defaultTimeConfig.minYear)) ? Math.round(Number(defaultTimeConfig.minYear)) : 1970;
const DEFAULT_MAX_YEAR = Number.isFinite(Number(defaultTimeConfig.maxYear)) ? Math.round(Number(defaultTimeConfig.maxYear)) : new Date().getFullYear();
const DEFAULT_MIN_DECADE = Math.floor(DEFAULT_MIN_YEAR / 10) * 10;
const DEFAULT_MAX_DECADE = Math.floor(DEFAULT_MAX_YEAR / 10) * 10;
window.DEFAULT_MIN_DECADE = DEFAULT_MIN_DECADE;
window.DEFAULT_MAX_DECADE = DEFAULT_MAX_DECADE;

// Hidden mapped trait
const HIDDEN_TRAIT = 'plant structure present';
function isHiddenTrait(v) { return String(v || '').trim().toLowerCase() === HIDDEN_TRAIT; }

// ES request payload
var requestData = {
  aggs: {
    datasource_0: { terms: { field: "dataSource", size: 100 } },
    mappedTraits_1: { terms: { field: "mappedTraits", size: 2000 } },
    family_2: { terms: { field: "standardizedFamily", size: 50 } },
    genus_3: { terms: { field: "genus", size: 50 } },
    decade_4: {
      histogram: {
        field: "decadeStart",
        interval: 10,
        min_doc_count: 0,
        extended_bounds: { min: DEFAULT_MIN_DECADE, max: DEFAULT_MAX_DECADE }
      }
    }
  },
  query: { bool: { must: [] } }
};

var selectedFacets = {};
var scientificNameFilter = null;
var scientificNameSearchText = "";
var taxonFilter = null;
var taxonSuggestions = [];
var taxonSuggestionIndex = -1;
var taxonSuggestTimer = null;
var taxonSuggestController = null;
window.scientificNameFilter = scientificNameFilter;
window.scientificNameSearchText = scientificNameSearchText;
window.taxonFilter = taxonFilter;

// NEW: Field-level AND/OR modes
const facetModes = {
  dataSource: 'AND',
  standardizedFamily: 'AND',
  genus: 'AND',
  // mappedTraits is driven by the Option-B OR groups; leave as AND here for normal term selections
  mappedTraits: 'AND',
};
function setFacetMode(field, mode) { facetModes[field] = (mode === 'OR') ? 'OR' : 'AND'; }
function getFacetMode(field) { return facetModes[field] || 'AND'; }

// ---------------------------
// NEW: Dynamic page-size helpers
// ---------------------------
function measureTableMetrics() {
  // build a temp table that matches columns to estimate header/row heights
  const temp = document.createElement('table');
  temp.className = 'table';
  temp.style.visibility = 'hidden';
  temp.style.position = 'absolute';
  temp.style.left = '-9999px';
  temp.innerHTML = `
    <thead>
      <tr>
        <th>View Details</th><th>Datasource</th><th>Scientific Name</th>
        <th>Year</th><th>Day of Year</th><th>Family</th><th>Genus</th>
        <th>Trait</th><th>Verbatim Trait</th><th>Source Record</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>•</td><td>AAAA</td><td>BBBB</td><td>2020</td><td>123</td>
        <td>CCCC</td><td>DDDD</td><td>EEEE</td><td>FFFF</td><td>GGGG</td>
      </tr>
    </tbody>
  `;
  document.body.appendChild(temp);

  const theadH = temp.tHead ? temp.tHead.getBoundingClientRect().height : 34;
  const rowH = temp.tBodies[0].rows[0].getBoundingClientRect().height || 34;

  document.body.removeChild(temp);

  const pag = document.getElementById('pagination');
  const paginationH = pag ? (pag.getBoundingClientRect().height || 44) : 44;

  return { theadH, rowH, paginationH };
}

function computeDynamicPageSize() {
  const tableContainer = document.getElementById('tableContainer');
  if (!tableContainer || tableContainer.offsetParent === null) return; // only when visible

  const { theadH, rowH, paginationH } = measureTableMetrics();
  const innerPad = 12; // small buffer for paddings/margins

  const containerH = tableContainer.getBoundingClientRect().height;
  const usable = containerH - theadH - paginationH - innerPad;

  const minRows = 5;
  const rows = Math.max(minRows, Math.floor(usable / rowH) || minRows);

  if (rows !== pageSize) {
    // try to keep the same top item visible
    const topIndex = (currentPage - 1) * pageSize;
    pageSize = rows;
    currentPage = Math.floor(topIndex / pageSize) + 1;
    if (currentPage < 1) currentPage = 1;
  }
}

// Helpers
function escapeLuceneValue(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function rangeToLucene(field, spec) {
  const hasGte = Object.prototype.hasOwnProperty.call(spec || {}, 'gte');
  const hasGt = Object.prototype.hasOwnProperty.call(spec || {}, 'gt');
  const hasLte = Object.prototype.hasOwnProperty.call(spec || {}, 'lte');
  const hasLt = Object.prototype.hasOwnProperty.call(spec || {}, 'lt');

  const left = hasGte ? `[${spec.gte}` : (hasGt ? `{${spec.gt}` : '[*');
  const right = hasLte ? `${spec.lte}]` : (hasLt ? `${spec.lt}}` : '*]');
  return `${field}:${left} TO ${right}`;
}

function clauseToLucene(clause) {
  if (!clause || typeof clause !== 'object') return '';
  if (clause.match_all) return '*:*';

  if (clause.term) {
    const [field, value] = Object.entries(clause.term)[0] || [];
    return field ? `${field}:"${escapeLuceneValue(value)}"` : '';
  }

  if (clause.match) {
    const [field, value] = Object.entries(clause.match)[0] || [];
    return field ? `${field}:"${escapeLuceneValue(value)}"` : '';
  }

  if (clause.wildcard) {
    const [field, value] = Object.entries(clause.wildcard)[0] || [];
    if (!field) return '';
    const wildcardValue = (value && typeof value === 'object' && value.value != null) ? value.value : value;
    return `${field}:${escapeLuceneValue(wildcardValue)}`;
  }

  if (clause.range) {
    const [field, spec] = Object.entries(clause.range)[0] || [];
    if (!field || !spec || typeof spec !== 'object') return '';
    return rangeToLucene(field, spec);
  }

  if (clause.bool) {
    const bool = clause.bool;
    const parts = [];

    if (Array.isArray(bool.must) && bool.must.length) {
      const must = bool.must.map(clauseToLucene).filter(Boolean);
      if (must.length) parts.push(must.length > 1 ? `(${must.join(' AND ')})` : must[0]);
    }

    if (Array.isArray(bool.should) && bool.should.length) {
      const should = bool.should.map(clauseToLucene).filter(Boolean);
      if (should.length) parts.push(should.length > 1 ? `(${should.join(' OR ')})` : should[0]);
    }

    if (Array.isArray(bool.must_not) && bool.must_not.length) {
      const mustNot = bool.must_not.map(clauseToLucene).filter(Boolean);
      if (mustNot.length) {
        const notPart = mustNot.length > 1 ? `(${mustNot.join(' OR ')})` : mustNot[0];
        parts.push(`NOT ${notPart}`);
      }
    }

    if (!parts.length) return '';
    return parts.length > 1 ? `(${parts.join(' AND ')})` : parts[0];
  }

  return '';
}

function convertJsonToLucene(jsonQuery) {
  const lucene = clauseToLucene(jsonQuery);
  return lucene || '*:*';
}
let loaderProgressTimer = null;
let loaderStartedAt = 0;
let loaderStageBaseProgress = 0;
let loaderHideTimer = null;
let detailsModalRequestId = 0;
let activeTableRequest = null;
let tableRequestId = 0;
let activeFacetRequest = null;
let facetRequestId = 0;
let activeDataSourceFacetRequest = null;
let dataSourceFacetRequestId = 0;
const tableTotalCache = new Map();

function updateLoaderProgress(stageText, progressPercent) {
  const safePercent = Math.max(0, Math.min(100, Math.round(progressPercent || 0)));
  if ($('#loaderStage').length) $('#loaderStage').text(stageText || 'Loading records...');
  if ($('#loaderProgressBar').length) $('#loaderProgressBar').css('width', `${safePercent}%`);
  if ($('#loaderPercent').length) $('#loaderPercent').text(`${safePercent}%`);
}

function refreshLoaderElapsed() {
  if (!loaderStartedAt) return;
  const elapsedMs = Date.now() - loaderStartedAt;
  const driftPercent = Math.min(92, loaderStageBaseProgress + Math.floor(elapsedMs / 220));
  if ($('#loaderElapsed').length) $('#loaderElapsed').text(`Elapsed: ${(elapsedMs / 1000).toFixed(1)}s`);
  updateLoaderProgress($('#loaderStage').text() || 'Loading records...', driftPercent);
}

function showLoader(stageText = 'Submitting query...', baseProgress = 12) {
  loaderStartedAt = Date.now();
  loaderStageBaseProgress = baseProgress;
  if (loaderProgressTimer) {
    clearInterval(loaderProgressTimer);
    loaderProgressTimer = null;
  }
  if (loaderHideTimer) {
    clearTimeout(loaderHideTimer);
    loaderHideTimer = null;
  }
  $("#loader").css("display", "flex").attr("aria-hidden", "false");
  $(".facet-link").css("pointer-events", "none");
  updateLoaderProgress(stageText, loaderStageBaseProgress);
  if ($('#loaderElapsed').length) $('#loaderElapsed').text('Elapsed: 0.0s');
  loaderProgressTimer = window.setInterval(refreshLoaderElapsed, 120);
}

function setLoaderStage(stageText, baseProgress) {
  loaderStageBaseProgress = Math.max(loaderStageBaseProgress, Math.round(baseProgress || 0));
  updateLoaderProgress(stageText, loaderStageBaseProgress);
}

function hideLoader() {
  if (loaderProgressTimer) {
    clearInterval(loaderProgressTimer);
    loaderProgressTimer = null;
  }
  if (loaderHideTimer) {
    clearTimeout(loaderHideTimer);
    loaderHideTimer = null;
  }
  loaderStartedAt = 0;
  loaderStageBaseProgress = 0;
  $("#loader").css("display", "none").attr("aria-hidden", "true");
  $(".facet-link").css("pointer-events", "auto");
}
function loadScriptOnce(src, globalTest) {
  if (typeof globalTest === "function" && globalTest()) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-src-once="${src}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", reject, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.dataset.srcOnce = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

function ensurePhenobaseMapLoaded() {
  if (window.phenobaseMapLoadPromise) return window.phenobaseMapLoadPromise;

  window.phenobaseMapLoadPromise = loadScriptOnce("https://unpkg.com/leaflet/dist/leaflet.js", () => !!window.L)
    .then(() => loadScriptOnce("https://unpkg.com/leaflet.markercluster/dist/leaflet.markercluster.js", () => !!window.L?.markerClusterGroup))
    .then(() => loadScriptOnce("app.map.js", () => !!window.phenobaseLeafletMap));

  return window.phenobaseMapLoadPromise;
}
window.ensurePhenobaseMapLoaded = ensurePhenobaseMapLoaded;
function setResultsHeadingText(text) {
  const el = document.getElementById('resultsHeading');
  if (!el) return;
  el.textContent = text || 'Showing Results';
}
function getCurrentQuerySignature() {
  try {
    return JSON.stringify(requestData.query || { match_all: {} });
  } catch (_error) {
    return String(Date.now());
  }
}
function updateResultsHeading(showingResults, totalResults) {
  setResultsHeadingText(`Showing ${showingResults} of ${totalResults.toLocaleString()} total possible results`);
}
function getTotalHitsValue(response) {
  const total = response?.hits?.total;
  if (typeof total === 'number') return total;
  if (total && typeof total.value === 'number') return total.value;
  return null;
}
function calculateTotalFromFacets(aggregations) {
  let total = 0;
  if (aggregations.datasource_0?.buckets) {
    total = aggregations.datasource_0.buckets.reduce((s,b)=>s+b.doc_count,0);
  }
  return total;
}
function updateDownloadLink() {
  const query = encodeURIComponent(JSON.stringify(requestData.query || { match_all: {} }));
  downloadLink = `${downloadUrl}?query=${query}&limit=${DOWNLOAD_LIMIT}`;
  $("#downloadButton").attr("href", downloadLink).attr("download", "phenobase_data.zip").prop("disabled", false);
}
function setActiveMainTab(tabName) {
  window.currentMainTab = tabName;

  const isTable = tabName === 'table';
  const isMap = tabName === 'map';
  const isStats = tabName === 'stats';

  $("#tableContainer").toggle(isTable);
  $("#mapContainer").toggle(isMap);
  $("#statsContainer").toggle(isStats);

  $("#showTable").toggleClass("is-active", isTable).attr("aria-pressed", isTable ? "true" : "false");
  $("#showMap").toggleClass("is-active", isMap).attr("aria-pressed", isMap ? "true" : "false");
  $("#showStats").toggleClass("is-active", isStats).attr("aria-pressed", isStats ? "true" : "false");

  if (isStats) {
    setResultsHeadingText('Showing stats overview');
  } else if (isMap) {
    setResultsHeadingText('Map results update on demand');
  } else if (!window.lastResultsLoadedSignature) {
    setResultsHeadingText('Table results will load after filters are applied');
  }

  if (typeof window.syncStatsStatusVisibility === 'function') {
    window.syncStatsStatusVisibility();
  }
}

function loadStatsForCurrentFilters() {
  if (typeof window.showInitialStatsView === 'function') {
    window.showInitialStatsView();
    return;
  }
  if (typeof window.fetchStatsData === 'function') {
    window.fetchStatsData();
  }
}

function normalizeTaxonSuggestion(suggestion) {
  if (!suggestion || typeof suggestion !== "object") return null;
  const label = String(suggestion.label || suggestion.value || "").trim();
  const value = String(suggestion.value || suggestion.label || "").trim();
  const field = String(suggestion.field || "").trim();
  const rank = String(suggestion.rank || field || "").trim();
  if (!value || !field) return null;
  return { label: label || value, value, field, rank };
}

function escapeExactWildcardValue(value) {
  return String(value || "").replace(/[\\*?\[\]{}]/g, (character) => `\\${character}`);
}

function buildCaseInsensitiveExactFilter(field, value) {
  return {
    wildcard: {
      [field]: {
        value: escapeExactWildcardValue(value),
        case_insensitive: true,
      },
    },
  };
}

function buildTaxonFilterFromSuggestion(suggestion) {
  const normalized = normalizeTaxonSuggestion(suggestion);
  if (!normalized) return null;

  if (normalized.field === "scientificName") {
    return buildCaseInsensitiveExactFilter("taxonSearch", normalized.value);
  }

  if (normalized.field === "standardizedFamily" || normalized.field === "family") {
    return buildCaseInsensitiveExactFilter("standardizedFamily", normalized.value);
  }

  if (normalized.field === "genus") {
    return buildCaseInsensitiveExactFilter("genus", normalized.value);
  }

  return null;
}

function buildScientificSearchFilter(searchTerm) {
  const value = String(searchTerm || "").trim();
  if (!value) return null;
  return buildTaxonFilterFromSuggestion({
    label: value,
    field: "scientificName",
    rank: "species",
    value,
  });
}

function setTaxonFilter(suggestion) {
  const normalized = normalizeTaxonSuggestion(suggestion);
  const builtFilter = buildTaxonFilterFromSuggestion(normalized);

  taxonFilter = builtFilter ? normalized : null;
  window.taxonFilter = taxonFilter;
  scientificNameSearchText = taxonFilter ? taxonFilter.value : "";
  window.scientificNameSearchText = scientificNameSearchText;
  scientificNameFilter = builtFilter;
  window.scientificNameFilter = scientificNameFilter;

  if ($("#scientificNameSearch").length) {
    $("#scientificNameSearch")
      .val(taxonFilter ? taxonFilter.label : "")
      .attr("aria-expanded", "false");
  }
}

function clearTaxonFilter(options = {}) {
  const clearInput = options.clearInput !== false;
  taxonFilter = null;
  window.taxonFilter = null;
  scientificNameFilter = null;
  window.scientificNameFilter = null;
  scientificNameSearchText = "";
  window.scientificNameSearchText = "";
  taxonSuggestions = [];
  taxonSuggestionIndex = -1;

  if (taxonSuggestTimer) {
    window.clearTimeout(taxonSuggestTimer);
    taxonSuggestTimer = null;
  }
  if (taxonSuggestController) {
    taxonSuggestController.abort();
    taxonSuggestController = null;
  }
  if (clearInput && $("#scientificNameSearch").length) {
    $("#scientificNameSearch").val("");
  }
  hideTaxonSuggestions();
}

function syncScientificNameDraftFromInput() {
  const inputValue = $("#scientificNameSearch").val().trim();
  if (!inputValue) {
    clearTaxonFilter({ clearInput: false });
    return;
  }

  if (taxonFilter && inputValue !== taxonFilter.label) {
    clearTaxonFilter({ clearInput: false });
  }
}

function taxonFieldLabel(suggestion) {
  const field = String(suggestion?.field || suggestion?.rank || "").trim();
  if (field === "scientificName") return "species";
  if (field === "standardizedFamily") return "family";
  return field || "taxon";
}

function hideTaxonSuggestions() {
  taxonSuggestions = [];
  taxonSuggestionIndex = -1;
  $("#taxonSuggestions").empty().removeClass("is-visible");
  $("#scientificNameSearch").attr("aria-expanded", "false");
}

function renderTaxonSuggestions(items, message) {
  const $list = $("#taxonSuggestions");
  if (!$list.length) return;

  taxonSuggestions = Array.isArray(items)
    ? items.map(normalizeTaxonSuggestion).filter(Boolean)
    : [];
  taxonSuggestionIndex = taxonSuggestions.length ? 0 : -1;

  if (!taxonSuggestions.length) {
    $list
      .html(`<div class="taxon-suggestion-empty">${message || "No matching taxa found"}</div>`)
      .addClass("is-visible");
    $("#scientificNameSearch").attr("aria-expanded", "true");
    return;
  }

  $list
    .html(taxonSuggestions.map((suggestion, index) => `
      <button type="button" class="taxon-suggestion ${index === taxonSuggestionIndex ? "is-active" : ""}" role="option" data-index="${index}" aria-selected="${index === taxonSuggestionIndex ? "true" : "false"}">
        <span class="taxon-suggestion-label">${suggestion.label}</span>
        <span class="taxon-suggestion-rank">${taxonFieldLabel(suggestion)}</span>
      </button>
    `).join(""))
    .addClass("is-visible");
  $("#scientificNameSearch").attr("aria-expanded", "true");
}

function setActiveTaxonSuggestion(index) {
  if (!taxonSuggestions.length) return;
  taxonSuggestionIndex = (index + taxonSuggestions.length) % taxonSuggestions.length;
  $("#taxonSuggestions .taxon-suggestion").each(function (itemIndex) {
    const active = itemIndex === taxonSuggestionIndex;
    $(this).toggleClass("is-active", active).attr("aria-selected", active ? "true" : "false");
  });
}

function selectTaxonSuggestion(index) {
  const suggestion = taxonSuggestions[index];
  if (!suggestion) return;

  setTaxonFilter(suggestion);
  hideTaxonSuggestions();

  if (typeof window.markFiltersPending === "function") {
    window.markFiltersPending({ delayMs: 0 });
  }
}

function fetchTaxonSuggestions(queryText) {
  if (taxonSuggestController) {
    taxonSuggestController.abort();
    taxonSuggestController = null;
  }

  taxonSuggestController = typeof AbortController === "function" ? new AbortController() : null;
  const signal = taxonSuggestController?.signal;

  renderTaxonSuggestions([], "Searching taxa...");

  fetch(`${taxonSuggestUrl}?q=${encodeURIComponent(queryText)}`, { signal })
    .then((response) => {
      if (!response.ok) throw new Error(`Taxon suggestions failed: ${response.status}`);
      return response.json();
    })
    .then((items) => {
      if ($("#scientificNameSearch").val().trim() !== queryText) return;
      renderTaxonSuggestions(items, "No matching taxa found");
    })
    .catch((error) => {
      if (error?.name === "AbortError") return;
      console.error("Unable to load taxon suggestions:", error);
      renderTaxonSuggestions([], "No matching taxa found");
    });
}

function handleTaxonInput() {
  const queryText = $("#scientificNameSearch").val().trim();
  const hadTaxonFilter = !!scientificNameFilter;

  if (!queryText) {
    clearTaxonFilter({ clearInput: false });
    if (hadTaxonFilter && typeof window.markFiltersPending === "function") {
      window.markFiltersPending({ delayMs: 0 });
    }
    return;
  }

  if (taxonFilter && queryText !== taxonFilter.label) {
    clearTaxonFilter({ clearInput: false });
    if (typeof window.markFiltersPending === "function") {
      window.markFiltersPending({ delayMs: 0 });
    }
  }

  if (taxonSuggestTimer) window.clearTimeout(taxonSuggestTimer);
  taxonSuggestTimer = window.setTimeout(function () {
    fetchTaxonSuggestions(queryText);
  }, 300);
}

function handleTaxonKeydown(event) {
  if (!$("#taxonSuggestions").hasClass("is-visible")) return;

  if (event.key === "ArrowDown") {
    event.preventDefault();
    setActiveTaxonSuggestion(taxonSuggestionIndex + 1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    setActiveTaxonSuggestion(taxonSuggestionIndex - 1);
  } else if (event.key === "Enter") {
    if (taxonSuggestionIndex >= 0) {
      event.preventDefault();
      selectTaxonSuggestion(taxonSuggestionIndex);
    }
  } else if (event.key === "Escape") {
    hideTaxonSuggestions();
  }
}

window.buildTaxonFilterFromSuggestion = buildTaxonFilterFromSuggestion;
window.buildScientificSearchFilter = buildScientificSearchFilter;
window.setTaxonFilter = setTaxonFilter;
window.clearTaxonFilter = clearTaxonFilter;
function buildTableRequestBody() {
  const signature = getCurrentQuerySignature();
  return {
    query: requestData.query || { match_all: {} },
    _source: TABLE_SOURCE_FIELDS,
    track_total_hits: !tableTotalCache.has(signature),
  };
}

// Fetch & render
function fetchResults() {
  const requestId = ++tableRequestId;
  if (activeTableRequest && typeof activeTableRequest.abort === "function") {
    activeTableRequest.abort();
  }
  showLoader('Submitting query...', 14);

  // NEW: adjust page size to fill the screen when the table is visible
  if ($('#tableContainer').is(':visible')) {
    computeDynamicPageSize();
  }

  const offset = (currentPage - 1) * pageSize;
  const apiWithPagination = `${apiUrl.split('?')[0]}?size=${pageSize}&from=${offset}`;
  activeTableRequest = $.ajax({
    url: apiWithPagination, method: "POST", contentType: "application/json",
    beforeSend: function () {
      setLoaderStage('Waiting for records...', 26);
    },
    data: JSON.stringify(buildTableRequestBody()), dataType: "json",
    success: function (response) {
      if (requestId !== tableRequestId) return;
      activeTableRequest = null;
      setLoaderStage('Rendering results...', 96);
      if (response?.hits?.hits) {
        const results = response.hits.hits;
        const querySignature = getCurrentQuerySignature();
        const responseTotal = getTotalHitsValue(response);
        if (typeof responseTotal === 'number') {
          tableTotalCache.set(querySignature, responseTotal);
        }
        const totalResults = tableTotalCache.get(querySignature) ?? results.length;
        const startResult = totalResults ? offset + 1 : 0;
        const endResult   = Math.min(offset + results.length, totalResults);
        window.lastResultsLoadedSignature = querySignature;
        renderResults(results);
        renderSelectedFacets();
        updateDownloadLink();
        renderPagination(totalResults);
        if (typeof window.markMapNeedsRender === 'function') {
          window.markMapNeedsRender();
        }
        updateResultsHeading(`${startResult} - ${endResult}`, totalResults);
        setLoaderStage('Results ready.', 100);
        loaderHideTimer = window.setTimeout(hideLoader, 140);
      } else {
        hideLoader();
        console.error("Unexpected response", response);
        alert("Unexpected response structure.");
      }
    },
    error: function (error) {
      if (error?.statusText === "abort") return;
      if (requestId !== tableRequestId) return;
      activeTableRequest = null;
      hideLoader();
      console.error("Error fetching data:", error);
    }
  });
}

function fetchFacetData(options = {}) {
  const requestId = ++facetRequestId;
  if (activeFacetRequest && typeof activeFacetRequest.abort === "function") {
    activeFacetRequest.abort();
  }
  if (!options.skipDatasourcePreview) {
    fetchDataSourceFacetData();
  }
  const onSuccess = typeof options.onSuccess === 'function' ? options.onSuccess : null;
  const onError = typeof options.onError === 'function' ? options.onError : null;
  const facetApiUrl = `${apiUrl.split('?')[0]}?size=0&from=0`;
  const requestBody = buildFacetRequestBody(requestData.aggs);

  activeFacetRequest = $.ajax({
    url: facetApiUrl,
    method: "POST",
    contentType: "application/json",
    data: JSON.stringify(requestBody),
    dataType: "json",
    success(response) {
      if (requestId !== facetRequestId) return;
      activeFacetRequest = null;
      if (response?.aggregations) {
        renderFacets(response.aggregations);
        if (typeof onSuccess === 'function') onSuccess(response);
        return;
      }
      console.error("Unexpected facet response", response);
      if (typeof onError === 'function') onError(response);
    },
    error(error) {
      if (error?.statusText === "abort") return;
      if (requestId !== facetRequestId) return;
      activeFacetRequest = null;
      console.error("Error fetching facet data:", error);
      if (typeof onError === 'function') onError(error);
    }
  });
  return activeFacetRequest;
}

function buildFacetRequestBody(aggs) {
  return {
    ...requestData,
    aggs,
    size: 0,
    from: 0,
    track_total_hits: false,
  };
}

function clauseFiltersOnlyField(clause, field) {
  if (!clause || typeof clause !== "object") return false;

  const termFields = Object.keys(clause.term || {});
  if (termFields.length === 1 && termFields[0] === field) return true;

  const shouldClauses = clause.bool?.should;
  if (Array.isArray(shouldClauses) && shouldClauses.length) {
    return shouldClauses.every((childClause) => clauseFiltersOnlyField(childClause, field));
  }

  return false;
}

function queryWithoutFacetField(query, field) {
  if (!query?.bool || !Array.isArray(query.bool.must)) return query || { match_all: {} };

  const must = query.bool.must.filter((clause) => !clauseFiltersOnlyField(clause, field));
  if (!must.length) return { match_all: {} };

  return {
    bool: {
      ...query.bool,
      must,
    },
  };
}

function fetchDataSourceFacetData() {
  const requestId = ++dataSourceFacetRequestId;
  if (activeDataSourceFacetRequest && typeof activeDataSourceFacetRequest.abort === "function") {
    activeDataSourceFacetRequest.abort();
  }
  if (typeof window.renderDataSourceFacetLoading === 'function') {
    window.renderDataSourceFacetLoading('Loading data sources...');
  }

  const facetApiUrl = `${apiUrl.split('?')[0]}?size=0&from=0`;
  const requestBody = buildFacetRequestBody({
    datasource_0: { terms: { field: "dataSource", size: 100 } },
    all_datasource_0: {
      global: {},
      aggs: {
        datasource_0: { terms: { field: "dataSource", size: 100 } },
      },
    },
  });
  requestBody.query = typeof window.buildDataSourceFacetQuery === "function"
    ? window.buildDataSourceFacetQuery()
    : queryWithoutFacetField(requestData.query, "dataSource");

  activeDataSourceFacetRequest = $.ajax({
    url: facetApiUrl,
    method: "POST",
    contentType: "application/json",
    data: JSON.stringify(requestBody),
    dataType: "json",
    success(response) {
      if (requestId !== dataSourceFacetRequestId) return;
      activeDataSourceFacetRequest = null;
      const datasourceAggregation = response?.aggregations?.datasource_0;
      const allDatasourceAggregation = response?.aggregations?.all_datasource_0?.datasource_0;
      if (datasourceAggregation && typeof window.renderDataSourceFacetAggregation === 'function') {
        window.renderDataSourceFacetAggregation(datasourceAggregation, allDatasourceAggregation);
        return;
      }
      console.error("Unexpected datasource facet response", response);
    },
    error(error) {
      if (error?.statusText === "abort") return;
      if (requestId !== dataSourceFacetRequestId) return;
      activeDataSourceFacetRequest = null;
      console.error("Error fetching datasource facet data:", error);
    }
  });

  return activeDataSourceFacetRequest;
}

function renderResults(results) {
  var table = $("#resultsTable"); table.find("thead").remove();
  var tableBody = $("#resultsTable tbody"); tableBody.empty();
  var thead = `<thead>
    <tr>
      <th>View Details</th><th>Datasource</th><th>Scientific Name</th><th>Year</th><th>Day of Year</th>
      <th>Family</th><th>Genus</th><th>Trait</th><th>Verbatim Trait</th><th>Source Record</th>
    </tr></thead>`;
  table.prepend(thead);

  results.forEach(function (doc) {
    const source = doc._source || {};
    const $row = $("<tr>");
    const $detailsCell = $('<td class="view-details">');
    const $detailsIcon = $('<i class="fa fa-search view-icon" style="cursor: pointer;" title="View Details"></i>');
    $detailsIcon.data("source", source);
    $detailsIcon.data("docId", doc._id || source.annotationID || "");
    $detailsCell.append($detailsIcon);
    $row.append($detailsCell);

    [
      source.dataSource,
      source.scientificName,
      source.year,
      source.dayOfYear,
      source.standardizedFamily || source.verbatimFamily || source.family,
      source.genus,
      source.trait,
      source.verbatimTrait,
    ].forEach((value) => {
      $("<td>").text(value || "").appendTo($row);
    });

    const $sourceCell = $("<td>");
    const metadataUrl = observationMetadataUrlFromSource(source);
    if (metadataUrl) {
      $("<a>")
        .attr({ href: metadataUrl, target: "_blank", rel: "noopener noreferrer" })
        .text("URL")
        .appendTo($sourceCell);
    } else {
      $sourceCell.text("URL Unavailable");
    }
    $row.append($sourceCell);
    tableBody.append($row);
  });

  $(".view-icon").click(function () {
    showDetailsModal($(this).data("source"), $(this).data("docId"));
  });
}

function renderPagination(totalResults) {
  const el = document.getElementById('pagination'); el.innerHTML = '';
  const totalPages = Math.ceil(totalResults / pageSize);
  if (currentPage > 1) {
    const prev = document.createElement('button'); prev.className='pagination-button'; prev.textContent='Previous';
    prev.onclick = () => { currentPage--; fetchResults(); }; el.appendChild(prev);
  }
  if (currentPage < totalPages) {
    const next = document.createElement('button'); next.className='pagination-button'; next.textContent='Next';
    next.onclick = () => { currentPage++; fetchResults(); }; el.appendChild(next);
  }
}

window.fetchFacetData = fetchFacetData;
window.setResultsHeadingText = setResultsHeadingText;

// Modal
function observationMetadataUrlFromSource(sourceData) {
  const urlFromDoc = String(sourceData?.sourceRecordUrl || sourceData?.observedMetadataUrl || '').trim();
  if (urlFromDoc) return urlFromDoc;
  const rawId = sourceData?.annotationID;
  const npnId = (typeof rawId === 'string' && rawId.startsWith('npn:')) ? rawId.slice(4) : null;
  if (npnId) {
    return `https://services.usanpn.org/npn_portal/observations/getObservationById.json?request_src=PPO&observation_id=${encodeURIComponent(npnId)}&pretty=1`;
  }
  return '';
}
function fetchRecordDetailsById(docId) {
  if (!docId) return $.Deferred().reject().promise();
  const requestBody = {
    query: { ids: { values: [String(docId)] } },
    size: 1,
  };
  return $.ajax({
    url: `${apiUrl.split('?')[0]}?size=1&from=0`,
    method: "POST",
    contentType: "application/json",
    data: JSON.stringify(requestBody),
    dataType: "json",
  }).then((response) => response?.hits?.hits?.[0]?._source || null);
}
function renderDetailsModalContent(sourceData, isPartial) {
  var modal = $("#detailsModal"); var modalBody = $("#modalBody"); modalBody.empty();
  var content = $(`<div style="display:flex; flex-wrap:wrap; gap:20px;"><div style="flex:1;"></div></div>`);
  modalBody.append(content);
  if (isPartial) {
    content.find('div:last-child').append($("<p>").addClass("text-muted").text("Showing table fields while full record details load..."));
  }
  Object.entries(sourceData || {}).forEach(([k,v]) => {
    if (k === 'observedImageUrl' || k === 'observedImageGuid') {
      const imageUrl = String(sourceData.observedImageUrl || '').trim();
      const $p = $("<p>");
      $("<strong>").text(`${k}:`).appendTo($p);
      $p.append(" ");
      if (imageUrl) {
        $("<a>").attr({ href: imageUrl, target: "_blank", rel: "noopener noreferrer" }).text(v).appendTo($p);
      } else {
        $p.append(document.createTextNode(String(v || "")));
      }
      content.find('div:last-child').append($p);
    } else if (k === 'dataset_id') {
	  // do nothing
	} else {
      const $p = $("<p>");
      $("<strong>").text(`${k}:`).appendTo($p);
      $p.append(" ");
      $p.append(document.createTextNode(String(v ?? "")));
      content.find('div:last-child').append($p);
    }
  });
  modal.css("display", "flex");
}
function showDetailsModal(sourceData, docId) {
  const requestId = ++detailsModalRequestId;
  renderDetailsModalContent(sourceData, !!docId);
  if (!docId) return;
  fetchRecordDetailsById(docId)
    .then((fullSourceData) => {
      if (requestId !== detailsModalRequestId || $("#detailsModal").css("display") === "none") return;
      if (fullSourceData) renderDetailsModalContent(fullSourceData, false);
    })
    .catch((error) => {
      console.warn("Failed to load full record details:", error);
    });
}
$("#closeModal").click(function () { detailsModalRequestId += 1; $("#detailsModal").hide(); });

// Query builder with AND/OR per field.
// (Option-B trait OR groups will append their own OR block after this runs.)
function updateQueryWithSelectedFacets() {
  requestData.query = { bool: { must: [] } };

  // For each field: if mode=OR, push a single should[] block; if AND, push each term as a separate must item
  Object.entries(selectedFacets).forEach(([field, values]) => {
    if (!values || !values.length) return;
    const mode = getFacetMode(field);
    if (mode === 'OR') {
      requestData.query.bool.must.push({
        bool: {
          should: values.map(v => ({ term: { [field]: v } })),
          minimum_should_match: 1
        }
      });
    } else {
      values.forEach((value) => requestData.query.bool.must.push({ term: { [field]: value } }));
    }
  });

  if (scientificNameFilter) requestData.query.bool.must.push(scientificNameFilter);
  if (!requestData.query.bool.must.length) requestData.query = { match_all: {} };

  updateDownloadLink();
}

// UI hooks
$(document).ready(function () {
  if (typeof window.initializePortalFiltersFromUrl === 'function') {
    window.initializePortalFiltersFromUrl();
  }
  if (typeof window.updateQueryWithSelectedFacets === 'function') {
    window.updateQueryWithSelectedFacets();
  }
  if (typeof window.captureAppliedFilterState === 'function') {
    window.captureAppliedFilterState();
  }
  setActiveMainTab('table');
  fetchFacetData();
  computeDynamicPageSize();
  fetchResults();

  $("#downloadButton").click(function (event) { updateDownloadLink(); if (!downloadLink) { event.preventDefault(); } });
  $("#scientificNameSearch")
    .on("input", handleTaxonInput)
    .on("keydown", handleTaxonKeydown);
  $("#clearTaxonSearch").on("click", function () {
    const hadTaxonFilter = !!scientificNameFilter;
    clearTaxonFilter();
    if (hadTaxonFilter && typeof window.markFiltersPending === 'function') {
      window.markFiltersPending({ delayMs: 0 });
    }
  });
  $("#taxonSuggestions").on("mousedown", ".taxon-suggestion", function (event) {
    event.preventDefault();
    selectTaxonSuggestion(Number($(this).data("index")));
  });
  $(document).on("mousedown.taxonSuggestions", function (event) {
    if ($(event.target).closest(".taxon-search-container").length) return;
    hideTaxonSuggestions();
  });

  $("#showTable").click(function () {
    if (typeof window.cancelBoundingBoxSelection === 'function') {
      window.cancelBoundingBoxSelection(false);
    }
    if (typeof window.cancelMapDataLoading === 'function') {
      window.cancelMapDataLoading();
    }
    setActiveMainTab('table');
    if (typeof window.hasPendingFilterChanges === 'function' && window.hasPendingFilterChanges()) {
      if (typeof window.flushPendingFilters === 'function') {
        window.flushPendingFilters();
      }
      return;
    }
    if (window.lastResultsLoadedSignature === getCurrentQuerySignature()) {
      return;
    }
    computeDynamicPageSize();
    fetchResults();
  });
  $("#showMap").click(function () {
    setActiveMainTab('map');
    setResultsHeadingText('Loading map...');
    ensurePhenobaseMapLoaded()
      .then(() => {
        window.setTimeout(() => {
          const loadedMap = window.phenobaseLeafletMap;
          if (loadedMap && typeof loadedMap.invalidateSize === 'function') {
            loadedMap.invalidateSize();
          }
          if (typeof window.markMapNeedsRender === 'function') {
            window.markMapNeedsRender();
          }
          setResultsHeadingText('Map results update on demand');
        }, 100);
      })
      .catch((error) => {
        console.error("Failed to load map assets:", error);
        setResultsHeadingText('Map failed to load');
      });
  });
  $("#showStats").click(function () {
    if (typeof window.cancelBoundingBoxSelection === 'function') {
      window.cancelBoundingBoxSelection(false);
    }
    if (typeof window.cancelMapDataLoading === 'function') {
      window.cancelMapDataLoading();
    }
    setActiveMainTab('stats');
    if (typeof window.hasPendingFilterChanges === 'function' && window.hasPendingFilterChanges()) {
      if (typeof window.flushPendingFilters === 'function') {
        window.flushPendingFilters();
      }
      loadStatsForCurrentFilters();
      return;
    }
    if (typeof window.hasRenderedStats === 'function' && window.hasRenderedStats()) {
      if (typeof window.syncStatsStatusVisibility === 'function') {
        window.syncStatsStatusVisibility();
      }
      return;
    }
    loadStatsForCurrentFilters();
  });

  // Recompute on window resize (debounced) when table visible
  let __resizeTimer = null;
  window.addEventListener('resize', () => {
    if (!$('#tableContainer').is(':visible')) return;
    clearTimeout(__resizeTimer);
    __resizeTimer = setTimeout(() => {
      const prev = pageSize;
      computeDynamicPageSize();
      if (pageSize !== prev) fetchResults();
    }, 150);
  });
});
