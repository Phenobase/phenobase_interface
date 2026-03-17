// Leaflet init & base layers
var map = L.map('map').setView([0, 0], 2);
const baseLayers = {
  "Regular": L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap contributors' }),
  "Topo": L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenTopoMap contributors' }),
  "Satellite": L.tileLayer('https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', { maxZoom: 18, subdomains: ['mt0', 'mt1', 'mt2', 'mt3'], attribution: '© Google' }),
};
baseLayers.Regular.addTo(map);
L.control.layers(baseLayers).addTo(map);

var markersCluster = L.markerClusterGroup().addTo(map);
var mapDotsLayer = L.featureGroup().addTo(map);
var mapDotRenderer = L.canvas({ padding: 0.4 });

const MAP_MAX_POINTS = 10000;
const MAP_BATCH_SIZE = 2000;
const MAP_SOURCE_FIELDS = ["latitude", "longitude", "scientificName", "mappedTraits", "year", "dataSource"];

var mapLoadState = {
  runId: 0,
  signature: '',
  loading: false,
  completed: false,
  loadedRecords: 0,
  uniqueDots: 0,
  totalHits: null,
  markersByKey: new Map(),
};

var selectedBoundsRectangle = null;
var drawHandlers = null;
var bboxToolControl = null;
var bboxToolContainer = null;
var bboxToolArmButton = null;
var bboxToolCancelButton = null;
var bboxToolRenderButton = null;
var bboxDraw = {
  workflowActive: false,
  armed: false,
  drawing: false,
  startLatLng: null,
  startContainerPoint: null,
  previewRectangle: null,
  onComplete: null,
  onCancel: null,
};

function getMapHelpEl() {
  return document.getElementById('mapDrawHelp');
}

function showMapHelp(message) {
  const help = getMapHelpEl();
  if (!help) return;
  help.textContent = message;
  help.style.display = 'block';
}

function hideMapHelp() {
  const help = getMapHelpEl();
  if (!help) return;
  help.style.display = 'none';
  help.textContent = '';
}

function getMapLoadStatusEl() {
  return document.getElementById('mapLoadStatus');
}

function setMapLoadStatus(message, isError) {
  const el = getMapLoadStatusEl();
  if (!el) return;
  if (!message) {
    el.textContent = '';
    el.style.display = 'none';
    el.classList.remove('error');
    return;
  }
  el.textContent = message;
  el.style.display = 'block';
  el.classList.toggle('error', !!isError);
}

function getMapQuerySignature() {
  try {
    return JSON.stringify(window.requestData?.query || { match_all: {} });
  } catch (_e) {
    return String(Date.now());
  }
}

function mapRequestBody() {
  return {
    query: window.requestData?.query || { match_all: {} },
    _source: MAP_SOURCE_FIELDS,
    track_total_hits: true,
  };
}

function mapSearchUrl(size, from) {
  const root = (window.apiUrl || '').split('?')[0] || 'https://biscicol.org/phenobase/api/v1/query//phenobase2/_search';
  return `${root}?size=${size}&from=${from}`;
}

function fetchMapBatch(size, from) {
  return new Promise((resolve, reject) => {
    $.ajax({
      url: mapSearchUrl(size, from),
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify(mapRequestBody()),
      dataType: 'json',
      success: resolve,
      error: reject,
    });
  });
}

function dotRadius(count) {
  if (count >= 100) return 6;
  if (count >= 25) return 5;
  if (count >= 10) return 4;
  if (count >= 3) return 3;
  return 2.5;
}

function dotPopupHtml(info) {
  const count = Number(info.count || 0).toLocaleString();
  const sampleName = info.sampleScientificName ? `<div><strong>Example:</strong> ${info.sampleScientificName}</div>` : '';
  const sampleSource = info.sampleSource ? `<div><strong>Source:</strong> ${info.sampleSource}</div>` : '';
  return `<div><strong>${count}</strong> records at this location${sampleName}${sampleSource}</div>`;
}

function clearMapDots() {
  mapDotsLayer.clearLayers();
  mapLoadState.markersByKey = new Map();
  mapLoadState.uniqueDots = 0;
}

function addDotForSource(lat, lon, src) {
  const key = `${lat.toFixed(5)},${lon.toFixed(5)}`;
  const existing = mapLoadState.markersByKey.get(key);

  if (existing) {
    existing.count += 1;
    existing.marker.setStyle({ radius: dotRadius(existing.count) });
    return;
  }

  const info = {
    lat,
    lon,
    count: 1,
    sampleScientificName: String(src?.scientificName || ''),
    sampleSource: String(src?.dataSource || ''),
    marker: null,
  };

  const marker = L.circleMarker([lat, lon], {
    renderer: mapDotRenderer,
    radius: dotRadius(1),
    stroke: false,
    fillColor: '#1d4ed8',
    fillOpacity: 0.7,
  });

  marker.on('popupopen', function () {
    marker.setPopupContent(dotPopupHtml(info));
  });
  marker.bindPopup(dotPopupHtml(info));
  marker.addTo(mapDotsLayer);

  info.marker = marker;
  mapLoadState.markersByKey.set(key, info);
  mapLoadState.uniqueDots += 1;
}

async function processHitsAsDots(hits, runId) {
  const chunkSize = 500;

  for (let i = 0; i < hits.length; i += chunkSize) {
    if (runId !== mapLoadState.runId) return false;
    const slice = hits.slice(i, i + chunkSize);

    slice.forEach((doc) => {
      const src = doc?._source || {};
      const lat = Number(src.latitude);
      const lon = Number(src.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
      addDotForSource(lat, lon, src);
    });

    // Yield to keep the UI responsive while adding many points.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  return true;
}

function clearMapLoadingState() {
  mapLoadState.loading = false;
  mapLoadState.completed = false;
  mapLoadState.loadedRecords = 0;
  mapLoadState.totalHits = null;
}

function cancelMapDataLoading() {
  mapLoadState.runId += 1;
  mapLoadState.loading = false;
}

function clearMapPointLayers() {
  clearMapDots();
  markersCluster.clearLayers();
}

function markMapNeedsRender() {
  const signature = getMapQuerySignature();
  const signatureChanged = mapLoadState.signature !== signature;

  if (signatureChanged) {
    cancelMapDataLoading();
    clearMapLoadingState();
    mapLoadState.signature = signature;
    clearMapPointLayers();
  }

  if (!mapLoadState.loading && !mapLoadState.completed) {
    setMapLoadStatus(`Click \"Show Results\" to update the map interface for the current filters and bounds.`);
  }
}

function mapErrorMessage(error) {
  const backendReason = error?.responseJSON?.error?.reason || error?.responseJSON?.error?.root_cause?.[0]?.reason;
  const fallback = error?.statusText || 'Map load failed.';
  return backendReason || fallback;
}

async function loadMapDataIncrementally(force) {
  const isMapVisible = $('#mapContainer').is(':visible');
  if (!isMapVisible) return;

  const signature = getMapQuerySignature();
  if (!force && mapLoadState.signature === signature && (mapLoadState.loading || mapLoadState.completed)) {
    return;
  }

  cancelMapDataLoading();
  const runId = mapLoadState.runId;

  mapLoadState.signature = signature;
  mapLoadState.loading = true;
  mapLoadState.completed = false;
  mapLoadState.loadedRecords = 0;
  mapLoadState.totalHits = null;

  clearMapPointLayers();

  setMapLoadStatus('Loading map points...');

  let offset = 0;
  let loaded = 0;
  let reachedMax = false;

  while (loaded < MAP_MAX_POINTS) {
    if (runId !== mapLoadState.runId) return;

    const size = Math.min(MAP_BATCH_SIZE, MAP_MAX_POINTS - loaded);
    let response;

    try {
      response = await fetchMapBatch(size, offset);
    } catch (err) {
      if (runId !== mapLoadState.runId) return;
      mapLoadState.loading = false;
      const reason = mapErrorMessage(err);
      if (String(reason).toLowerCase().includes('max_result_window')) {
        setMapLoadStatus(`Map loading hit backend pagination limit before reaching ${MAP_MAX_POINTS.toLocaleString()} records.`, true);
      } else {
        setMapLoadStatus(`Map loading error: ${reason}`, true);
      }
      return;
    }

    if (runId !== mapLoadState.runId) return;

    const totalObj = response?.hits?.total;
    if (totalObj && typeof totalObj.value === 'number') {
      mapLoadState.totalHits = totalObj.value;
    }

    const hits = response?.hits?.hits || [];
    if (!hits.length) break;

    const processed = await processHitsAsDots(hits, runId);
    if (!processed || runId !== mapLoadState.runId) return;

    loaded += hits.length;
    offset += hits.length;
    mapLoadState.loadedRecords = loaded;

    const loadedTxt = loaded.toLocaleString();
    const dotsTxt = mapLoadState.uniqueDots.toLocaleString();
    setMapLoadStatus(`Loaded ${loadedTxt} records as ${dotsTxt} dots...`);

    if (hits.length < size) break;
    if (loaded >= MAP_MAX_POINTS) {
      reachedMax = true;
      break;
    }
  }

  if (runId !== mapLoadState.runId) return;

  mapLoadState.loading = false;
  mapLoadState.completed = true;

  if (mapDotsLayer.getLayers().length > 0) {
    map.fitBounds(mapDotsLayer.getBounds(), { padding: [20, 20] });
  }

  const loadedTxt = mapLoadState.loadedRecords.toLocaleString();
  const dotsTxt = mapLoadState.uniqueDots.toLocaleString();

  if (!loaded) {
    setMapLoadStatus('No records found for the current filters and bounds. After changing filters or drawing a new area, click "Show Results" to update the map interface.');
  } else if (reachedMax) {
    setMapLoadStatus(`Loaded first ${loadedTxt} records as ${dotsTxt} dots (map cap: ${MAP_MAX_POINTS.toLocaleString()}).`);
  } else {
    setMapLoadStatus(`Loaded ${loadedTxt} records as ${dotsTxt} dots.`);
  }
}

function setMapDragEnabled(enabled) {
  if (!map.dragging || typeof map.dragging.enable !== 'function') return;
  if (enabled) map.dragging.enable();
  else map.dragging.disable();
}

function removePreviewRectangle() {
  if (!bboxDraw.previewRectangle) return;
  map.removeLayer(bboxDraw.previewRectangle);
  bboxDraw.previewRectangle = null;
}

function normalizedBoundsFromLeaflet(bounds) {
  return {
    minLat: bounds.getSouth(),
    maxLat: bounds.getNorth(),
    minLon: bounds.getWest(),
    maxLon: bounds.getEast(),
  };
}

function setBBoxControlVisibility(show) {
  if (!bboxToolContainer) return;
  bboxToolContainer.style.display = show ? '' : 'none';
}

function hasSelectedBoundingBox() {
  return !!selectedBoundsRectangle;
}

function updateBBoxControlButtons() {
  if (!bboxToolArmButton || !bboxToolCancelButton || !bboxToolRenderButton) return;

  const active = bboxDraw.workflowActive;
  const armed = active && bboxDraw.armed;
  const hasBBox = hasSelectedBoundingBox();

  bboxToolArmButton.classList.toggle('bbox-active', armed);
  bboxToolArmButton.classList.toggle('bbox-disabled', !active);
  bboxToolArmButton.textContent = armed ? 'BBox ON' : 'BBox';
  bboxToolArmButton.title = armed ? 'BBox tool enabled: click and drag on map to draw.' : 'Enable/disable bounding-box drawing mode';

  bboxToolCancelButton.textContent = 'Clear BBox';
  bboxToolCancelButton.title = 'Clear the drawn bounding box';
  bboxToolCancelButton.style.display = hasBBox ? '' : 'none';
  bboxToolRenderButton.textContent = 'Show Results';
  bboxToolRenderButton.title = `Show up to ${MAP_MAX_POINTS.toLocaleString()} points for current filters`;
}

function setBBoxArmed(armed) {
  const shouldArm = !!armed && bboxDraw.workflowActive;
  bboxDraw.armed = shouldArm;

  const mapEl = map.getContainer();
  if (mapEl) mapEl.style.cursor = shouldArm ? 'crosshair' : '';

  if (shouldArm) {
    setMapDragEnabled(false);
    showMapHelp('BBox tool enabled: click and drag on the map to draw your query boundary. Release to set bounds.');
  } else {
    setMapDragEnabled(true);
    if (bboxDraw.workflowActive) {
      showMapHelp('Pan/zoom map as needed. Drag on map to draw bounds, or use BBox toggle in top-left controls.');
    }
  }

  updateBBoxControlButtons();
}

function resetTransientDrawState() {
  bboxDraw.drawing = false;
  bboxDraw.startLatLng = null;
  bboxDraw.startContainerPoint = null;
  removePreviewRectangle();
}

function detachDrawHandlers() {
  if (!drawHandlers) return;
  map.off('mousedown', drawHandlers.mousedown);
  map.off('mousemove', drawHandlers.mousemove);
  map.off('mouseup', drawHandlers.mouseup);
  document.removeEventListener('keydown', drawHandlers.keydown);
  drawHandlers = null;
}

function clearBoundingBoxWorkflowState() {
  resetTransientDrawState();
  bboxDraw.workflowActive = false;
  bboxDraw.onComplete = null;
  bboxDraw.onCancel = null;
  setBBoxArmed(false);

  hideMapHelp();
  setBBoxControlVisibility(true);
  updateBBoxControlButtons();
}

function cancelBoundingBoxSelection(notify) {
  if (!bboxDraw.workflowActive) return;
  const onCancel = bboxDraw.onCancel;
  clearBoundingBoxWorkflowState();
  if (notify !== false && typeof onCancel === 'function') onCancel();
}

function clearSelectedBoundingBoxOverlay() {
  if (!selectedBoundsRectangle) return;
  map.removeLayer(selectedBoundsRectangle);
  selectedBoundsRectangle = null;
  updateBBoxControlButtons();
}

function notifyMapBBoxCleared() {
  if (typeof window.onMapBBoxCleared === 'function') {
    window.onMapBBoxCleared();
  }
}

function updatePreviewRectangle(latlng) {
  if (!bboxDraw.startLatLng) return;
  const bounds = L.latLngBounds(bboxDraw.startLatLng, latlng);

  if (!bboxDraw.previewRectangle) {
    bboxDraw.previewRectangle = L.rectangle(bounds, {
      color: '#1d4ed8',
      weight: 2,
      dashArray: '4 4',
      fillOpacity: 0.06,
    }).addTo(map);
  } else {
    bboxDraw.previewRectangle.setBounds(bounds);
  }
}

function completeBoundingBoxSelection(latlng) {
  if (!bboxDraw.workflowActive || !bboxDraw.armed || !bboxDraw.startLatLng) return;

  const bounds = L.latLngBounds(bboxDraw.startLatLng, latlng);
  const normalized = normalizedBoundsFromLeaflet(bounds);

  if (selectedBoundsRectangle) map.removeLayer(selectedBoundsRectangle);
  selectedBoundsRectangle = L.rectangle(bounds, {
    color: '#0b7285',
    weight: 2,
    fillOpacity: 0.04,
  }).addTo(map);

  const onComplete = bboxDraw.onComplete;
  clearBoundingBoxWorkflowState();

  if (typeof onComplete === 'function') onComplete(normalized);
}

function ensureDrawHandlersAttached() {
  if (drawHandlers) return;

  drawHandlers = {
    mousedown: function (e) {
      if (!bboxDraw.workflowActive) return;
      if (!bboxDraw.armed) {
        setBBoxArmed(true);
      }
      if (!bboxDraw.armed) return;
      if (e.originalEvent) {
        L.DomEvent.preventDefault(e.originalEvent);
      }
      bboxDraw.drawing = true;
      bboxDraw.startLatLng = e.latlng;
      bboxDraw.startContainerPoint = e.containerPoint || null;
      removePreviewRectangle();
      updatePreviewRectangle(e.latlng);
    },
    mousemove: function (e) {
      if (!bboxDraw.workflowActive || !bboxDraw.armed || !bboxDraw.drawing || !bboxDraw.startLatLng) return;
      updatePreviewRectangle(e.latlng);
    },
    mouseup: function (e) {
      if (!bboxDraw.workflowActive || !bboxDraw.armed || !bboxDraw.drawing || !bboxDraw.startLatLng) return;
      const startPoint = bboxDraw.startContainerPoint;
      const endPoint = e.containerPoint || null;
      if (startPoint && endPoint && startPoint.distanceTo(endPoint) < 6) {
        resetTransientDrawState();
        showMapHelp('Click and drag on the map to draw your query boundary.');
        return;
      }
      completeBoundingBoxSelection(e.latlng);
    },
    keydown: function (e) {
      if (!bboxDraw.workflowActive) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        cancelBoundingBoxSelection(true);
      }
    },
  };

  map.on('mousedown', drawHandlers.mousedown);
  map.on('mousemove', drawHandlers.mousemove);
  map.on('mouseup', drawHandlers.mouseup);
  document.addEventListener('keydown', drawHandlers.keydown);
}

function ensureBBoxToolControl() {
  if (bboxToolControl) return;

  bboxToolControl = L.control({ position: 'topleft' });
  bboxToolControl.onAdd = function () {
    const container = L.DomUtil.create('div', 'leaflet-bar bbox-tool-control');

    const armBtn = L.DomUtil.create('a', 'bbox-tool-arm', container);
    armBtn.href = '#';
    armBtn.textContent = 'BBox';

    const cancelBtn = L.DomUtil.create('a', 'bbox-tool-cancel', container);
    cancelBtn.href = '#';
    cancelBtn.textContent = 'Clear';

    const renderBtn = L.DomUtil.create('a', 'bbox-tool-render', container);
    renderBtn.href = '#';
    renderBtn.textContent = 'Show Results';

    L.DomEvent.disableClickPropagation(container);

    L.DomEvent.on(armBtn, 'click', function (e) {
      L.DomEvent.preventDefault(e);
      L.DomEvent.stopPropagation(e);
      if (!bboxDraw.workflowActive) return;
      setBBoxArmed(!bboxDraw.armed);
    });

    L.DomEvent.on(cancelBtn, 'click', function (e) {
      L.DomEvent.preventDefault(e);
      L.DomEvent.stopPropagation(e);
      clearSelectedBoundingBoxOverlay();
      notifyMapBBoxCleared();
    });

    L.DomEvent.on(renderBtn, 'click', function (e) {
      L.DomEvent.preventDefault(e);
      L.DomEvent.stopPropagation(e);
      loadMapDataIncrementally(true);
    });

    bboxToolContainer = container;
    bboxToolArmButton = armBtn;
    bboxToolCancelButton = cancelBtn;
    bboxToolRenderButton = renderBtn;

    updateBBoxControlButtons();
    return container;
  };

  bboxToolControl.addTo(map);
  setBBoxControlVisibility(true);
}

function startBoundingBoxSelection(optionsOrCallback, maybeOnCancel) {
  let options = {};

  if (typeof optionsOrCallback === 'function') {
    options = { onComplete: optionsOrCallback, onCancel: maybeOnCancel };
  } else if (optionsOrCallback && typeof optionsOrCallback === 'object') {
    options = optionsOrCallback;
  }

  if (bboxDraw.workflowActive) cancelBoundingBoxSelection(false);

  ensureBBoxToolControl();
  ensureDrawHandlersAttached();

  bboxDraw.workflowActive = true;
  bboxDraw.onComplete = (typeof options.onComplete === 'function') ? options.onComplete : null;
  bboxDraw.onCancel = (typeof options.onCancel === 'function') ? options.onCancel : null;

  resetTransientDrawState();
  setMapDragEnabled(true);
  setBBoxControlVisibility(true);
  setBBoxArmed(false);
  updateBBoxControlButtons();

  map.closePopup();
  map.invalidateSize();

  showMapHelp('Pan/zoom map as needed, then drag directly on map to set bounds. Press Esc to cancel.');
}

window.startBoundingBoxSelection = startBoundingBoxSelection;
window.cancelBoundingBoxSelection = cancelBoundingBoxSelection;
window.clearSelectedBoundingBoxOverlay = clearSelectedBoundingBoxOverlay;
window.loadMapDataIncrementally = loadMapDataIncrementally;
window.cancelMapDataLoading = cancelMapDataLoading;
window.markMapNeedsRender = markMapNeedsRender;

ensureBBoxToolControl();
markMapNeedsRender();

// Legacy fallback renderer (current page only)
function renderMapMarkers(results) {
  void results;
  markMapNeedsRender();
}
