/* app.facets.js — plain ES facets + top selected bar (chips + Clear all)
   - Self-contained: defines addFacet/removeFacet/updateQueryWithSelectedFacets
   - Uses your existing globals if present (requestData, fetchResults, etc.)
   - Hides "plant structure present" in mappedTraits
*/

(function () {
  // -----------------------
  // Shared / globals
  // -----------------------
  const HIDDEN_TRAIT = 'plant structure present';

  // Ensure a shared selections object on window
  window.selectedFacets = window.selectedFacets || {};
  let selectedFacets = window.selectedFacets;

  // Helper: ensure requestData exists (don’t overwrite if app already set it)
  function getRequestData() {
    if (window.requestData && typeof window.requestData === 'object') {
      return window.requestData;
    }
    // Minimal fallback requestData (aggs will be filled by your server anyway)
    window.requestData = {
      query: { bool: { must: [] } },
    };
    return window.requestData;
  }

  // Small utilities
  function isHiddenTrait(s) { return String(s || '').trim().toLowerCase() === HIDDEN_TRAIT; }
  function toArray(x) { return Array.isArray(x) ? x : (x != null ? [x] : []); }

  // Display names for facet chips
  const FIELD_LABELS = {
    dataSource: 'DataSource',
    mappedTraits: 'Trait',
    family: 'Family',
    genus: 'Genus',
  };

  // -----------------------
  // Core facet actions
  // -----------------------
  function updateQueryWithSelectedFacets() {
    const rd = getRequestData();

    // Rebuild must array
    const must = [];

    // Add selected facet terms
    Object.entries(selectedFacets).forEach(([field, values]) => {
      toArray(values).forEach((val) => {
        if (val != null && val !== '') {
          must.push({ term: { [field]: val } });
        }
      });
    });

    // Also include scientificNameFilter if your app set it
    if (window.scientificNameFilter) {
      must.push(window.scientificNameFilter);
    }

    // If nothing selected, use match_all
    if (must.length === 0) {
      rd.query = { match_all: {} };
    } else {
      rd.query = { bool: { must } };
    }

    // Keep requestData reference
    window.requestData = rd;

    // If your app exposes this, keep the download link in sync
    if (typeof window.updateDownloadLink === 'function') {
      window.updateDownloadLink();
    }
  }

  function addFacet(field, value) {
    if (!field) return;
    selectedFacets[field] = selectedFacets[field] || [];
    if (!selectedFacets[field].includes(value)) {
      selectedFacets[field].push(value);
    }
    // Reset paging if present
    if (typeof window.currentPage !== 'undefined') window.currentPage = 1;

    updateQueryWithSelectedFacets();

    // Trigger fetch if available
    if (typeof window.fetchResults === 'function') {
      window.fetchResults();
    } else {
      console.warn('[facets] fetchResults() not found on window; facet state updated only.');
    }
  }

  function removeFacet(field, value) {
    if (!selectedFacets[field]) return;
    selectedFacets[field] = selectedFacets[field].filter((v) => v !== value);
    if (selectedFacets[field].length === 0) delete selectedFacets[field];

    if (typeof window.currentPage !== 'undefined') window.currentPage = 1;

    updateQueryWithSelectedFacets();

    if (typeof window.fetchResults === 'function') {
      window.fetchResults();
    } else {
      console.warn('[facets] fetchResults() not found on window; facet state updated only.');
    }
  }

  // Expose in case other files want to call them
  window.addFacet = addFacet;
  window.removeFacet = removeFacet;
  window.updateQueryWithSelectedFacets = updateQueryWithSelectedFacets;

  // -----------------------
  // Selected bar (chips)
  // -----------------------
  function renderSelectedFacets() {
    const $wrap = $("#selectedFacets");
    $wrap.empty();

    // Chips
    const entries = Object.entries(selectedFacets || {});
    if (entries.length === 0) {
      $wrap.append(`<div class="text-muted">No filters selected.</div>`);
      return;
    }

    const $chips = $('<div/>');
    entries.forEach(([field, values = []]) => {
      const label = FIELD_LABELS[field] || field;
      values.forEach((val) => {
        const $chip = $(`
          <span class="selected-facet" data-field="${field}" data-value="${val}">
            <strong>${label}:</strong> ${val}
            <span class="remove-facet" title="Remove" aria-label="Remove filter">×</span>
          </span>
        `);
        $chips.append($chip);
      });
    });
    $wrap.append($chips);

    // Clear all button
    const $clear = $(
      `<button class="btn btn-default" id="clearAllFacetsBtn" style="margin-top:8px;">Clear all</button>`
    );
    $wrap.append($clear);

    // Events
    $wrap.off('click', '.remove-facet').on('click', '.remove-facet', function (e) {
      e.preventDefault();
      e.stopPropagation();
      const $p = $(this).closest('.selected-facet');
      const field = $p.data('field');
      const value = $p.data('value');
      removeFacet(field, value);
    });

    $wrap.off('click', '#clearAllFacetsBtn').on('click', '#clearAllFacetsBtn', function () {
      // Reset selections and search
      window.selectedFacets = {};
      selectedFacets = window.selectedFacets;
      if (typeof window.scientificNameFilter !== 'undefined') window.scientificNameFilter = null;
      if (typeof window.currentPage !== 'undefined') window.currentPage = 1;

      updateQueryWithSelectedFacets();

      if (typeof window.fetchResults === 'function') {
        window.fetchResults();
      }
    });
  }
  window.renderSelectedFacets = renderSelectedFacets;

  // -----------------------
  // Facet list rendering
  // -----------------------
  function renderFacetLinks(aggregation, container, field) {
    const $c = $(container);
    $c.empty();
    if (!(aggregation && aggregation.buckets)) return;

    aggregation.buckets.forEach((bucket) => {
      const key = bucket.key;
      if (field === 'mappedTraits' && isHiddenTrait(key)) return; // hide noisy top trait

      const isSelected = selectedFacets[field] && selectedFacets[field].includes(key);
      const countFormatted = (bucket.doc_count || 0).toLocaleString();

      $c.append(`
        <div class="facet-link-container">
          <a class="facet-link ${isSelected ? 'selected' : ''}" href="#" data-field="${field}" data-value="${key}">
            <span class="text">${key}</span>
            <span class="count">(${countFormatted})</span>
            ${isSelected ? `<span class="remove-facet" data-field="${field}" data-value="${key}" title="Remove">×</span>` : ''}
          </a>
        </div>
      `);
    });

    // Select
    $c.find(".facet-link").off("click").on("click", function (e) {
      e.preventDefault();
      const field = $(this).data("field");
      const value = $(this).data("value");
      if (!$(this).hasClass("selected")) {
        addFacet(field, value);
      }
    });

    // Remove (inline X)
    $c.off("click", ".remove-facet").on("click", ".remove-facet", function (e) {
      e.preventDefault();
      e.stopPropagation();
      const field = $(this).data("field");
      const value = $(this).data("value");
      removeFacet(field, value);
    });
  }

  // -----------------------
  // Main entry (called from your fetchResults success)
  // -----------------------
  function renderFacets(aggregations) {
    $("#dataSourceFacets").empty();
    $("#traitFacets").empty();
    $("#familyFacets").empty();
    $("#genusFacets").empty();

    renderFacetLinks(aggregations.datasource_0, "#dataSourceFacets", "dataSource");

    const traitAgg = { buckets: (aggregations?.mappedTraits_1?.buckets || []) };
    renderFacetLinks(traitAgg, "#traitFacets", "mappedTraits"); // plain traits, no hierarchy

    renderFacetLinks(aggregations.family_2, "#familyFacets", "family");
    renderFacetLinks(aggregations.genus_3, "#genusFacets", "genus");

    // Top bar chips
    renderSelectedFacets();
  }

  // Expose main entry
  window.renderFacets = renderFacets;
})();

