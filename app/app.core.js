// Pagination & URLs
let currentPage = 1;
// make pageSize mutable so we can auto-size it
let pageSize = 15;

var apiUrl = `https://biscicol.org/phenobase/api/v1/query//phenobase2/_search?size=${pageSize}&from=0`;
var queryStringRootURL = "https://biscicol.org/phenobase/api/v1/download/_search?q=";
var downloadLink = "";

// Hidden mapped trait
const HIDDEN_TRAIT = 'plant structure present';
function isHiddenTrait(v) { return String(v || '').trim().toLowerCase() === HIDDEN_TRAIT; }

// ES request payload
var requestData = {
  aggs: {
    datasource_0: { terms: { field: "dataSource", size: 10 } },
    mappedTraits_1: { terms: { field: "mappedTraits", size: 500 } },
    family_2: { terms: { field: "family", size: 50 } },
    genus_3: { terms: { field: "genus", size: 50 } }
  },
  query: { bool: { must: [] } }
};

var selectedFacets = {};
var scientificNameFilter = null;

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
function convertJsonToLucene(jsonQuery) {
  let conditions = [];
  if (jsonQuery.bool && Array.isArray(jsonQuery.bool.must)) {
    jsonQuery.bool.must.forEach((condition) => {
      if (condition.term) {
        for (const [field, value] of Object.entries(condition.term)) {
          conditions.push(`${field}:"${value}"`);
        }
      } else if (condition.match) {
        for (const [field, value] of Object.entries(condition.match)) {
          conditions.push(`${field}:"${value}"`);
        }
      } else if (condition.bool && Array.isArray(condition.bool.should)) {
        const orParts = condition.bool.should.map(s => {
          if (s.term) { const [field, value] = Object.entries(s.term)[0]; return `${field}:"${value}"`; }
          return '';
        }).filter(Boolean);
        if (orParts.length) conditions.push(`(${orParts.join(' OR ')})`);
      }
    });
  }
  return conditions.join(' AND ');
}
function showLoader(){ $("#loader").css("display","flex"); $(".facet-link").css("pointer-events","none"); }
function hideLoader(){ $("#loader").css("display","none"); $(".facet-link").css("pointer-events","auto"); }
function updateResultsHeading(showingResults, totalResults) {
  document.getElementById('resultsHeading').textContent =
    `Showing ${showingResults} of ${totalResults.toLocaleString()} total possible results`;
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
function handleScientificNameSearch() {
  var scientificName = $("#scientificNameSearch").val().trim();
  scientificName ? (scientificNameFilter = { match: { scientificName } }) : (scientificNameFilter = null);
  updateQueryWithSelectedFacets(); fetchResults();
}

// Fetch & render
function fetchResults() {
  showLoader();

  // NEW: adjust page size to fill the screen when the table is visible
  if ($('#tableContainer').is(':visible')) {
    computeDynamicPageSize();
  }

  const offset = (currentPage - 1) * pageSize;
  const apiWithPagination = `${apiUrl.split('?')[0]}?size=${pageSize}&from=${offset}`;
  $.ajax({
    url: apiWithPagination, method: "POST", contentType: "application/json",
    data: JSON.stringify(requestData), dataType: "json",
    success: function (response) {
      hideLoader();
      if (response?.hits?.hits) {
        const results = response.hits.hits;
        const totalResults = calculateTotalFromFacets(response.aggregations);
        const startResult = offset + 1;
        const endResult   = Math.min(offset + results.length, totalResults);
        renderResults(results);
        renderFacets(response.aggregations);
        renderSelectedFacets();
        updateDownloadLink();
        renderPagination(totalResults);
        renderMapMarkers(results);
        updateResultsHeading(`${startResult} - ${endResult}`, totalResults);
      } else { console.error("Unexpected response", response); alert("Unexpected response structure."); }
    },
    error: function (error) { hideLoader(); console.error("Error fetching data:", error); }
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

// Modal
function showDetailsModal(sourceData) {
  var modal = $("#detailsModal"); var modalBody = $("#modalBody"); modalBody.empty();
  var content = $(`<div style="display:flex; flex-wrap:wrap; gap:20px;"><div style="flex:1;"></div></div>`);
  modalBody.append(content);
  Object.entries(sourceData || {}).forEach(([k,v]) => {
    if (k === 'observedImageUrl' || k === 'observedImageGuid') {
      content.find('div:last-child').append(`<p><strong>${k}:</strong> <a href="${sourceData.observedImageUrl}" target="_blank">${v}</a></p>`);
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
  // Initial: if table is visible on load, compute dynamic size first
  if ($('#tableContainer').is(':visible')) {
    // wait a tick for layout to settle
    setTimeout(() => { computeDynamicPageSize(); fetchResults(); }, 0);
  } else {
    fetchResults();
  }

  $("#downloadButton").click(function () { updateDownloadLink(); if (!downloadLink) { event.preventDefault(); } });
  $("#searchButton").click(function () { handleScientificNameSearch(); });

  $("#showTable").click(function () {
    $("#tableContainer").show(); $("#mapContainer").hide(); $("#statsContainer").hide();
    computeDynamicPageSize();
    fetchResults();
  });
  $("#showMap").click(function () {
    $("#mapContainer").show(); $("#tableContainer").hide(); $("#statsContainer").hide();
    setTimeout(() => { map.invalidateSize(); }, 100);
  });
  $("#showStats").click(function () {
    $("#statsContainer").show(); $("#mapContainer").hide(); $("#tableContainer").hide();
    fetchStatsData();
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

