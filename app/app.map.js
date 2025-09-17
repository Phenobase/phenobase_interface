// Leaflet init & base layers
var map = L.map('map').setView([0, 0], 2);
const baseLayers = {
  "Regular": L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom: 18, attribution: '© OpenStreetMap contributors'}),
  "Topo": L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {maxZoom: 18, attribution: '© OpenTopoMap contributors'}),
  "Satellite": L.tileLayer('https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {maxZoom: 18, subdomains:['mt0','mt1','mt2','mt3'], attribution: '© Google'})
};
baseLayers.Regular.addTo(map);
L.control.layers(baseLayers).addTo(map);
var markersCluster = L.markerClusterGroup().addTo(map);

function renderMapMarkers(results) {
  markersCluster.clearLayers();
  const loc = {};
  results.forEach(doc => {
    const { latitude, longitude } = doc._source || {};
    const lat = Number(latitude), lon = Number(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    const key = `${lat},${lon}`; (loc[key] ||= []).push(doc);
  });

  Object.entries(loc).forEach(([k, docs]) => {
    const [lat, lon] = k.split(',').map(Number);
    const marker = L.marker([lat, lon]); markersCluster.addLayer(marker);
    let currentIndex = 0;
    function updatePopup() {
      const start = currentIndex * 10, end = Math.min(start + 10, docs.length);
      const currentDocs = docs.slice(start, end);
      let html = `<div style="max-height:200px; overflow-y:auto; padding-right:10px;">`;
      currentDocs.forEach(doc => {
        const s = doc._source || {};
        html += `<div style="margin-bottom:0; font-size:12px; line-height:1.1;">`;
        Object.entries(s).forEach(([key, value]) => { html += `<p style="margin:2px 0;"><strong>${key}:</strong> ${value}</p>`; });
        html += `</div><hr style="margin:4px 0;">`;
      });
      html += `</div>`;
      if (docs.length > 10) {
        html += `<div style="display:flex; justify-content:space-between; margin-top:5px;">
          <button id="prevRecord" ${currentIndex===0?'disabled':''}>Previous</button>
          <span>Page ${currentIndex+1} of ${Math.ceil(docs.length/10)}</span>
          <button id="nextRecord" ${end>=docs.length?'disabled':''}>Next</button></div>`;
      }
      marker.setPopupContent(html);
    }
    marker.bindPopup().openPopup(); updatePopup();
    marker.on('popupopen', function () {
      document.getElementById('nextRecord')?.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        if (currentIndex < Math.ceil(docs.length / 10) - 1) { currentIndex++; updatePopup(); }
      });
      document.getElementById('prevRecord')?.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        if (currentIndex > 0) { currentIndex--; updatePopup(); }
      });
    });
  });

  if (markersCluster.getLayers().length > 0) map.fitBounds(markersCluster.getBounds());
}

