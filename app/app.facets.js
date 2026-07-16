/* app.facets.js — facet rendering + portal filter controls
   - Keeps backend API route and payload style unchanged (ES query body via existing proxy)
   - Adds UI-driven filters: year range slider, presence mode, phenophase categories, all-traits mode, geo bounds
*/

(function () {
  // -----------------------
  // Shared / globals
  // -----------------------
  const HIDDEN_TRAIT = 'plant structure present';
  const TIME_CONFIG = window.phenobaseTimeConfig || {};
  const SELECTOR_MIN_YEAR = Number.isFinite(Number(TIME_CONFIG.selectorMinYear)) ? Math.round(Number(TIME_CONFIG.selectorMinYear)) : 1500;
  const DEFAULT_FILTER_MIN_YEAR = Number.isFinite(Number(TIME_CONFIG.minYear)) ? Math.round(Number(TIME_CONFIG.minYear)) : 1970;
  const CURRENT_YEAR = Number.isFinite(Number(TIME_CONFIG.maxYear)) ? Math.round(Number(TIME_CONFIG.maxYear)) : new Date().getFullYear();
  const MIN_DECADE_START = Math.floor(SELECTOR_MIN_YEAR / 10) * 10;
  const DEFAULT_FILTER_DECADE_START = Math.floor(DEFAULT_FILTER_MIN_YEAR / 10) * 10;
  const MAX_DECADE_START = Math.floor(CURRENT_YEAR / 10) * 10;
  const PRE_1960_DECADE_START = 1500;
  const PRE_1960_DECADE_END = 1959;
  const PRE_1960_DECADE_LABEL = 'pre-1960';
  const URL_FILTER_STATE_ENABLED = window.phenobaseEnableUrlFilterState === true;
  const PORTAL_URL_PARAM_KEYS = [
    'scientificName',
    'taxonField',
    'decadeStart',
    'decadeEnd',
    'startYear',
    'endYear',
    'presenceMode',
    'traitMode',
    'dataSource',
    'mappedTrait',
    'phenophase',
    'minLat',
    'maxLat',
    'minLon',
    'maxLon',
  ];
  const PRESENT_ONLY_SOURCE_MATCHERS = [/\binaturalist\b/i, /\bherbarium-?gbif\b/i, /\bgbif\b/i, /\binat\b/i];
  const DECADE_STARTS = [];
  DECADE_STARTS.push(PRE_1960_DECADE_START);
  for (let year = Math.max(1960, MIN_DECADE_START); year <= MAX_DECADE_START; year += 10) {
    DECADE_STARTS.push(year);
  }

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
    decadeStart: DEFAULT_FILTER_DECADE_START,
    decadeEnd: MAX_DECADE_START,
    startYear: null,
    endYear: null,
    selectedPhenophases: [],
    geoBounds: null,
    traitMode: 'simple',
  };
  const portalFilters = window.portalFilters;

  // Backward-compatible migration from old state fields.
  if (!Number.isInteger(portalFilters.decadeStart)) {
    const legacyStart = Number.isInteger(portalFilters.minYear)
      ? portalFilters.minYear
      : Number(String(portalFilters.dateStart || '').slice(0, 4));
    portalFilters.decadeStart = Number.isFinite(legacyStart) ? Math.floor(legacyStart / 10) * 10 : DEFAULT_FILTER_DECADE_START;
  }
  if (!Number.isInteger(portalFilters.decadeEnd)) {
    const legacyEnd = Number.isInteger(portalFilters.maxYear)
      ? portalFilters.maxYear
      : Number(String(portalFilters.dateEnd || '').slice(0, 4));
    portalFilters.decadeEnd = Number.isFinite(legacyEnd) ? Math.floor(legacyEnd / 10) * 10 : MAX_DECADE_START;
  }
  if (!portalFilters.traitMode) {
    portalFilters.traitMode = portalFilters.advancedTraitsVisible ? 'all' : 'simple';
  }
  delete portalFilters.minYear;
  delete portalFilters.maxYear;
  delete portalFilters.dateStart;
  delete portalFilters.dateEnd;
  delete portalFilters.advancedTraitsVisible;

  const decadeCountsByStart = new Map();
  let availableDataSources = [];
  let sourceSelectionDraft = null;
  const FACET_PREVIEW_LIMITS = { standardizedFamily: 5, genus: 5 };
  const facetExpandedState = { standardizedFamily: false, genus: false };
  let initializedCustomControls = false;
  let yearSliderInitialized = false;
  let presenceModeLocked = false;
  let lastUnlockedPresenceMode = normalizePresenceMode(portalFilters.presenceMode);
  let traitModeWarningTimer = null;
  let maxDecadeCount = 0;
  let appliedFilterState = null;
  let filtersDirty = false;
  let autoApplyTimer = null;
  let autoApplyInFlight = false;
  const AUTO_APPLY_DELAY_MS = 350;

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

  function normalizePresenceMode(value) {
    const mode = normalizeLower(value);
    return mode === 'present' || mode === 'absent' || mode === 'both' ? mode : 'both';
  }

  function presenceModeFromInputs() {
    const present = document.querySelector('input[name="presenceMode"][value="present"]');
    const absent = document.querySelector('input[name="presenceMode"][value="absent"]');
    const presentChecked = !!(present && present.checked);
    const absentChecked = !!(absent && absent.checked);

    if (presentChecked && absentChecked) return 'both';
    if (presentChecked) return 'present';
    if (absentChecked) return 'absent';
    return null;
  }

  function syncPresenceInputsFromMode() {
    const mode = normalizePresenceMode(portalFilters.presenceMode);
    portalFilters.presenceMode = mode;

    document.querySelectorAll('input[name="presenceMode"]').forEach((input) => {
      const value = normalizeLower(input.value);
      if (value === 'present') {
        input.checked = mode !== 'absent';
      } else if (value === 'absent') {
        input.checked = mode !== 'present';
      } else {
        input.checked = value === mode;
      }
    });
  }

  function normalizeSourceValues(values) {
    const seen = new Set();
    const normalized = [];
    toArray(values).forEach((value) => {
      const source = String(value || '').trim();
      if (!source || seen.has(source)) return;
      seen.add(source);
      normalized.push(source);
    });
    return normalized;
  }

  function sameValueSet(a, b) {
    const left = normalizeSourceValues(a);
    const right = normalizeSourceValues(b);
    if (left.length !== right.length) return false;
    const rightSet = new Set(right);
    return left.every((value) => rightSet.has(value));
  }

  function getAppliedSourceValues() {
    return normalizeSourceValues((window.selectedFacets || {}).dataSource);
  }

  function getDraftSourceValues() {
    return sourceSelectionDraft !== null ? normalizeSourceValues(sourceSelectionDraft) : getAppliedSourceValues();
  }

  function sourceDraftChanged() {
    return sourceSelectionDraft !== null && !sameValueSet(sourceSelectionDraft, getAppliedSourceValues());
  }

  function setSourceDraftValues(values) {
    sourceSelectionDraft = normalizeSourceValues(values);
  }

  function syncSourceDraftFromApplied() {
    sourceSelectionDraft = null;
  }

  function hasAppliedSourceState(source = window.selectedFacets || {}) {
    return Object.prototype.hasOwnProperty.call(source, 'dataSource');
  }

  function allKnownSourcesSelected(values = getAppliedSourceValues()) {
    return availableDataSources.length > 0 && sameValueSet(values, availableDataSources);
  }

  function normalizeExplicitYear(value) {
    if (value == null || String(value).trim() === '') return null;
    const year = Number(String(value).trim());
    if (!Number.isInteger(year)) return null;
    if (year < SELECTOR_MIN_YEAR || year > CURRENT_YEAR) return null;
    return year;
  }

  function hasExplicitYearRange() {
    return normalizeExplicitYear(portalFilters.startYear) != null
      || normalizeExplicitYear(portalFilters.endYear) != null;
  }

  function getExplicitYearRange() {
    const startYear = normalizeExplicitYear(portalFilters.startYear);
    const endYear = normalizeExplicitYear(portalFilters.endYear);
    if (startYear == null && endYear == null) return null;

    const range = {};
    if (startYear != null) range.gte = startYear;
    if (endYear != null) range.lte = endYear;
    return range;
  }

  function explicitYearSelectionLabel() {
    const startYear = normalizeExplicitYear(portalFilters.startYear);
    const endYear = normalizeExplicitYear(portalFilters.endYear);
    if (startYear != null && endYear != null) return `${startYear}-${endYear}`;
    if (startYear != null) return `${startYear}+`;
    if (endYear != null) return `through ${endYear}`;
    return '';
  }

  function isPre1960DecadeStart(decadeStart) {
    return Number(decadeStart) === PRE_1960_DECADE_START;
  }

  function cloneSelectedFacetsState(source) {
    const clone = {};
    Object.entries(source || {}).forEach(([field, values]) => {
      const normalized = toArray(values)
        .map((value) => String(value || '').trim())
        .filter(Boolean);
      if (field === 'dataSource') {
        clone[field] = normalized.slice();
        return;
      }
      if (normalized.length) clone[field] = normalized.slice();
    });
    return clone;
  }

  function clonePortalFilterState(source) {
    const bounds = normalizeGeoBounds(source?.geoBounds);
    return {
      presenceMode: normalizePresenceMode(source?.presenceMode),
      decadeStart: clampDecadeStart(source?.decadeStart, DEFAULT_FILTER_DECADE_START),
      decadeEnd: clampDecadeStart(source?.decadeEnd, MAX_DECADE_START),
      startYear: normalizeExplicitYear(source?.startYear),
      endYear: normalizeExplicitYear(source?.endYear),
      selectedPhenophases: toArray(source?.selectedPhenophases)
        .map((value) => normalizeLower(value))
        .filter(Boolean),
      geoBounds: bounds ? {
        minLat: bounds.minLat,
        maxLat: bounds.maxLat,
        minLon: bounds.minLon,
        maxLon: bounds.maxLon,
      } : null,
      traitMode: source?.traitMode === 'all' ? 'all' : 'simple',
    };
  }

  function getCurrentFilterState() {
    return {
      selectedFacets: cloneSelectedFacetsState(window.selectedFacets || {}),
      portalFilters: clonePortalFilterState(portalFilters),
      scientificName: String(window.scientificNameSearchText || '').trim(),
      taxonField: String(window.taxonFilter?.field || '').trim(),
    };
  }

  function buildTaxonSuggestionFromState(searchText, field) {
    const value = String(searchText || '').trim();
    if (!value) return null;
    const normalizedField = String(field || 'scientificName').trim() || 'scientificName';
    return {
      label: value,
      value,
      field: normalizedField,
      rank: normalizedField === 'scientificName' ? 'species' : normalizedField,
    };
  }

  function buildScientificFilterForText(searchText, field) {
    const suggestion = buildTaxonSuggestionFromState(searchText, field);
    if (!suggestion) return null;
    if (typeof window.buildTaxonFilterFromSuggestion === 'function') {
      return window.buildTaxonFilterFromSuggestion(suggestion);
    }
    if (typeof window.buildScientificSearchFilter === 'function') {
      return window.buildScientificSearchFilter(searchText);
    }
    return null;
  }

  function statesEqual(a, b) {
    try {
      return JSON.stringify(a || {}) === JSON.stringify(b || {});
    } catch (_error) {
      return false;
    }
  }

  function refreshFilterApplyUi() {
    const message = document.getElementById('filterPendingMessage');
    const applyButton = document.getElementById('applyFiltersButton');
    const resetButton = document.getElementById('resetDraftFiltersButton');

    if (message) {
      message.textContent = autoApplyInFlight
        ? 'Updating filters...'
        : (sourceDraftChanged() ? 'Apply source changes to continue.' : (filtersDirty ? 'Updating filters shortly...' : 'Filters update automatically.'));
      message.classList.toggle('is-dirty', filtersDirty || sourceDraftChanged() || autoApplyInFlight);
      message.classList.toggle('is-clean', !filtersDirty && !sourceDraftChanged() && !autoApplyInFlight);
    }

    if (applyButton) applyButton.disabled = !(filtersDirty || sourceDraftChanged());
    if (resetButton) resetButton.disabled = !(filtersDirty || sourceDraftChanged());

    updateSourceSelectionUi();
  }

  function cancelAutoApplyForSourceDraft() {
    if (!autoApplyTimer) return;
    window.clearTimeout(autoApplyTimer);
    autoApplyTimer = null;
    refreshFilterApplyUi();
  }

  function recomputeFilterDirtyState() {
    filtersDirty = appliedFilterState ? !statesEqual(getCurrentFilterState(), appliedFilterState) : false;
    refreshFilterApplyUi();
  }

  function captureAppliedFilterState() {
    appliedFilterState = getCurrentFilterState();
    recomputeFilterDirtyState();
  }

  function applyFilterStateSnapshot(snapshot) {
    const nextState = snapshot || {
      selectedFacets: {},
      portalFilters: clonePortalFilterState(portalFilters),
      scientificName: '',
    };

    window.selectedFacets = cloneSelectedFacetsState(nextState.selectedFacets || {});
    selectedFacets = window.selectedFacets;
    syncSourceDraftFromApplied();

    const nextPortalFilters = clonePortalFilterState(nextState.portalFilters || {});
    portalFilters.presenceMode = nextPortalFilters.presenceMode;
    portalFilters.decadeStart = nextPortalFilters.decadeStart;
    portalFilters.decadeEnd = nextPortalFilters.decadeEnd;
    portalFilters.startYear = nextPortalFilters.startYear;
    portalFilters.endYear = nextPortalFilters.endYear;
    portalFilters.selectedPhenophases = nextPortalFilters.selectedPhenophases.slice();
    portalFilters.geoBounds = nextPortalFilters.geoBounds ? { ...nextPortalFilters.geoBounds } : null;
    portalFilters.traitMode = nextPortalFilters.traitMode;

    const scientificName = String(nextState.scientificName || '').trim();
    const taxonField = String(nextState.taxonField || 'scientificName').trim() || 'scientificName';
    const taxonSuggestion = buildTaxonSuggestionFromState(scientificName, taxonField);
    if (taxonSuggestion && typeof window.setTaxonFilter === 'function') {
      window.setTaxonFilter(taxonSuggestion);
    } else if (typeof window.clearTaxonFilter === 'function') {
      window.clearTaxonFilter();
    } else {
      window.scientificNameSearchText = scientificName;
      if (typeof scientificNameSearchText !== 'undefined') scientificNameSearchText = scientificName;
      window.taxonFilter = taxonSuggestion;

      const builtScientificFilter = buildScientificFilterForText(scientificName, taxonField);
      window.scientificNameFilter = builtScientificFilter;
      if (typeof scientificNameFilter !== 'undefined') scientificNameFilter = builtScientificFilter;

      if ($('#scientificNameSearch').length) $('#scientificNameSearch').val(scientificName);
    }
  }

  function resetPaging() {
    if (typeof window.currentPage !== 'undefined') window.currentPage = 1;
  }

  function scheduleAutoApply(delayMs = AUTO_APPLY_DELAY_MS) {
    if (autoApplyTimer) {
      window.clearTimeout(autoApplyTimer);
      autoApplyTimer = null;
    }
    autoApplyTimer = window.setTimeout(function () {
      autoApplyTimer = null;
      applyPendingFilters({ auto: true });
    }, Math.max(0, delayMs));
  }

  function markFiltersPending(options = {}) {
    recomputeFilterDirtyState();
    renderSelectedFacets();
    updateQuerySummary();
    if (filtersDirty && !sourceDraftChanged()) {
      scheduleAutoApply(options.delayMs);
    }
  }

  function applyPendingFilters(_options = {}) {
    if (autoApplyTimer) {
      window.clearTimeout(autoApplyTimer);
      autoApplyTimer = null;
    }
    if (sourceDraftChanged()) {
      setAppliedSourceValues(getDraftSourceValues());
      syncSourceDraftFromApplied();
    }
    resetPaging();
    updateQueryWithSelectedFacets();
    autoApplyInFlight = true;
    refreshFilterApplyUi();
    captureAppliedFilterState();

    if (typeof window.markMapNeedsRender === 'function') {
      window.markMapNeedsRender();
    }

    const activeTab = String(window.currentMainTab || 'table').toLowerCase();
    if (activeTab === 'table') {
      if (typeof window.fetchFacetData === 'function') {
        window.fetchFacetData({
          onSuccess: function () {
            autoApplyInFlight = false;
            refreshFilterApplyUi();
          },
          onError: function () {
            autoApplyInFlight = false;
            refreshFilterApplyUi();
          },
        });
      }
      if (typeof window.fetchResults === 'function') {
        window.fetchResults();
      }
      if (typeof window.markStatsNeedsRefresh === 'function') {
        window.markStatsNeedsRefresh();
      }
      return;
    }

    if (typeof window.fetchFacetData === 'function') {
      window.fetchFacetData({
        onSuccess: function () {
          autoApplyInFlight = false;
          refreshFilterApplyUi();
        },
        onError: function () {
          autoApplyInFlight = false;
          refreshFilterApplyUi();
        },
      });
    } else {
      autoApplyInFlight = false;
      refreshFilterApplyUi();
    }

    if (activeTab === 'stats') {
      if (typeof window.markStatsNeedsRefresh === 'function') {
        window.markStatsNeedsRefresh();
      }
      return;
    }

    if (typeof window.markStatsNeedsRefresh === 'function') {
      window.markStatsNeedsRefresh();
    }
  }

  function clampDecadeStart(value, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    const decade = Math.floor(n / 10) * 10;
    if (decade < 1960) return PRE_1960_DECADE_START;
    return Math.max(MIN_DECADE_START, Math.min(MAX_DECADE_START, decade));
  }

  function formatDecadeLabel(decadeStart) {
    if (isPre1960DecadeStart(decadeStart)) return PRE_1960_DECADE_LABEL;
    return `${decadeStart}s`;
  }

  function decadeSelectionLabel(range) {
    const selection = range || getDecadeRangeFromState();
    if (selection.decadeStart === selection.decadeEnd) return formatDecadeLabel(selection.decadeStart);
    return `${formatDecadeLabel(selection.decadeStart)}-${formatDecadeLabel(selection.decadeEnd)}`;
  }

  function getDecadeIndex(decadeStart) {
    return Math.max(0, DECADE_STARTS.indexOf(decadeStart));
  }

  function getDecadeRangeFromState() {
    let decadeStart = clampDecadeStart(portalFilters.decadeStart, DEFAULT_FILTER_DECADE_START);
    let decadeEnd = clampDecadeStart(portalFilters.decadeEnd, MAX_DECADE_START);
    if (decadeStart > decadeEnd) [decadeStart, decadeEnd] = [decadeEnd, decadeStart];
    portalFilters.decadeStart = decadeStart;
    portalFilters.decadeEnd = decadeEnd;
    return {
      decadeStart,
      decadeEnd,
      decadeStartIndex: getDecadeIndex(decadeStart),
      decadeEndIndex: getDecadeIndex(decadeEnd),
      yearStart: decadeStart,
      yearEnd: isPre1960DecadeStart(decadeEnd) ? PRE_1960_DECADE_END : decadeEnd + 9,
    };
  }

  function isFullDecadeRange() {
    if (hasExplicitYearRange()) return false;
    const r = getDecadeRangeFromState();
    return r.decadeStart === PRE_1960_DECADE_START && r.decadeEnd >= MAX_DECADE_START;
  }

  function setArrayParams(params, key, values) {
    params.delete(key);
    toArray(values)
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .forEach((value) => params.append(key, value));
  }

  function clearPortalStateUrlParams() {
    if (!(window.history && window.history.replaceState)) return;

    const params = new URLSearchParams(window.location.search);
    let changed = false;

    PORTAL_URL_PARAM_KEYS.forEach((key) => {
      if (!params.has(key)) return;
      params.delete(key);
      changed = true;
    });

    if (!changed) return;

    const nextSearch = params.toString();
    const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash || ''}`;
    window.history.replaceState({}, '', nextUrl);
  }

  function fullEarthBounds() {
    return {
      minLat: -90,
      maxLat: 90,
      minLon: -180,
      maxLon: 180,
    };
  }

  function isFullEarthBounds(bounds) {
    const normalized = normalizeGeoBounds(bounds);
    if (!normalized) return false;
    return normalized.minLat <= -90
      && normalized.maxLat >= 90
      && normalized.minLon <= -180
      && normalized.maxLon >= 180;
  }

  function syncPortalStateToUrl() {
    if (!URL_FILTER_STATE_ENABLED) {
      clearPortalStateUrlParams();
      return;
    }

    if (!(window.history && window.history.replaceState)) return;

    const selection = getDecadeRangeFromState();
    const params = new URLSearchParams(window.location.search);
    const bounds = normalizeGeoBounds(portalFilters.geoBounds) || normalizeGeoBounds(fullEarthBounds());
    const selectedFacetsState = window.selectedFacets || {};
    const scientificName = String(window.scientificNameSearchText || '').trim();
    const taxonField = String(window.taxonFilter?.field || '').trim();
    const explicitStartYear = normalizeExplicitYear(portalFilters.startYear);
    const explicitEndYear = normalizeExplicitYear(portalFilters.endYear);
    if (scientificName) {
      params.set('scientificName', scientificName);
      params.set('taxonField', taxonField || 'scientificName');
    } else {
      params.delete('scientificName');
      params.delete('taxonField');
    }

    params.set('decadeStart', String(selection.decadeStart));
    params.set('decadeEnd', String(selection.decadeEnd));
    if (explicitStartYear != null) params.set('startYear', String(explicitStartYear));
    else params.delete('startYear');
    if (explicitEndYear != null) params.set('endYear', String(explicitEndYear));
    else params.delete('endYear');

    params.set('presenceMode', normalizePresenceMode(portalFilters.presenceMode));

    if ((portalFilters.traitMode || 'simple') !== 'simple') params.set('traitMode', String(portalFilters.traitMode || 'simple'));
    else params.delete('traitMode');

    setArrayParams(params, 'dataSource', selectedFacetsState.dataSource);
    setArrayParams(params, 'mappedTrait', selectedFacetsState.mappedTraits);
    setArrayParams(params, 'phenophase', portalFilters.selectedPhenophases);

    params.set('minLat', bounds.minLatText);
    params.set('maxLat', bounds.maxLatText);
    params.set('minLon', bounds.minLonText);
    params.set('maxLon', bounds.maxLonText);

    const nextSearch = params.toString();
    const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash || ''}`;
    window.history.replaceState({}, '', nextUrl);
  }

  function initializePortalFiltersFromUrl() {
    if (!URL_FILTER_STATE_ENABLED) {
      clearPortalStateUrlParams();
      getDecadeRangeFromState();
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const selectedFromUrl = {};
    const scientificName = String(params.get('scientificName') || '').trim();
    const taxonField = String(params.get('taxonField') || 'scientificName').trim() || 'scientificName';
    const dataSources = params.getAll('dataSource').filter(Boolean);
    const mappedTraits = params.getAll('mappedTrait').filter(Boolean);
    const phenophases = params.getAll('phenophase').filter(Boolean);
    const presenceMode = String(params.get('presenceMode') || '').toLowerCase();
    const traitMode = String(params.get('traitMode') || '').toLowerCase();

    if (dataSources.length) selectedFromUrl.dataSource = dataSources;
    if (mappedTraits.length) selectedFromUrl.mappedTraits = mappedTraits;

    window.selectedFacets = selectedFromUrl;
    selectedFacets = window.selectedFacets;
    syncSourceDraftFromApplied();

    if (scientificName) {
      const taxonSuggestion = buildTaxonSuggestionFromState(scientificName, taxonField);
      const builtScientificFilter = buildScientificFilterForText(scientificName, taxonField);
      if (taxonSuggestion && typeof window.setTaxonFilter === 'function') {
        window.setTaxonFilter(taxonSuggestion);
      } else {
        window.scientificNameSearchText = scientificName;
        window.taxonFilter = taxonSuggestion;
        window.scientificNameFilter = builtScientificFilter;
        if (typeof scientificNameFilter !== 'undefined') scientificNameFilter = builtScientificFilter;
        if ($('#scientificNameSearch').length) $('#scientificNameSearch').val(scientificName);
      }
    }

    if (params.has('presenceMode')) {
      portalFilters.presenceMode = normalizePresenceMode(presenceMode);
    }

    if (traitMode === 'all' || traitMode === 'simple') {
      portalFilters.traitMode = traitMode;
    }

    function readOptionalDecadeParam(key) {
      if (!params.has(key)) return null;
      const raw = String(params.get(key) || '').trim();
      if (!raw) return null;
      const value = Number(raw);
      if (!Number.isFinite(value) || value === 0) return null;
      return clampDecadeStart(value, key === 'decadeEnd' ? MAX_DECADE_START : DEFAULT_FILTER_DECADE_START);
    }

    portalFilters.selectedPhenophases = phenophases;
    const startYear = normalizeExplicitYear(params.get('startYear'));
    const endYear = normalizeExplicitYear(params.get('endYear'));
    if (startYear != null && endYear != null && startYear <= endYear) {
      portalFilters.startYear = startYear;
      portalFilters.endYear = endYear;
    } else if (startYear != null && endYear == null) {
      portalFilters.startYear = startYear;
      portalFilters.endYear = null;
    } else if (startYear == null && endYear != null) {
      portalFilters.startYear = null;
      portalFilters.endYear = endYear;
    } else {
      portalFilters.startYear = null;
      portalFilters.endYear = null;
    }
    const urlDecadeStart = readOptionalDecadeParam('decadeStart');
    const urlDecadeEnd = readOptionalDecadeParam('decadeEnd');
    if (urlDecadeStart != null) portalFilters.decadeStart = urlDecadeStart;
    if (urlDecadeEnd != null) portalFilters.decadeEnd = urlDecadeEnd;

    if (params.has('minLat') && params.has('maxLat') && params.has('minLon') && params.has('maxLon')) {
      const rawBounds = {
        minLat: String(params.get('minLat') || '').trim(),
        maxLat: String(params.get('maxLat') || '').trim(),
        minLon: String(params.get('minLon') || '').trim(),
        maxLon: String(params.get('maxLon') || '').trim(),
      };
      const numericBounds = [rawBounds.minLat, rawBounds.maxLat, rawBounds.minLon, rawBounds.maxLon].map(Number);
      const isLegacyZeroBounds = numericBounds.every((value) => Number.isFinite(value) && value === 0);

      if (!isLegacyZeroBounds) {
        const bounds = normalizeGeoBounds(rawBounds);
        portalFilters.geoBounds = isFullEarthBounds(bounds) ? null : bounds;
      }
    }
    getDecadeRangeFromState();
  }

  function updateYearRangeDisplay() {
    const el = document.getElementById('yearRangeDisplay');
    if (!el) return;
    if (hasExplicitYearRange()) {
      el.textContent = `Selected: ${explicitYearSelectionLabel()} (year filter)`;
      return;
    }
    const selection = getDecadeRangeFromState();
    const suffix = isFullDecadeRange() ? ' (all decades)' : '';
    el.textContent = `Selected: ${decadeSelectionLabel(selection)}${suffix}`;
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
    $('.trait-count-note').toggle(!simple);
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
      markFiltersPending();
      return;
    }

    clearTraitModeWarning();
    markFiltersPending();
  }

  function updateQuerySummary() {
    const el = document.getElementById('querySummary');
    if (!el) return;

    selectedFacets = window.selectedFacets || {};
    const parts = [];

    const nameSearchText = String(window.scientificNameSearchText || '').trim();
    if (nameSearchText) {
      parts.push(`Taxon: ${nameSearchText}`);
    }

    Object.entries(selectedFacets).forEach(([field, values]) => {
      const normalized = toArray(values).filter(Boolean);
      if (field === 'dataSource') {
        if (hasAppliedSourceState(selectedFacets) && !normalized.length) {
          parts.push('Source: none');
        } else if (!allKnownSourcesSelected(normalized)) {
          parts.push(`Source: ${formatList(normalized, 2)}`);
        }
        return;
      }
      if (!normalized.length) return;
      const fieldLabel = FIELD_LABELS[field] || ((field === 'dataSource') ? 'Source' : (field === 'mappedTraits' ? 'Traits' : field));
      parts.push(`${fieldLabel}: ${formatList(normalized, 2)}`);
    });

    if (hasExplicitYearRange()) {
      parts.push(`Year: ${explicitYearSelectionLabel()}`);
    } else if (!isFullDecadeRange()) {
      const selection = getDecadeRangeFromState();
      parts.push(`Decade: ${decadeSelectionLabel(selection)}`);
    }

    const presenceMode = normalizePresenceMode(portalFilters.presenceMode);
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

    if (sourceDraftChanged()) {
      parts.push('Source changes pending');
    } else if (filtersDirty) {
      parts.push('Pending apply');
    }

    el.textContent = parts.length ? `| ${parts.join(' | ')}` : '';
  }

  // Display names for chips
  const FIELD_LABELS = {
    dataSource: 'Data Source',
    mappedTraits: 'Trait',
    standardizedFamily: 'Family',
    genus: 'Genus',
  };

  // -----------------------
  // Query builders
  // -----------------------
  function buildFacetMustClauses(options = {}) {
    const must = [];
    const excludeFields = new Set(toArray(options.excludeFields));

    Object.entries(selectedFacets).forEach(([field, values]) => {
      if (excludeFields.has(field)) return;
      const cleaned = toArray(values).filter((v) => v != null && v !== '' && !(field === 'mappedTraits' && isHiddenTrait(v)));
      if (field === 'dataSource' && hasAppliedSourceState(selectedFacets) && !cleaned.length) {
        must.push({ term: { dataSource: '__NO_SOURCE_SELECTED__' } });
        return;
      }
      if (field === 'dataSource' && allKnownSourcesSelected(cleaned)) return;
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
    const explicitRange = getExplicitYearRange();
    if (explicitRange) {
      return { range: { year: explicitRange } };
    }

    const selection = getDecadeRangeFromState();
    const range = { gte: selection.decadeStart };
    if (isPre1960DecadeStart(selection.decadeStart) && isPre1960DecadeStart(selection.decadeEnd)) {
      range.lte = PRE_1960_DECADE_END;
      return { range: { decadeStart: range } };
    }
    if (selection.decadeEnd < MAX_DECADE_START) range.lte = selection.decadeEnd;
    return { range: { decadeStart: range } };
  }

  function buildPresenceClause() {
    const mode = normalizePresenceMode(portalFilters.presenceMode);
    if (mode !== 'present' && mode !== 'absent') return null;
    return { wildcard: { mappedTraits: `*${mode}` } };
  }

  function getPhenophaseMappedTraitTerms(options = {}) {
    if (getTraitMode() !== 'simple') return [];

    const selected = portalFilters.selectedPhenophases || [];
    if (!selected.length) return [];

    const mode = normalizePresenceMode(options.presenceMode || portalFilters.presenceMode);
    const terms = new Set();

    selected.forEach((phaseBase) => {
      const base = String(phaseBase || '').trim();
      if (!base) return;

      if (mode !== 'absent') terms.add(`${base} present`);
      if (mode !== 'present') terms.add(`${base} absent`);
    });

    return Array.from(terms);
  }

  function buildPhenophaseClause(options = {}) {
    const terms = getPhenophaseMappedTraitTerms(options);
    if (!terms.length) return null;

    return {
      bool: {
        should: terms.map((term) => ({ term: { mappedTraits: term } })),
        minimum_should_match: 1,
      },
    };
  }

  function buildDataSourceFacetQuery() {
    selectedFacets = window.selectedFacets || {};

    const must = [];

    must.push(...buildFacetMustClauses({ excludeFields: ['dataSource'] }));

    if (window.scientificNameFilter) {
      must.push(window.scientificNameFilter);
    }

    const dateClause = buildDateRangeClause();
    if (dateClause) must.push(dateClause);

    const presenceClause = buildPresenceClause();
    if (presenceClause) must.push(presenceClause);

    const phenophaseClause = buildPhenophaseClause();
    if (phenophaseClause) must.push(phenophaseClause);

    const geoClauses = buildGeoRangeClauses();
    must.push(...geoClauses);

    return must.length ? { bool: { must } } : { match_all: {} };
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
    const nonTemporalMust = [];

    const facetMust = buildFacetMustClauses();
    must.push(...facetMust);
    nonTemporalMust.push(...facetMust);

    if (window.scientificNameFilter) {
      must.push(window.scientificNameFilter);
      nonTemporalMust.push(window.scientificNameFilter);
    }

    const dateClause = buildDateRangeClause();
    if (dateClause) must.push(dateClause);

    const presenceClause = buildPresenceClause();
    if (presenceClause) {
      must.push(presenceClause);
      nonTemporalMust.push(presenceClause);
    }

    const phenophaseClause = buildPhenophaseClause();
    if (phenophaseClause) {
      must.push(phenophaseClause);
      nonTemporalMust.push(phenophaseClause);
    }

    const geoClauses = buildGeoRangeClauses();
    must.push(...geoClauses);
    nonTemporalMust.push(...geoClauses);

    rd.query = must.length ? { bool: { must } } : { match_all: {} };
    rd.aggs = rd.aggs || {};
    rd.aggs.decade_4 = {
      filter: nonTemporalMust.length ? { bool: { must: nonTemporalMust } } : { match_all: {} },
      aggs: {
        decades: {
          histogram: {
            field: 'decadeStart',
            interval: 10,
            min_doc_count: 0,
            extended_bounds: { min: MIN_DECADE_START, max: MAX_DECADE_START },
          },
        },
      },
    };
    window.requestData = rd;

    if (typeof window.updateDownloadLink === 'function') {
      window.updateDownloadLink();
    }

    syncPortalStateToUrl();
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

    if (field === 'dataSource') {
      updateSourceSelectionUi();
    }
    syncPresenceModeFromSelectedSources();
    markFiltersPending();
  }

  function removeFacet(field, value) {
    selectedFacets = window.selectedFacets || {};
    if (!selectedFacets[field]) return;

    selectedFacets[field] = selectedFacets[field].filter((v) => v !== value);
    if (!selectedFacets[field].length && field !== 'dataSource') delete selectedFacets[field];

    window.selectedFacets = selectedFacets;
    if (field === 'dataSource') {
      updateSourceSelectionUi();
    }
    syncPresenceModeFromSelectedSources();
    markFiltersPending();
  }

  window.addFacet = addFacet;
  window.removeFacet = removeFacet;
  window.updateQueryWithSelectedFacets = updateQueryWithSelectedFacets;
  window.initializePortalFiltersFromUrl = initializePortalFiltersFromUrl;
  window.buildDataSourceFacetQuery = buildDataSourceFacetQuery;
  window.applyPendingFilters = applyPendingFilters;
  window.markFiltersPending = markFiltersPending;
  window.flushPendingFilters = function flushPendingFilters() {
    if (filtersDirty || autoApplyTimer || sourceDraftChanged()) applyPendingFilters();
  };
  window.captureAppliedFilterState = captureAppliedFilterState;
  window.hasPendingFilterChanges = function hasPendingFilterChanges() {
    return !!(filtersDirty || sourceDraftChanged());
  };

  // -----------------------
  // Presence mode locking
  // -----------------------
  function syncPresenceModeFromSelectedSources() {
    selectedFacets = window.selectedFacets || {};
    const selectedSources = toArray(selectedFacets.dataSource);
    const lockToPresent = selectedSources.length > 0 && selectedSources.every(presentOnlySource);

    const inputs = document.querySelectorAll('input[name="presenceMode"]');
    const hint = document.getElementById('presenceModeHint');

    if (lockToPresent) {
      if (!presenceModeLocked && portalFilters.presenceMode !== 'present') {
        lastUnlockedPresenceMode = portalFilters.presenceMode;
      }
      presenceModeLocked = true;
      portalFilters.presenceMode = 'present';

      inputs.forEach((input) => {
        input.disabled = true;
      });
      syncPresenceInputsFromMode();

      if (hint) {
        hint.textContent = 'Selected data source(s) only provide present records.';
        hint.style.display = 'block';
      }
    } else {
      if (presenceModeLocked && portalFilters.presenceMode === 'present' && lastUnlockedPresenceMode) {
        portalFilters.presenceMode = lastUnlockedPresenceMode;
      }

      presenceModeLocked = false;
      inputs.forEach((input) => {
        input.disabled = false;
      });
      syncPresenceInputsFromMode();

      if (hint) {
        hint.textContent = '';
        hint.style.display = 'none';
      }
    }
  }

  function setAppliedSourceValues(values) {
    selectedFacets = window.selectedFacets || {};
    const normalized = normalizeSourceValues(values);

    selectedFacets.dataSource = normalized;

    window.selectedFacets = selectedFacets;
    syncPresenceModeFromSelectedSources();
  }

  function updateSourceGateUi(gated = sourceDraftChanged()) {
    const disabled = !!gated;
    const $gateControls = $([
      '#startYear',
      '#endYear',
      '#applyYearFilter',
      '#clearYearFilter',
      '#clearGeoBounds',
      '#setGeoBoundsOnMap',
      '#traitModeSimple',
      '#traitModeAll',
      '#clearAllFiltersButton',
      '#resetDraftFiltersButton',
      '#scientificNameSearch',
      '#clearTaxonSearch',
      '#phenophaseFilters input',
      '#allTraitsFilters input',
    ].join(','));

    $gateControls.prop('disabled', disabled);
    $('input[name="presenceMode"]').prop('disabled', disabled || presenceModeLocked);

    $('#phenophaseFilters, #allTraitsFilters, #yearRangeSlider')
      .toggleClass('is-source-gated', disabled)
      .attr('aria-disabled', disabled ? 'true' : null);
    $('#allTraitsFilters .facet-link, #selectedFacets .remove-facet')
      .toggleClass('is-source-gated', disabled)
      .attr('aria-disabled', disabled ? 'true' : null);
  }

  function requireSourceSelectionApplied() {
    if (!sourceDraftChanged()) return true;
    updateSourceSelectionUi();
    return false;
  }

  function updateSourceSelectionUi() {
    const draftValues = getDraftSourceValues();
    const draftSet = new Set(draftValues);
    const hasSourceState = hasAppliedSourceState();
    const changed = sourceDraftChanged();

    $('#dataSourceFacets .facet-option-check').each(function () {
      const value = String($(this).data('value') || '').trim();
      const checked = draftSet.has(value);
      this.checked = checked;
      $(this).closest('.facet-option-card').toggleClass('is-selected', checked);
    });

    const applyButton = document.getElementById('applySourceFilter');
    const clearButton = document.getElementById('clearSourceFilter');
    const message = document.getElementById('sourceFilterMessage');

    if (applyButton) applyButton.disabled = !changed;
    if (clearButton) clearButton.disabled = !draftValues.length;

    if (message) {
      if (changed && !draftValues.length) {
        message.textContent = 'No sources selected. Click Apply now before changing other filters.';
      } else if (changed) {
        message.textContent = `${draftValues.length} source${draftValues.length === 1 ? '' : 's'} selected. Click Apply now before changing other filters.`;
      } else if (hasSourceState && !draftValues.length) {
        message.textContent = 'No sources selected.';
      } else if (allKnownSourcesSelected(draftValues)) {
        message.textContent = 'All sources selected.';
      } else if (draftValues.length) {
        message.textContent = `${draftValues.length} source${draftValues.length === 1 ? '' : 's'} applied.`;
      } else {
        message.textContent = '';
      }
      message.classList.toggle('is-dirty', changed);
    }

    updateSourceGateUi(changed);
  }

  function applyDraftSourceSelection() {
    if (!sourceDraftChanged()) {
      updateSourceSelectionUi();
      return;
    }

    applyPendingFilters();
  }

  function clearSourceSelection() {
    if (!getDraftSourceValues().length) {
      updateSourceSelectionUi();
      return;
    }

    setSourceDraftValues([]);
    cancelAutoApplyForSourceDraft();
    updateSourceSelectionUi();
    renderSelectedFacets();
    updateQuerySummary();
  }

  // -----------------------
  // Custom controls UI
  // -----------------------
  function renderPhenophaseFilters() {
    const container = document.getElementById('phenophaseFilters');
    if (!container) return;

    const selected = selectedPhenophasesSet();

    const html = PHENOPHASE_CATEGORIES.map((cat) => {
      const selectedInCategory = cat.phases.filter((p) => selected.has(p.key)).length;
      const options = cat.phases.map((phase) => {
        const checked = selected.has(phase.key) ? 'checked' : '';
        return `
          <label class="phenophase-option">
            <input type="checkbox" class="phenophase-check" data-phase="${phase.key}" ${checked}>
            ${phase.label}
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

  function decadeCountFor(decadeStart) {
    return decadeCountsByStart.get(decadeStart) || 0;
  }

  function updateDecadeCountLookup(aggregations) {
    decadeCountsByStart.clear();
    DECADE_STARTS.forEach((decadeStart) => decadeCountsByStart.set(decadeStart, 0));

    const buckets = aggregations?.decade_4?.decades?.buckets || aggregations?.decade_4?.buckets || [];
    buckets.forEach((bucket) => {
      const decadeStart = Math.floor(Number(bucket?.key) / 10) * 10;
      const count = bucket?.doc_count || 0;
      if (decadeStart < 1960) {
        decadeCountsByStart.set(PRE_1960_DECADE_START, (decadeCountsByStart.get(PRE_1960_DECADE_START) || 0) + count);
        return;
      }
      if (!decadeCountsByStart.has(decadeStart)) return;
      decadeCountsByStart.set(decadeStart, count);
    });

    maxDecadeCount = Math.max(0, ...Array.from(decadeCountsByStart.values()));
  }

  function decadeLabelStride() {
    if (DECADE_STARTS.length <= 10) return 1;
    if (DECADE_STARTS.length <= 16) return 2;
    if (DECADE_STARTS.length <= 24) return 3;
    return 4;
  }

  function updateDecadeSliderAccessibility() {
    const selection = getDecadeRangeFromState();
    const values = [selection.decadeStart, selection.decadeEnd];

    $('#yearRangeSlider .ui-slider-handle').each(function (index) {
      const decadeStart = values[index];
      const count = decadeCountFor(decadeStart);
      const label = formatDecadeLabel(decadeStart);
      const thumbLabel = index === 0 ? 'Start decade' : 'End decade';
      const countLabel = `${count.toLocaleString()} record${count === 1 ? '' : 's'}`;
      this.setAttribute('aria-label', thumbLabel);
      this.setAttribute('aria-valuetext', `${label}, ${countLabel}`);
      this.setAttribute('title', `${thumbLabel}: ${label} (${countLabel})`);
    });
  }

  function renderDecadeMarks() {
    const container = document.getElementById('yearRangeMarks');
    if (!container) return;

    const selection = getDecadeRangeFromState();
    const stride = decadeLabelStride();

    container.innerHTML = DECADE_STARTS.map((decadeStart, index) => {
      const count = decadeCountFor(decadeStart);
      const barHeight = maxDecadeCount ? Math.max(2, Math.round((count / maxDecadeCount) * 18)) : 2;
      const isSelected = decadeStart >= selection.decadeStart && decadeStart <= selection.decadeEnd;
      const showLabel = index === 0 || index === DECADE_STARTS.length - 1 || index % stride === 0 || isSelected;
      const label = showLabel ? formatDecadeLabel(decadeStart) : '';
      const title = `${formatDecadeLabel(decadeStart)}: ${count.toLocaleString()} record${count === 1 ? '' : 's'}`;

      return `
        <div class="decade-mark ${isSelected ? 'is-selected' : ''} ${count === 0 ? 'is-zero' : ''}" title="${title}">
          <div class="decade-mark-bar-wrap">
            <span class="decade-mark-bar" style="height:${barHeight}px;"></span>
          </div>
          <div class="decade-mark-label">${label}</div>
        </div>
      `;
    }).join('');
  }

  function setYearValidationMessage(message) {
    const el = document.getElementById('yearValidationMessage');
    if (!el) return;
    el.textContent = message || '';
  }

  function validateYearInputs() {
    const rawStart = String($('#startYear').val() || '').trim();
    const rawEnd = String($('#endYear').val() || '').trim();

    function parseInput(raw, label) {
      if (!raw) return { value: null };
      const value = Number(raw);
      if (!Number.isInteger(value)) {
        return { error: `${label} must be a whole year.` };
      }
      if (value < SELECTOR_MIN_YEAR || value > CURRENT_YEAR) {
        return { error: `${label} must be between ${SELECTOR_MIN_YEAR} and ${CURRENT_YEAR}.` };
      }
      return { value };
    }

    const start = parseInput(rawStart, 'Start year');
    if (start.error) return { valid: false, message: start.error };

    const end = parseInput(rawEnd, 'End year');
    if (end.error) return { valid: false, message: end.error };

    if (start.value != null && end.value != null && start.value > end.value) {
      return {
        valid: false,
        message: 'Start year must be before or equal to end year.',
      };
    }

    return {
      valid: true,
      startYear: start.value,
      endYear: end.value,
      message: '',
    };
  }

  function syncUiFromState() {
    const bounds = normalizeGeoBounds(portalFilters.geoBounds);
    const hint = document.getElementById('geoFilterHint');
    if (hint) {
      hint.textContent = bounds
        ? `Southwest: ${formatCorner(bounds.minLat, bounds.minLon)} | Northeast: ${formatCorner(bounds.maxLat, bounds.maxLon)}`
        : '';
    }

    syncPresenceInputsFromMode();

    const selection = getDecadeRangeFromState();
    const $yearSlider = $('#yearRangeSlider');
    if (yearSliderInitialized && $yearSlider.length && $yearSlider.hasClass('ui-slider')) {
      $yearSlider.slider('values', [selection.decadeStartIndex, selection.decadeEndIndex]);
    }
    updateYearRangeDisplay();
    renderDecadeMarks();
    updateDecadeSliderAccessibility();
    if ($('#startYear').length) $('#startYear').val(portalFilters.startYear != null ? String(portalFilters.startYear) : '');
    if ($('#endYear').length) $('#endYear').val(portalFilters.endYear != null ? String(portalFilters.endYear) : '');
    setYearValidationMessage('');

    updateTraitModeUi();
    renderPhenophaseFilters();
    syncPresenceModeFromSelectedSources();
    updateSourceSelectionUi();
    updateQuerySummary();
  }

  function resetCustomFilters() {
    portalFilters.decadeStart = DEFAULT_FILTER_DECADE_START;
    portalFilters.decadeEnd = MAX_DECADE_START;
    portalFilters.startYear = null;
    portalFilters.endYear = null;
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
      renderDecadeMarks();
      return;
    }

    const selection = getDecadeRangeFromState();
    $yearSlider.slider({
      range: true,
      min: 0,
      max: Math.max(0, DECADE_STARTS.length - 1),
      step: 1,
      values: [selection.decadeStartIndex, selection.decadeEndIndex],
      create: function () {
        updateDecadeSliderAccessibility();
      },
      slide: function (_event, ui) {
        if (!requireSourceSelectionApplied()) return false;
        portalFilters.decadeStart = DECADE_STARTS[ui.values[0]];
        portalFilters.decadeEnd = DECADE_STARTS[ui.values[1]];
        updateYearRangeDisplay();
        renderDecadeMarks();
        updateDecadeSliderAccessibility();
        updateQuerySummary();
      },
      stop: function (_event, ui) {
        if (!requireSourceSelectionApplied()) return false;
        portalFilters.decadeStart = DECADE_STARTS[ui.values[0]];
        portalFilters.decadeEnd = DECADE_STARTS[ui.values[1]];
        updateDecadeSliderAccessibility();
        markFiltersPending();
      },
    });

    yearSliderInitialized = true;
    updateYearRangeDisplay();
    renderDecadeMarks();
    updateDecadeSliderAccessibility();
  }

  function bindCustomControls() {
    if (initializedCustomControls) return;

    const $presence = $('input[name="presenceMode"]');
    const $clearGeo = $('#clearGeoBounds');
    const $setGeoOnMap = $('#setGeoBoundsOnMap');
    const $traitModeSimple = $('#traitModeSimple');
    const $traitModeAll = $('#traitModeAll');
    const $applyFilters = $('#applyFiltersButton');
    const $clearAllFilters = $('#clearAllFiltersButton');
    const $resetDraft = $('#resetDraftFiltersButton');
    const $applyYearFilter = $('#applyYearFilter');
    const $clearYearFilter = $('#clearYearFilter');
    const $yearInputs = $('#startYear, #endYear');
    const $applySourceFilter = $('#applySourceFilter');
    const $clearSourceFilter = $('#clearSourceFilter');

    window.onMapBBoxSelected = function (bounds) {
      if (!requireSourceSelectionApplied()) return;
      portalFilters.geoBounds = normalizeGeoBounds(bounds);
      syncUiFromState();
      markFiltersPending();
    };

    window.onMapBBoxCleared = function () {
      if (!requireSourceSelectionApplied()) return;
      if (!portalFilters.geoBounds) return;
      portalFilters.geoBounds = null;
      syncUiFromState();
      markFiltersPending();
    };

    initializeYearSlider();

    $applyYearFilter.on('click', function () {
      if (!requireSourceSelectionApplied()) return;
      const result = validateYearInputs();
      if (!result.valid) {
        setYearValidationMessage(result.message);
        return;
      }
      portalFilters.startYear = result.startYear;
      portalFilters.endYear = result.endYear;
      setYearValidationMessage('');
      syncUiFromState();
      markFiltersPending();
    });

    $clearYearFilter.on('click', function () {
      if (!requireSourceSelectionApplied()) return;
      portalFilters.startYear = null;
      portalFilters.endYear = null;
      setYearValidationMessage('');
      syncUiFromState();
      markFiltersPending();
    });

    $yearInputs.on('keydown', function (event) {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      $applyYearFilter.trigger('click');
    });

    $yearInputs.on('input', function () {
      setYearValidationMessage('');
    });

    $applySourceFilter.on('click', function () {
      applyDraftSourceSelection();
    });

    $clearSourceFilter.on('click', function () {
      clearSourceSelection();
    });

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
      if (!requireSourceSelectionApplied()) return;
      switchTraitMode('simple', { fromUser: true });
    });

    $traitModeAll.on('click', function () {
      if (!requireSourceSelectionApplied()) return;
      switchTraitMode('all', { fromUser: true });
    });

    $presence.on('change', function () {
      if (!requireSourceSelectionApplied()) {
        syncUiFromState();
        return;
      }
      if (presenceModeLocked) {
        syncPresenceInputsFromMode();
        return;
      }
      const nextPresenceMode = presenceModeFromInputs();
      if (!nextPresenceMode) {
        syncPresenceInputsFromMode();
        return;
      }
      portalFilters.presenceMode = nextPresenceMode;
      lastUnlockedPresenceMode = portalFilters.presenceMode;
      syncPresenceInputsFromMode();
      markFiltersPending();
    });

    $('#phenophaseFilters').on('change', '.phenophase-check', function () {
      if (!requireSourceSelectionApplied()) {
        renderPhenophaseFilters();
        return;
      }
      const phase = normalizeLower($(this).data('phase'));
      const selected = selectedPhenophasesSet();
      if (this.checked) selected.add(phase);
      else selected.delete(phase);
      portalFilters.selectedPhenophases = Array.from(selected);
      markFiltersPending();
    });

    $clearGeo.on('click', function () {
      if (!requireSourceSelectionApplied()) return;
      portalFilters.geoBounds = null;
      if (typeof window.clearSelectedBoundingBoxOverlay === 'function') {
        window.clearSelectedBoundingBoxOverlay();
      }
      syncUiFromState();
      markFiltersPending();
    });

    $setGeoOnMap.on('click', function () {
      if (!requireSourceSelectionApplied()) return;
      $('#showMap').trigger('click');

      const mapReady = typeof window.ensurePhenobaseMapLoaded === 'function'
        ? window.ensurePhenobaseMapLoaded()
        : Promise.resolve();

      mapReady.then(function () {
        if (typeof window.startBoundingBoxSelection !== 'function') {
          return;
        }

        window.startBoundingBoxSelection({
          onComplete: function (bounds) {
            portalFilters.geoBounds = normalizeGeoBounds(bounds);
            syncUiFromState();
            markFiltersPending();
          },
          onCancel: function () {},
        });
      }).catch(function (error) {
        console.error('Failed to load map before bounding-box selection:', error);
      });
    });

    $applyFilters.on('click', function () {
      applyPendingFilters();
    });

    $resetDraft.on('click', function () {
      if (!appliedFilterState) return;
      applyFilterStateSnapshot(appliedFilterState);
      syncUiFromState();
      renderSelectedFacets();
      recomputeFilterDirtyState();
      updateQuerySummary();
    });

    $clearAllFilters.on('click', function () {
      if (!requireSourceSelectionApplied()) return;
      window.selectedFacets = availableDataSources.length
        ? { dataSource: availableDataSources.slice() }
        : {};
      selectedFacets = window.selectedFacets;
      syncSourceDraftFromApplied();

      if (typeof window.clearTaxonFilter === 'function') {
        window.clearTaxonFilter();
      } else {
        if (typeof window.scientificNameFilter !== 'undefined') window.scientificNameFilter = null;
        if (typeof window.scientificNameSearchText !== 'undefined') window.scientificNameSearchText = '';
        window.taxonFilter = null;
        if ($('#scientificNameSearch').length) $('#scientificNameSearch').val('');
      }

      resetCustomFilters();
      syncUiFromState();
      markFiltersPending();
    });

    initializedCustomControls = true;
    syncUiFromState();
    refreshFilterApplyUi();
  }

  // -----------------------
  // Selected chips
  // -----------------------
  function renderSelectedFacets() {
    selectedFacets = window.selectedFacets || {};

    const $wrap = $('#selectedFacets');
    $wrap.empty();

    const chips = [];

    const taxonSearchText = String(window.scientificNameSearchText || '').trim();
    if (taxonSearchText) {
      const fieldLabel = window.taxonFilter?.field === 'standardizedFamily' || window.taxonFilter?.field === 'family'
        ? 'Family'
        : (window.taxonFilter?.field === 'genus' ? 'Genus' : 'Taxon');
      chips.push({
        html: `
          <span class="selected-facet" data-custom="taxon-filter">
            <strong>${fieldLabel}:</strong> ${taxonSearchText}
            <span class="remove-facet" title="Remove" aria-label="Remove filter">x</span>
          </span>
        `,
      });
    }

    Object.entries(selectedFacets).forEach(([field, values = []]) => {
      const normalizedValues = toArray(values).filter(Boolean);
      if (field === 'dataSource') {
        const sourceValues = sourceDraftChanged() ? getDraftSourceValues() : normalizedValues;
        if (!sourceValues.length) {
          chips.push({
            html: `
              <span class="selected-facet" data-custom="source-selection-empty">
                <strong>Source:</strong> none
                <span class="remove-facet" title="Select all sources" aria-label="Select all sources">x</span>
              </span>
            `,
          });
        }
        if (!sourceValues.length || allKnownSourcesSelected(sourceValues)) return;
        sourceValues.forEach((val) => {
          chips.push({
            html: `
              <span class="selected-facet" data-field="${field}" data-value="${val}">
                <strong>${FIELD_LABELS[field] || field}:</strong> ${val}
                <span class="remove-facet" title="Remove" aria-label="Remove filter">x</span>
              </span>
            `,
          });
        });
        return;
      }
      const label = FIELD_LABELS[field] || field;
      normalizedValues.forEach((val) => {
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

    if (hasExplicitYearRange()) {
      chips.push({
        html: `
          <span class="selected-facet" data-custom="year-range">
            <strong>Year:</strong> ${explicitYearSelectionLabel()}
            <span class="remove-facet" title="Remove" aria-label="Remove filter">x</span>
          </span>
        `,
      });
    } else if (!isFullDecadeRange()) {
      const selection = getDecadeRangeFromState();
      chips.push({
        html: `
          <span class="selected-facet" data-custom="year-range">
            <strong>Decade:</strong> ${decadeSelectionLabel(selection)}
            <span class="remove-facet" title="Remove" aria-label="Remove filter">x</span>
          </span>
        `,
      });
    }

    const selectedPresenceMode = normalizePresenceMode(portalFilters.presenceMode);
    if (selectedPresenceMode !== 'both') {
      chips.push({
        html: `
          <span class="selected-facet" data-custom="presence-mode">
            <strong>Presence:</strong> ${selectedPresenceMode}
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

    $wrap.off('click', '.remove-facet').on('click', '.remove-facet', function (e) {
      e.preventDefault();
      e.stopPropagation();

      const $p = $(this).closest('.selected-facet');
      const customType = $p.data('custom');

      if (customType) {
        if (customType !== 'source-selection-empty' && !requireSourceSelectionApplied()) return;
        if (customType === 'year-range' || customType === 'date-range') {
          if (hasExplicitYearRange()) {
            portalFilters.startYear = null;
            portalFilters.endYear = null;
          } else {
            portalFilters.decadeStart = DEFAULT_FILTER_DECADE_START;
            portalFilters.decadeEnd = MAX_DECADE_START;
          }
        } else if (customType === 'taxon-filter') {
          if (typeof window.clearTaxonFilter === 'function') {
            window.clearTaxonFilter();
          } else {
            window.scientificNameFilter = null;
            window.scientificNameSearchText = '';
            window.taxonFilter = null;
            if ($('#scientificNameSearch').length) $('#scientificNameSearch').val('');
          }
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
        } else if (customType === 'source-selection-empty') {
          if (sourceDraftChanged()) {
            setSourceDraftValues(availableDataSources);
            cancelAutoApplyForSourceDraft();
            updateSourceSelectionUi();
            renderSelectedFacets();
            updateQuerySummary();
            return;
          }
          setAppliedSourceValues(availableDataSources);
          syncSourceDraftFromApplied();
        }

        syncUiFromState();
        markFiltersPending({ delayMs: customType === 'source-selection-empty' ? 0 : undefined });
        return;
      }

      const field = $p.data('field');
      const value = $p.data('value');
      if (field === 'dataSource') {
        const nextValues = getDraftSourceValues().filter((sourceValue) => sourceValue !== value);
        setSourceDraftValues(nextValues);
        cancelAutoApplyForSourceDraft();
        updateSourceSelectionUi();
        renderSelectedFacets();
        updateQuerySummary();
        return;
      }
      if (!requireSourceSelectionApplied()) return;
      removeFacet(field, value);
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

    let allBuckets = aggregation.buckets.filter((bucket) => !(field === 'mappedTraits' && isHiddenTrait(bucket.key)));
    if (field === 'dataSource') {
      const existingValues = new Set(allBuckets.map((bucket) => String(bucket?.key || '')));
      getDraftSourceValues().forEach((value) => {
        const sourceValue = String(value || '').trim();
        if (!sourceValue || existingValues.has(sourceValue)) return;
        allBuckets = allBuckets.concat([{ key: sourceValue, doc_count: 0 }]);
        existingValues.add(sourceValue);
      });
    }
    const limit = FACET_PREVIEW_LIMITS[field] || null;
    const expanded = !!facetExpandedState[field];

    let bucketsToRender = allBuckets;
    if (limit && !expanded) {
      bucketsToRender = allBuckets.slice(0, limit);

      // Keep any selected values visible even if they are outside the top preview slice.
      const selectedValues = new Set(field === 'dataSource' ? getDraftSourceValues() : toArray(selectedFacets[field]));
      if (selectedValues.size) {
        allBuckets.forEach((bucket) => {
          if (!selectedValues.has(bucket.key)) return;
          if (!bucketsToRender.some((b) => b.key === bucket.key)) bucketsToRender.push(bucket);
        });
      }
    }

    if (field === 'dataSource') {
      const draftSourceValues = new Set(getDraftSourceValues());
      bucketsToRender.forEach((bucket) => {
        const key = bucket.key;
        const isSelected = draftSourceValues.has(key);
        const countFormatted = (bucket.doc_count || 0).toLocaleString();

        $c.append(`
          <label class="facet-option-card ${isSelected ? 'is-selected' : ''}" data-field="${field}" data-value="${key}">
            <input type="checkbox" class="facet-option-check" data-field="${field}" data-value="${key}" ${isSelected ? 'checked' : ''}>
            <span class="facet-option-text">${key}</span>
            <span class="facet-option-count">(${countFormatted})</span>
          </label>
        `);
      });
    } else {
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
    }

    if (limit && allBuckets.length > limit) {
      const toggleLabel = expanded ? 'see less' : 'see more';
      $c.append(`<a href="#" class="facet-see-more" data-field="${field}"><em>${toggleLabel}</em></a>`);
    }

    $c.find('.facet-link').off('click').on('click', function (e) {
      e.preventDefault();
      if (!requireSourceSelectionApplied()) return;
      const field = $(this).data('field');
      const value = $(this).data('value');
      if (!$(this).hasClass('selected')) addFacet(field, value);
    });

    $c.off('change', '.facet-option-check').on('change', '.facet-option-check', function () {
      const targetField = $(this).data('field');
      const targetValue = $(this).data('value');
      if (targetField === 'dataSource') {
        const draftValues = getDraftSourceValues();
        const nextValues = this.checked
          ? draftValues.concat([targetValue])
          : draftValues.filter((value) => value !== targetValue);
        setSourceDraftValues(nextValues);
        cancelAutoApplyForSourceDraft();
        updateSourceSelectionUi();
        renderSelectedFacets();
        updateQuerySummary();
        return;
      }
      if (!requireSourceSelectionApplied()) {
        this.checked = !this.checked;
        return;
      }
      if (this.checked) addFacet(targetField, targetValue);
      else removeFacet(targetField, targetValue);
    });

    $c.off('click', '.facet-see-more').on('click', '.facet-see-more', function (e) {
      e.preventDefault();
      if (!requireSourceSelectionApplied()) return;
      const targetField = String($(this).data('field') || '');
      if (!FACET_PREVIEW_LIMITS[targetField]) return;
      facetExpandedState[targetField] = !facetExpandedState[targetField];
      renderFacetLinks(aggregation, container, field);
    });

    $c.off('click', '.remove-facet').on('click', '.remove-facet', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (!requireSourceSelectionApplied()) return;
      const field = $(this).data('field');
      const value = $(this).data('value');
      removeFacet(field, value);
    });

    if (field === 'dataSource') updateSourceSelectionUi();
  }

  function updateAvailableDataSources(aggregations) {
    availableDataSources = (aggregations?.datasource_0?.buckets || [])
      .map((bucket) => String(bucket?.key || '').trim())
      .filter(Boolean);
  }

  function ensureDefaultSourceSelection() {
    selectedFacets = window.selectedFacets || {};
    if (hasAppliedSourceState(selectedFacets) || !availableDataSources.length) return false;

    selectedFacets.dataSource = availableDataSources.slice();
    window.selectedFacets = selectedFacets;
    syncPresenceModeFromSelectedSources();
    if (!(filtersDirty || autoApplyTimer || autoApplyInFlight)) {
      updateQueryWithSelectedFacets();
      captureAppliedFilterState();
    }
    return true;
  }

  function mergeDataSourceFacetAggregation(filteredAggregation, allSourceAggregation) {
    const filteredBuckets = filteredAggregation?.buckets || [];
    const allBuckets = allSourceAggregation?.buckets || [];
    const countsBySource = new Map();
    const orderedSources = [];
    const seen = new Set();

    filteredBuckets.forEach((bucket) => {
      const key = String(bucket?.key || '').trim();
      if (!key) return;
      countsBySource.set(key, bucket?.doc_count || 0);
    });

    const addSource = (value) => {
      const key = String(value || '').trim();
      if (!key || seen.has(key)) return;
      seen.add(key);
      orderedSources.push(key);
    };

    allBuckets.forEach((bucket) => addSource(bucket?.key));
    availableDataSources.forEach(addSource);
    filteredBuckets.forEach((bucket) => addSource(bucket?.key));
    getAppliedSourceValues().forEach(addSource);

    return {
      ...(filteredAggregation || {}),
      buckets: orderedSources.map((key) => ({
        key,
        doc_count: countsBySource.get(key) || 0,
      })),
    };
  }

  function currentFacetSignature() {
    if (typeof window.getCurrentQuerySignature === 'function') {
      return window.getCurrentQuerySignature();
    }
    try {
      return JSON.stringify(window.requestData?.query || { match_all: {} });
    } catch (_error) {
      return String(Date.now());
    }
  }

  function cacheFacetAggregations(aggregations) {
    const existing = window.lastFacetStatsAggregations || {};
    window.lastFacetStatsAggregations = {
      ...existing,
      ...aggregations,
    };
    window.lastFacetStatsSignature = currentFacetSignature();
  }

  function renderDataSourceFacetAggregation(aggregation, allSourceAggregation) {
    if (!aggregation?.buckets) return;
    selectedFacets = window.selectedFacets || {};
    updateAvailableDataSources({ datasource_0: allSourceAggregation?.buckets ? allSourceAggregation : aggregation });
    ensureDefaultSourceSelection();
    renderFacetLinks(mergeDataSourceFacetAggregation(aggregation, allSourceAggregation), '#dataSourceFacets', 'dataSource');
  }

  function renderDataSourceFacetLoading(message) {
    $('#dataSourceFacets').html(
      `<div class="facet-loading-state">${message || 'Loading data sources...'}</div>`
    );
  }

  // -----------------------
  // Main entry from facet-data success
  // -----------------------
  function renderFacets(aggregations) {
    selectedFacets = window.selectedFacets || {};
    cacheFacetAggregations(aggregations || {});

    $('#allTraitsFilters').empty();

    const traitAgg = { buckets: (aggregations?.mappedTraits_1?.buckets || []) };
    renderFacetLinks(traitAgg, '#allTraitsFilters', 'mappedTraits');

    updateDecadeCountLookup(aggregations);
    syncUiFromState();

    renderSelectedFacets();
    updateQuerySummary();

    if (typeof window.onFacetStatsAggregationsAvailable === 'function') {
      window.onFacetStatsAggregationsAvailable(window.lastFacetStatsAggregations || aggregations);
    }
  }

  window.renderFacets = renderFacets;
  window.renderDataSourceFacetAggregation = renderDataSourceFacetAggregation;
  window.renderDataSourceFacetLoading = renderDataSourceFacetLoading;

  $(document).ready(function () {
    bindCustomControls();
    captureAppliedFilterState();
  });
})();
