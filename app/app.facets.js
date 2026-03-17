/* app.facets.js — facet rendering + portal filter controls
   - Keeps backend API route and payload style unchanged (ES query body via existing proxy)
   - Adds UI-driven filters: year range slider, presence mode, phenophase categories, all-traits mode, geo bounds
*/

(function () {
  // -----------------------
  // Shared / globals
  // -----------------------
  const HIDDEN_TRAIT = 'plant structure present';
  const MIN_YEAR = 1800;
  const CURRENT_YEAR = new Date().getFullYear();
  const PRESENT_ONLY_SOURCE_MATCHERS = [/\binaturalist\b/i, /\bherbarium-?gbif\b/i, /\bgbif\b/i, /\binat\b/i];

  const PHENOPHASE_CATEGORIES = [
    {
      key: 'leaf',
      label: 'Leaf',
      phases: [
        { key: 'unfolded true leaf', label: 'unfolded true leaf' },
        { key: 'breaking vegetative bud', label: 'breaking vegetative bud' },
        { key: 'senescing true leaf', label: 'senescing true leaf' },
      ],
    },
    {
      key: 'flower',
      label: 'Flower',
      phases: [
        { key: 'flower', label: 'flower' },
        { key: 'open flower', label: 'open flower' },
      ],
    },
    {
      key: 'fruit',
      label: 'Fruit',
      phases: [
        { key: 'simple fruit or compound fruit', label: 'simple fruit or compound fruit' },
        { key: 'ripe fruit', label: 'ripe fruit' },
      ],
    },
  ];

  window.selectedFacets = window.selectedFacets || {};
  let selectedFacets = window.selectedFacets;

  window.portalFilters = window.portalFilters || {
    presenceMode: 'both',
    minYear: MIN_YEAR,
    maxYear: CURRENT_YEAR,
    selectedPhenophases: [],
    geoBounds: null,
    traitMode: 'simple',
  };
  const portalFilters = window.portalFilters;

  // Backward-compatible migration from old state fields.
  if (!Number.isInteger(portalFilters.minYear)) {
    const migratedStart = Number(String(portalFilters.dateStart || '').slice(0, 4));
    portalFilters.minYear = Number.isInteger(migratedStart) ? migratedStart : MIN_YEAR;
  }
  if (!Number.isInteger(portalFilters.maxYear)) {
    const migratedEnd = Number(String(portalFilters.dateEnd || '').slice(0, 4));
    portalFilters.maxYear = Number.isInteger(migratedEnd) ? migratedEnd : CURRENT_YEAR;
  }
  if (!portalFilters.traitMode) {
    portalFilters.traitMode = portalFilters.advancedTraitsVisible ? 'all' : 'simple';
  }
  delete portalFilters.dateStart;
  delete portalFilters.dateEnd;
  delete portalFilters.advancedTraitsVisible;

  const availableTraitCountsLC = new Map();
  const FACET_PREVIEW_LIMITS = { family: 5, genus: 5 };
  const facetExpandedState = { family: false, genus: false };
  let initializedCustomControls = false;
  let yearSliderInitialized = false;
  let presenceModeLocked = false;
  let lastUnlockedPresenceMode = portalFilters.presenceMode || 'both';
  let traitModeWarningTimer = null;

  // -----------------------
  // Helpers
  // -----------------------
  function getRequestData() {
    if (window.requestData && typeof window.requestData === 'object') return window.requestData;
    window.requestData = { query: { bool: { must: [] } } };
    return window.requestData;
  }

  function isHiddenTrait(s) {
    return String(s || '').trim().toLowerCase() === HIDDEN_TRAIT;
  }

  function toArray(x) {
    return Array.isArray(x) ? x : (x != null ? [x] : []);
  }

  function normalizeLower(v) {
    return String(v || '').trim().toLowerCase();
  }

  function resetPaging() {
    if (typeof window.currentPage !== 'undefined') window.currentPage = 1;
  }

  function runSearchForFilterChange() {
    resetPaging();
    updateQueryWithSelectedFacets();
    if (typeof window.fetchResults === 'function') {
      window.fetchResults();
    }
  }

  function clampYear(value, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(MIN_YEAR, Math.min(CURRENT_YEAR, Math.round(n)));
  }

  function getYearRangeFromState() {
    let minYear = clampYear(portalFilters.minYear, MIN_YEAR);
    let maxYear = clampYear(portalFilters.maxYear, CURRENT_YEAR);
    if (minYear > maxYear) [minYear, maxYear] = [maxYear, minYear];
    portalFilters.minYear = minYear;
    portalFilters.maxYear = maxYear;
    return { minYear, maxYear };
  }

  function isFullYearRange() {
    const r = getYearRangeFromState();
    return r.minYear <= MIN_YEAR && r.maxYear >= CURRENT_YEAR;
  }

  function updateYearRangeDisplay() {
    const el = document.getElementById('yearRangeDisplay');
    if (!el) return;
    const r = getYearRangeFromState();
    const suffix = isFullYearRange() ? ' (all years)' : '';
    el.textContent = `${r.minYear} - ${r.maxYear}${suffix}`;
  }

  function presentOnlySource(sourceName) {
    return PRESENT_ONLY_SOURCE_MATCHERS.some((re) => re.test(String(sourceName || '')));
  }

  function normalizeGeoBounds(bounds) {
    if (!bounds) return null;

    function roundCoord(v) {
      return Math.round(Number(v) * 10000) / 10000;
    }

    function formatCoord(v) {
      return Number(v).toFixed(4);
    }

    let minLat = Number(bounds.minLat);
    let maxLat = Number(bounds.maxLat);
    let minLon = Number(bounds.minLon);
    let maxLon = Number(bounds.maxLon);

    if (![minLat, maxLat, minLon, maxLon].every(Number.isFinite)) return null;

    minLat = Math.max(-90, Math.min(90, minLat));
    maxLat = Math.max(-90, Math.min(90, maxLat));
    minLon = Math.max(-180, Math.min(180, minLon));
    maxLon = Math.max(-180, Math.min(180, maxLon));

    if (minLat > maxLat) [minLat, maxLat] = [maxLat, minLat];
    if (minLon > maxLon) [minLon, maxLon] = [maxLon, minLon];

    minLat = roundCoord(minLat);
    maxLat = roundCoord(maxLat);
    minLon = roundCoord(minLon);
    maxLon = roundCoord(maxLon);

    return {
      minLat,
      maxLat,
      minLon,
      maxLon,
      minLatText: formatCoord(minLat),
      maxLatText: formatCoord(maxLat),
      minLonText: formatCoord(minLon),
      maxLonText: formatCoord(maxLon),
    };
  }

  function selectedPhenophasesSet() {
    return new Set((portalFilters.selectedPhenophases || []).map((p) => normalizeLower(p)).filter(Boolean));
  }

  function formatCorner(lat, lon) {
    return `${Number(lat).toFixed(4)}, ${Number(lon).toFixed(4)}`;
  }

  function formatList(values, limit) {
    const arr = toArray(values).filter((v) => String(v || '').trim() !== '');
    if (!arr.length) return '';
    if (arr.length <= limit) return arr.join(', ');
    return `${arr.slice(0, limit).join(', ')} +${arr.length - limit} more`;
  }

  function closeAllFilterHelpPopovers() {
    document.querySelectorAll('.filter-help-popover').forEach((popover) => {
      popover.hidden = true;
    });
    document.querySelectorAll('.filter-info-btn').forEach((button) => {
      button.setAttribute('aria-expanded', 'false');
    });
  }

  function toggleFilterHelpPopover(buttonEl) {
    const targetId = String(buttonEl?.dataset?.infoTarget || '');
    const target = targetId ? document.getElementById(targetId) : null;
    if (!target) return;

    const willOpen = target.hidden;
    closeAllFilterHelpPopovers();
    if (!willOpen) return;

    target.hidden = false;
    buttonEl.setAttribute('aria-expanded', 'true');
  }

  function getTraitMode() {
    return portalFilters.traitMode === 'all' ? 'all' : 'simple';
  }

  function clearTraitModeWarning() {
    const warning = document.getElementById('traitModeWarning');
    if (!warning) return;
    warning.textContent = '';
    warning.style.display = 'none';
    if (traitModeWarningTimer) {
      clearTimeout(traitModeWarningTimer);
      traitModeWarningTimer = null;
    }
  }

  function showTraitModeWarning(message) {
    const warning = document.getElementById('traitModeWarning');
    if (!warning || !message) return;

    if (traitModeWarningTimer) clearTimeout(traitModeWarningTimer);

    warning.textContent = message;
    warning.style.display = 'block';

    traitModeWarningTimer = setTimeout(() => {
      warning.style.display = 'none';
      warning.textContent = '';
      traitModeWarningTimer = null;
    }, 5000);
  }

  function clearTraitSelectionsForModeSwitch() {
    selectedFacets = window.selectedFacets || {};
    let hadAny = false;

    if (toArray(portalFilters.selectedPhenophases).length) {
      portalFilters.selectedPhenophases = [];
      hadAny = true;
    }

    if (toArray(selectedFacets.mappedTraits).length) {
      delete selectedFacets.mappedTraits;
      hadAny = true;
    }

    window.selectedFacets = selectedFacets;
    return hadAny;
  }

  function updateTraitModeUi() {
    const mode = getTraitMode();
    const simple = mode === 'simple';

    $('#traitModeSimple').toggleClass('active', simple);
    $('#traitModeAll').toggleClass('active', !simple);
    $('#phenophaseFilters').toggle(simple);
    $('#allTraitsFilters').toggle(!simple);
  }

  function switchTraitMode(mode, { fromUser = false } = {}) {
    const nextMode = mode === 'all' ? 'all' : 'simple';
    const currentMode = getTraitMode();

    if (nextMode === currentMode) {
      updateTraitModeUi();
      return;
    }

    const hadSelections = clearTraitSelectionsForModeSwitch();
    portalFilters.traitMode = nextMode;
    updateTraitModeUi();

    if (hadSelections && fromUser) {
      showTraitModeWarning(`Switched to ${nextMode === 'all' ? 'All traits' : 'Simple terms'}. Previous trait selections were cleared.`);
      runSearchForFilterChange();
      return;
    }

    clearTraitModeWarning();
    updateQueryWithSelectedFacets();
    updateQuerySummary();
    renderSelectedFacets();
  }

  function updateQuerySummary() {
    const el = document.getElementById('querySummary');
    if (!el) return;

    selectedFacets = window.selectedFacets || {};
    const parts = [];

    const nameSearchText = String(window.scientificNameSearchText || '').trim();
    if (nameSearchText) {
      parts.push(`Name: ${nameSearchText}`);
    }

    Object.entries(selectedFacets).forEach(([field, values]) => {
      const normalized = toArray(values).filter(Boolean);
      if (!normalized.length) return;
      const fieldLabel = (field === 'dataSource') ? 'Source' : (field === 'mappedTraits' ? 'Traits' : field);
      parts.push(`${fieldLabel}: ${formatList(normalized, 2)}`);
    });

    if (!isFullYearRange()) {
      const r = getYearRangeFromState();
      parts.push(`Year: ${r.minYear}-${r.maxYear}`);
    }

    const presenceMode = (portalFilters.presenceMode || 'both').toLowerCase();
    if (presenceMode !== 'both') {
      parts.push(`Presence: ${presenceMode}`);
    }

    const selectedPhases = toArray(portalFilters.selectedPhenophases);
    if (selectedPhases.length) {
      parts.push(`Phenophases: ${formatList(selectedPhases, 2)}`);
    }

    const bounds = normalizeGeoBounds(portalFilters.geoBounds);
    if (bounds) {
      parts.push(`Geo: lat ${bounds.minLatText}..${bounds.maxLatText}, lon ${bounds.minLonText}..${bounds.maxLonText}`);
    }

    el.textContent = parts.length ? `| ${parts.join(' | ')}` : '';
  }

  // Display names for chips
  const FIELD_LABELS = {
    dataSource: 'Data Source',
    mappedTraits: 'Trait',
    family: 'Family',
    genus: 'Genus',
  };

  // -----------------------
  // Query builders
  // -----------------------
  function buildFacetMustClauses() {
    const must = [];

    Object.entries(selectedFacets).forEach(([field, values]) => {
      const cleaned = toArray(values).filter((v) => v != null && v !== '' && !(field === 'mappedTraits' && isHiddenTrait(v)));
      if (!cleaned.length) return;

      if (cleaned.length === 1) {
        must.push({ term: { [field]: cleaned[0] } });
      } else {
        must.push({
          bool: {
            should: cleaned.map((v) => ({ term: { [field]: v } })),
            minimum_should_match: 1,
          },
        });
      }
    });

    return must;
  }

  function buildDateRangeClause() {
    const r = getYearRangeFromState();
    if (r.minYear <= MIN_YEAR && r.maxYear >= CURRENT_YEAR) return null;
    return { range: { year: { gte: r.minYear, lte: r.maxYear } } };
  }

  function buildPresenceClause() {
    const mode = (portalFilters.presenceMode || 'both').toLowerCase();
    if (mode !== 'present' && mode !== 'absent') return null;
    return { wildcard: { mappedTraits: `*${mode}` } };
  }

  function getPhenophaseMappedTraitTerms() {
    if (getTraitMode() !== 'simple') return [];

    const selected = portalFilters.selectedPhenophases || [];
    if (!selected.length) return [];

    const mode = (portalFilters.presenceMode || 'both').toLowerCase();
    const terms = new Set();

    selected.forEach((phaseBase) => {
      const base = String(phaseBase || '').trim();
      if (!base) return;

      if (mode !== 'absent') terms.add(`${base} present`);
      if (mode !== 'present') terms.add(`${base} absent`);
    });

    return Array.from(terms);
  }

  function buildPhenophaseClause() {
    const terms = getPhenophaseMappedTraitTerms();
    if (!terms.length) return null;

    return {
      bool: {
        should: terms.map((term) => ({ term: { mappedTraits: term } })),
        minimum_should_match: 1,
      },
    };
  }

  function buildGeoRangeClauses() {
    const bounds = normalizeGeoBounds(portalFilters.geoBounds);
    if (!bounds) return [];

    return [
      { range: { latitude: { gte: bounds.minLat, lte: bounds.maxLat } } },
      { range: { longitude: { gte: bounds.minLon, lte: bounds.maxLon } } },
    ];
  }

  function updateQueryWithSelectedFacets() {
    const rd = getRequestData();
    selectedFacets = window.selectedFacets || {};

    syncPresenceModeFromSelectedSources();

    const must = [];

    must.push(...buildFacetMustClauses());

    if (window.scientificNameFilter) {
      must.push(window.scientificNameFilter);
    }

    const dateClause = buildDateRangeClause();
    if (dateClause) must.push(dateClause);

    const presenceClause = buildPresenceClause();
    if (presenceClause) must.push(presenceClause);

    const phenophaseClause = buildPhenophaseClause();
    if (phenophaseClause) must.push(phenophaseClause);

    must.push(...buildGeoRangeClauses());

    rd.query = must.length ? { bool: { must } } : { match_all: {} };
    window.requestData = rd;

    if (typeof window.updateDownloadLink === 'function') {
      window.updateDownloadLink();
    }

    updateQuerySummary();
  }

  // -----------------------
  // Core facet actions
  // -----------------------
  function addFacet(field, value) {
    if (!field) return;
    selectedFacets = window.selectedFacets || {};
    selectedFacets[field] = selectedFacets[field] || [];
    if (!selectedFacets[field].includes(value)) {
      selectedFacets[field].push(value);
    }
    window.selectedFacets = selectedFacets;

    runSearchForFilterChange();
  }

  function removeFacet(field, value) {
    selectedFacets = window.selectedFacets || {};
    if (!selectedFacets[field]) return;

    selectedFacets[field] = selectedFacets[field].filter((v) => v !== value);
    if (!selectedFacets[field].length) delete selectedFacets[field];

    window.selectedFacets = selectedFacets;
    runSearchForFilterChange();
  }

  window.addFacet = addFacet;
  window.removeFacet = removeFacet;
  window.updateQueryWithSelectedFacets = updateQueryWithSelectedFacets;

  // -----------------------
  // Presence mode locking
  // -----------------------
  function syncPresenceModeFromSelectedSources() {
    selectedFacets = window.selectedFacets || {};
    const selectedSources = toArray(selectedFacets.dataSource);
    const lockToPresent = selectedSources.length > 0 && selectedSources.every(presentOnlySource);

    const radios = document.querySelectorAll('input[name="presenceMode"]');
    const hint = document.getElementById('presenceModeHint');

    if (lockToPresent) {
      if (!presenceModeLocked && portalFilters.presenceMode !== 'present') {
        lastUnlockedPresenceMode = portalFilters.presenceMode;
      }
      presenceModeLocked = true;
      portalFilters.presenceMode = 'present';

      radios.forEach((r) => {
        r.disabled = true;
        r.checked = (r.value === 'present');
      });

      if (hint) {
        hint.textContent = 'Selected data source(s) only provide present records.';
        hint.style.display = 'block';
      }
    } else {
      if (presenceModeLocked && portalFilters.presenceMode === 'present' && lastUnlockedPresenceMode) {
        portalFilters.presenceMode = lastUnlockedPresenceMode;
      }

      presenceModeLocked = false;
      radios.forEach((r) => {
        r.disabled = false;
        r.checked = (r.value === portalFilters.presenceMode);
      });

      if (hint) {
        hint.textContent = '';
        hint.style.display = 'none';
      }
    }
  }

  // -----------------------
  // Custom controls UI
  // -----------------------
  function phenophaseCountFor(base) {
    const present = availableTraitCountsLC.get(`${base} present`) || 0;
    const absent = availableTraitCountsLC.get(`${base} absent`) || 0;
    return present + absent;
  }

  function renderPhenophaseFilters() {
    const container = document.getElementById('phenophaseFilters');
    if (!container) return;

    const selected = selectedPhenophasesSet();

    const html = PHENOPHASE_CATEGORIES.map((cat) => {
      const selectedInCategory = cat.phases.filter((p) => selected.has(p.key)).length;
      const options = cat.phases.map((phase) => {
        const checked = selected.has(phase.key) ? 'checked' : '';
        const count = phenophaseCountFor(phase.key);
        const countLabel = count ? `<span class="phenophase-count">(${count.toLocaleString()})</span>` : '';
        return `
          <label class="phenophase-option">
            <input type="checkbox" class="phenophase-check" data-phase="${phase.key}" ${checked}>
            ${phase.label} ${countLabel}
          </label>
        `;
      }).join('');

      const suffix = selectedInCategory ? ` (${selectedInCategory} selected)` : '';

      return `
        <details class="phenophase-category">
          <summary>${cat.label}${suffix}</summary>
          <div class="phenophase-options">${options}</div>
        </details>
      `;
    }).join('');

    container.innerHTML = html;
  }

  function syncUiFromState() {
    const bounds = normalizeGeoBounds(portalFilters.geoBounds);
    const hint = document.getElementById('geoFilterHint');
    if (hint) {
      hint.textContent = bounds
        ? `Southwest: ${formatCorner(bounds.minLat, bounds.minLon)} | Northeast: ${formatCorner(bounds.maxLat, bounds.maxLon)}`
        : '';
    }

    const radios = document.querySelectorAll('input[name="presenceMode"]');
    radios.forEach((r) => {
      r.checked = (r.value === portalFilters.presenceMode);
    });

    const r = getYearRangeFromState();
    const $yearSlider = $('#yearRangeSlider');
    if (yearSliderInitialized && $yearSlider.length && $yearSlider.hasClass('ui-slider')) {
      $yearSlider.slider('values', [r.minYear, r.maxYear]);
    }
    updateYearRangeDisplay();

    updateTraitModeUi();
    renderPhenophaseFilters();
    syncPresenceModeFromSelectedSources();
    updateQuerySummary();
  }

  function resetCustomFilters() {
    portalFilters.minYear = MIN_YEAR;
    portalFilters.maxYear = CURRENT_YEAR;
    portalFilters.presenceMode = 'both';
    portalFilters.selectedPhenophases = [];
    portalFilters.geoBounds = null;
    portalFilters.traitMode = 'simple';
    clearTraitModeWarning();
  }

  function initializeYearSlider() {
    const $yearSlider = $('#yearRangeSlider');
    if (!$yearSlider.length || !$.fn.slider || yearSliderInitialized) {
      updateYearRangeDisplay();
      return;
    }

    const r = getYearRangeFromState();
    $yearSlider.slider({
      range: true,
      min: MIN_YEAR,
      max: CURRENT_YEAR,
      values: [r.minYear, r.maxYear],
      slide: function (_event, ui) {
        portalFilters.minYear = ui.values[0];
        portalFilters.maxYear = ui.values[1];
        updateYearRangeDisplay();
        updateQuerySummary();
      },
      stop: function (_event, ui) {
        portalFilters.minYear = ui.values[0];
        portalFilters.maxYear = ui.values[1];
        runSearchForFilterChange();
      },
    });

    yearSliderInitialized = true;
    updateYearRangeDisplay();
  }

  function bindCustomControls() {
    if (initializedCustomControls) return;

    const $presence = $('input[name="presenceMode"]');
    const $clearGeo = $('#clearGeoBounds');
    const $setGeoOnMap = $('#setGeoBoundsOnMap');
    const $traitModeSimple = $('#traitModeSimple');
    const $traitModeAll = $('#traitModeAll');

    window.onMapBBoxCleared = function () {
      if (!portalFilters.geoBounds) return;
      portalFilters.geoBounds = null;
      syncUiFromState();
      runSearchForFilterChange();
    };

    initializeYearSlider();

    $(document).off('click', '.filter-info-btn').on('click', '.filter-info-btn', function (event) {
      event.preventDefault();
      event.stopPropagation();
      toggleFilterHelpPopover(this);
    });

    $(document).off('click.filterInfoPopover').on('click.filterInfoPopover', function (event) {
      if ($(event.target).closest('.facet-title-row').length) return;
      closeAllFilterHelpPopovers();
    });

    $(document).off('keydown.filterInfoPopover').on('keydown.filterInfoPopover', function (event) {
      if (event.key === 'Escape') {
        closeAllFilterHelpPopovers();
      }
    });

    $traitModeSimple.on('click', function () {
      switchTraitMode('simple', { fromUser: true });
    });

    $traitModeAll.on('click', function () {
      switchTraitMode('all', { fromUser: true });
    });

    $presence.on('change', function () {
      if (presenceModeLocked) return;
      portalFilters.presenceMode = String($(this).val() || 'both').toLowerCase();
      lastUnlockedPresenceMode = portalFilters.presenceMode;
      runSearchForFilterChange();
    });

    $('#phenophaseFilters').on('change', '.phenophase-check', function () {
      const phase = normalizeLower($(this).data('phase'));
      const selected = selectedPhenophasesSet();
      if (this.checked) selected.add(phase);
      else selected.delete(phase);
      portalFilters.selectedPhenophases = Array.from(selected);
      runSearchForFilterChange();
    });

    $clearGeo.on('click', function () {
      portalFilters.geoBounds = null;
      if (typeof window.clearSelectedBoundingBoxOverlay === 'function') {
        window.clearSelectedBoundingBoxOverlay();
      }
      syncUiFromState();
      runSearchForFilterChange();
    });

    $setGeoOnMap.on('click', function () {
      $('#showMap').trigger('click');

      window.setTimeout(function () {
        if (typeof window.startBoundingBoxSelection !== 'function') {
          return;
        }

        window.startBoundingBoxSelection({
          onComplete: function (bounds) {
            portalFilters.geoBounds = normalizeGeoBounds(bounds);
            syncUiFromState();
            runSearchForFilterChange();
          },
          onCancel: function () {},
        });
      }, 180);
    });

    initializedCustomControls = true;
    syncUiFromState();
  }

  // -----------------------
  // Selected chips
  // -----------------------
  function renderSelectedFacets() {
    selectedFacets = window.selectedFacets || {};

    const $wrap = $('#selectedFacets');
    $wrap.empty();

    const chips = [];

    Object.entries(selectedFacets).forEach(([field, values = []]) => {
      const label = FIELD_LABELS[field] || field;
      values.forEach((val) => {
        chips.push({
          html: `
            <span class="selected-facet" data-field="${field}" data-value="${val}">
              <strong>${label}:</strong> ${val}
              <span class="remove-facet" title="Remove" aria-label="Remove filter">x</span>
            </span>
          `,
        });
      });
    });

    if (!isFullYearRange()) {
      const r = getYearRangeFromState();
      chips.push({
        html: `
          <span class="selected-facet" data-custom="year-range">
            <strong>Year:</strong> ${r.minYear} to ${r.maxYear}
            <span class="remove-facet" title="Remove" aria-label="Remove filter">x</span>
          </span>
        `,
      });
    }

    if ((portalFilters.presenceMode || 'both') !== 'both') {
      chips.push({
        html: `
          <span class="selected-facet" data-custom="presence-mode">
            <strong>Presence:</strong> ${portalFilters.presenceMode}
            <span class="remove-facet" title="Remove" aria-label="Remove filter">x</span>
          </span>
        `,
      });
    }

    const bounds = normalizeGeoBounds(portalFilters.geoBounds);
    if (bounds) {
      chips.push({
        html: `
          <span class="selected-facet" data-custom="geo-bounds">
            <strong>Geo:</strong> lat ${bounds.minLatText}..${bounds.maxLatText}, lon ${bounds.minLonText}..${bounds.maxLonText}
            <span class="remove-facet" title="Remove" aria-label="Remove filter">x</span>
          </span>
        `,
      });
    }

    (portalFilters.selectedPhenophases || []).forEach((phase) => {
      chips.push({
        html: `
          <span class="selected-facet" data-custom="phenophase" data-value="${phase}">
            <strong>Phenophase:</strong> ${phase}
            <span class="remove-facet" title="Remove" aria-label="Remove filter">x</span>
          </span>
        `,
      });
    });

    if (!chips.length) {
      $wrap.append('<div class="text-muted">No filters selected.</div>');
      updateQuerySummary();
      return;
    }

    const $chips = $('<div/>');
    chips.forEach((c) => $chips.append(c.html));
    $wrap.append($chips);

    const $clear = $('<button class="btn btn-default" id="clearAllFacetsBtn" style="margin-top:8px;">Clear all</button>');
    $wrap.append($clear);

    $wrap.off('click', '.remove-facet').on('click', '.remove-facet', function (e) {
      e.preventDefault();
      e.stopPropagation();

      const $p = $(this).closest('.selected-facet');
      const customType = $p.data('custom');

      if (customType) {
        if (customType === 'year-range' || customType === 'date-range') {
          portalFilters.minYear = MIN_YEAR;
          portalFilters.maxYear = CURRENT_YEAR;
        } else if (customType === 'presence-mode') {
          portalFilters.presenceMode = presenceModeLocked ? 'present' : 'both';
          if (!presenceModeLocked) lastUnlockedPresenceMode = 'both';
        } else if (customType === 'geo-bounds') {
          portalFilters.geoBounds = null;
          const hint = document.getElementById('geoFilterHint');
          if (hint) hint.textContent = '';
        } else if (customType === 'phenophase') {
          const val = normalizeLower($p.data('value'));
          portalFilters.selectedPhenophases = (portalFilters.selectedPhenophases || []).filter((p) => normalizeLower(p) !== val);
        }

        syncUiFromState();
        runSearchForFilterChange();
        return;
      }

      const field = $p.data('field');
      const value = $p.data('value');
      removeFacet(field, value);
    });

    $wrap.off('click', '#clearAllFacetsBtn').on('click', '#clearAllFacetsBtn', function () {
      window.selectedFacets = {};
      selectedFacets = window.selectedFacets;

      if (typeof window.scientificNameFilter !== 'undefined') window.scientificNameFilter = null;
      if (typeof window.scientificNameSearchText !== 'undefined') window.scientificNameSearchText = '';
      if ($('#scientificNameSearch').length) $('#scientificNameSearch').val('');

      resetCustomFilters();
      syncUiFromState();

      runSearchForFilterChange();
    });

    updateQuerySummary();
  }
  window.renderSelectedFacets = renderSelectedFacets;

  // -----------------------
  // Facet list rendering
  // -----------------------
  function renderFacetLinks(aggregation, container, field) {
    const $c = $(container);
    $c.empty();
    if (!(aggregation && aggregation.buckets)) return;

    const allBuckets = aggregation.buckets.filter((bucket) => !(field === 'mappedTraits' && isHiddenTrait(bucket.key)));
    const limit = FACET_PREVIEW_LIMITS[field] || null;
    const expanded = !!facetExpandedState[field];

    let bucketsToRender = allBuckets;
    if (limit && !expanded) {
      bucketsToRender = allBuckets.slice(0, limit);

      // Keep any selected values visible even if they are outside the top preview slice.
      const selectedValues = new Set(toArray(selectedFacets[field]));
      if (selectedValues.size) {
        allBuckets.forEach((bucket) => {
          if (!selectedValues.has(bucket.key)) return;
          if (!bucketsToRender.some((b) => b.key === bucket.key)) bucketsToRender.push(bucket);
        });
      }
    }

    bucketsToRender.forEach((bucket) => {
      const key = bucket.key;

      const isSelected = selectedFacets[field] && selectedFacets[field].includes(key);
      const countFormatted = (bucket.doc_count || 0).toLocaleString();

      $c.append(`
        <div class="facet-link-container">
          <a class="facet-link ${isSelected ? 'selected' : ''}" href="#" data-field="${field}" data-value="${key}">
            <span class="text">${key}</span>
            <span class="count">(${countFormatted})</span>
            ${isSelected ? `<span class="remove-facet" data-field="${field}" data-value="${key}" title="Remove">x</span>` : ''}
          </a>
        </div>
      `);
    });

    if (limit && allBuckets.length > limit) {
      const toggleLabel = expanded ? 'see less' : 'see more';
      $c.append(`<a href="#" class="facet-see-more" data-field="${field}"><em>${toggleLabel}</em></a>`);
    }

    $c.find('.facet-link').off('click').on('click', function (e) {
      e.preventDefault();
      const field = $(this).data('field');
      const value = $(this).data('value');
      if (!$(this).hasClass('selected')) addFacet(field, value);
    });

    $c.off('click', '.facet-see-more').on('click', '.facet-see-more', function (e) {
      e.preventDefault();
      const targetField = String($(this).data('field') || '');
      if (!FACET_PREVIEW_LIMITS[targetField]) return;
      facetExpandedState[targetField] = !facetExpandedState[targetField];
      renderFacetLinks(aggregation, container, field);
    });

    $c.off('click', '.remove-facet').on('click', '.remove-facet', function (e) {
      e.preventDefault();
      e.stopPropagation();
      const field = $(this).data('field');
      const value = $(this).data('value');
      removeFacet(field, value);
    });
  }

  function updateTraitCountLookup(aggregations) {
    availableTraitCountsLC.clear();
    const buckets = aggregations?.mappedTraits_1?.buckets || [];
    buckets.forEach((b) => {
      availableTraitCountsLC.set(normalizeLower(b.key), b.doc_count || 0);
    });
  }

  // -----------------------
  // Main entry from fetchResults success
  // -----------------------
  function renderFacets(aggregations) {
    selectedFacets = window.selectedFacets || {};

    $('#dataSourceFacets').empty();
    $('#allTraitsFilters').empty();

    renderFacetLinks(aggregations.datasource_0, '#dataSourceFacets', 'dataSource');

    const traitAgg = { buckets: (aggregations?.mappedTraits_1?.buckets || []) };
    renderFacetLinks(traitAgg, '#allTraitsFilters', 'mappedTraits');

    updateTraitCountLookup(aggregations);
    renderPhenophaseFilters();
    updateTraitModeUi();
    syncPresenceModeFromSelectedSources();

    renderSelectedFacets();
    updateQuerySummary();
  }

  window.renderFacets = renderFacets;

  $(document).ready(function () {
    bindCustomControls();
  });
})();
