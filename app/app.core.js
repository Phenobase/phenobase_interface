// Pagination & URLs
let currentPage = 1;
// make pageSize mutable so we can auto-size it
let pageSize = 15;

var apiUrl = `https://biscicol.org/phenobase/api/v1/query//phenobase2/_search?size=${pageSize}&from=0`;
var queryStringRootURL = "https://biscicol.org/phenobase/api/v1/download/_search?q=";
var downloadLink = "";
const defaultTimeConfig = window.phenobaseTimeConfig || {};
const DEFAULT_MIN_YEAR = Number.isFinite(Number(defaultTimeConfig.minYear)) ? Math.round(Number(defaultTimeConfig.minYear)) : 1800;
const DEFAULT_MAX_YEAR = Number.isFinite(Number(defaultTimeConfig.maxYear)) ? Math.round(Number(defaultTimeConfig.maxYear)) : new Date().getFullYear();
const DEFAULT_MIN_DECADE = Math.floor(DEFAULT_MIN_YEAR / 10) * 10;
const DEFAULT_MAX_DECADE = Math.floor(DEFAULT_MAX_YEAR / 10) * 10;

// Hidden mapped trait
const HIDDEN_TRAIT = 'plant structure present';
function isHiddenTrait(v) { return String(v || '').trim().toLowerCase() === HIDDEN_TRAIT; }

// ES request payload
var requestData = {
  aggs: {
    datasource_0: { terms: { field: "dataSource", size: 100 } },
    mappedTraits_1: { terms: { field: "mappedTraits", size: 2000 } },
    family_2: { terms: { field: "family", size: 50 } },
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
window.scientificNameSearchText = scientificNameSearchText;

// NEW: Field-level AND/OR modes
const facetModes = {
  dataSource: 'AND',
  family: 'AND',
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
function calculateTotalFromFacets(aggregations) {
  let total = 0;
  if (aggregations.datasource_0?.buckets) {
    total = aggregations.datasource_0.buckets.reduce((s,b)=>s+b.doc_count,0);
  }
  return total;
}
function updateDownloadLink() {
  const luceneQuery = convertJsonToLucene(requestData.query);
  downloadLink = `${queryStringRootURL}${encodeURIComponent(luceneQuery)}&limit=100000`;
  $("#downloadButton").attr("href", downloadLink).attr("download", "phenobase_data.json").prop("disabled", false);
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
function buildScientificSearchFilter(searchTerm) {
  return {
    bool: {
      should: [
        { match: { scientificName: searchTerm } },
        { match: { genus: searchTerm } },
        { match: { family: searchTerm } },
      ],
      minimum_should_match: 1,
    },
  };
}
function syncScientificNameDraftFromInput() {
  const scientificName = $("#scientificNameSearch").val().trim();
  scientificNameSearchText = scientificName;
  window.scientificNameSearchText = scientificNameSearchText;
  scientificNameFilter = scientificName ? buildScientificSearchFilter(scientificName) : null;
  window.scientificNameFilter = scientificNameFilter;
}

// Fetch & render
function fetchResults() {
  showLoader('Submitting query...', 14);

  // NEW: adjust page size to fill the screen when the table is visible
  if ($('#tableContainer').is(':visible')) {
    computeDynamicPageSize();
  }

  const offset = (currentPage - 1) * pageSize;
  const apiWithPagination = `${apiUrl.split('?')[0]}?size=${pageSize}&from=${offset}`;
  $.ajax({
    url: apiWithPagination, method: "POST", contentType: "application/json",
    beforeSend: function () {
      setLoaderStage('Waiting for records...', 26);
    },
    data: JSON.stringify(requestData), dataType: "json",
    success: function (response) {
      setLoaderStage('Rendering results...', 96);
      if (response?.hits?.hits) {
        const results = response.hits.hits;
        const totalResults = calculateTotalFromFacets(response.aggregations);
        const startResult = offset + 1;
        const endResult   = Math.min(offset + results.length, totalResults);
        window.lastResultsLoadedSignature = getCurrentQuerySignature();
        renderResults(results);
        renderFacets(response.aggregations);
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
    error: function (error) { hideLoader(); console.error("Error fetching data:", error); }
  });
}

function fetchFacetData(options = {}) {
  const onSuccess = typeof options.onSuccess === 'function' ? options.onSuccess : null;
  const onError = typeof options.onError === 'function' ? options.onError : null;
  const facetApiUrl = `${apiUrl.split('?')[0]}?size=0&from=0`;
  const requestBody = {
    ...requestData,
    size: 0,
    from: 0,
  };

  return $.ajax({
    url: facetApiUrl,
    method: "POST",
    contentType: "application/json",
    data: JSON.stringify(requestBody),
    dataType: "json",
    success(response) {
      if (response?.aggregations) {
        renderFacets(response.aggregations);
        if (typeof onSuccess === 'function') onSuccess(response);
        return;
      }
      console.error("Unexpected facet response", response);
      if (typeof onError === 'function') onError(response);
    },
    error(error) {
      console.error("Error fetching facet data:", error);
      if (typeof onError === 'function') onError(error);
    }
  });
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
    var row = `<tr data-source='${JSON.stringify(doc._source)}'>
      <td class="view-details">
        <i class="fa fa-search view-icon" style="cursor: pointer;" title="View Details" data-source='${JSON.stringify(doc._source)}'></i>
      </td>
      <td>${doc._source.dataSource || ''}</td>
      <td>${doc._source.scientificName || ''}</td>
      <td>${doc._source.year || ''}</td>
      <td>${doc._source.dayOfYear || ''}</td>
      <td>${doc._source.family || ''}</td>
      <td>${doc._source.genus || ''}</td>
      <td>${doc._source.trait || ''}</td>
      <td>${doc._source.verbatimTrait || ''}</td>
      <td>${
        (() => {
          const urlFromDoc = String(doc._source?.observedMetadataUrl || '').trim();
          if (urlFromDoc) return `<a href="${urlFromDoc}" target="_blank" rel="noopener noreferrer">Observation Metadata</a>`;
          const rawId = doc._source?.annotationID;
          const npnId = (typeof rawId === 'string' && rawId.startsWith('npn:')) ? rawId.slice(4) : null;
          if (npnId) {
            const npnUrl = `https://services.usanpn.org/npn_portal/observations/getObservationById.json?request_src=PPO&observation_id=${encodeURIComponent(npnId)}&pretty=1`;
            return `<a href="${npnUrl}" target="_blank" rel="noopener noreferrer">Observation Metadata</a>`;
          }
          return 'Observation Metadata Unavailable';
        })()
      }</td></tr>`;
    tableBody.append(row);
  });

  $(".view-icon").click(function () { showDetailsModal($(this).data("source")); });
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
function showDetailsModal(sourceData) {
  var modal = $("#detailsModal"); var modalBody = $("#modalBody"); modalBody.empty();
  var content = $(`<div style="display:flex; flex-wrap:wrap; gap:20px;"><div style="flex:1;"></div></div>`);
  modalBody.append(content);
  Object.entries(sourceData || {}).forEach(([k,v]) => {
    if (k === 'observedImageUrl' || k === 'observedImageGuid') {
      content.find('div:last-child').append(`<p><strong>${k}:</strong> <a href="${sourceData.observedImageUrl}" target="_blank">${v}</a></p>`);
    } else if (k === 'dataset_id') {
	  // do nothing
	} else { content.find('div:last-child').append(`<p><strong>${k}:</strong> ${v}</p>`); }
  });
  modal.css("display", "flex");
}
$("#closeModal").click(function () { $("#detailsModal").hide(); });

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
  setActiveMainTab('stats');
  fetchFacetData();
  if (typeof window.showInitialStatsView === 'function') {
    window.showInitialStatsView();
  } else if (typeof window.fetchStatsData === 'function') {
    window.fetchStatsData();
  }

  $("#downloadButton").click(function () { updateDownloadLink(); if (!downloadLink) { event.preventDefault(); } });
  $("#scientificNameSearch").on("input", function () {
    syncScientificNameDraftFromInput();
    if (typeof window.markFiltersPending === 'function') {
      window.markFiltersPending();
    }
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
    setTimeout(() => {
      map.invalidateSize();
      if (typeof window.markMapNeedsRender === 'function') {
        window.markMapNeedsRender();
      }
    }, 100);
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
      if (typeof window.syncStatsStatusVisibility === 'function') {
        window.syncStatsStatusVisibility();
      }
      return;
    }
    if (typeof window.hasRenderedStats === 'function' && window.hasRenderedStats()) {
      if (typeof window.syncStatsStatusVisibility === 'function') {
        window.syncStatsStatusVisibility();
      }
      return;
    }
    if (typeof window.showInitialStatsView === 'function') {
      window.showInitialStatsView();
    } else if (typeof window.fetchStatsData === 'function') {
      window.fetchStatsData();
    }
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
