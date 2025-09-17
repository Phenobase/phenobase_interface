function renderTables(aggregations) {
  function renderTable(id, headers, rows, title) {
    const container = document.getElementById(id);
    container.innerHTML = "";
    const titleElement = document.createElement("h3"); titleElement.textContent = title; container.appendChild(titleElement);
    const table = document.createElement("table"); table.classList.add("table", "table-striped");
    const thead = document.createElement("thead"); const headerRow = document.createElement("tr");
    headers.forEach((h)=>{ const th=document.createElement("th"); th.textContent=h; headerRow.appendChild(th); });
    thead.appendChild(headerRow); table.appendChild(thead);
    const tbody = document.createElement("tbody");
    rows.forEach((row)=>{ const tr=document.createElement("tr"); row.forEach((cell)=>{ const td=document.createElement("td"); td.textContent=cell; tr.appendChild(td); }); tbody.appendChild(tr); });
    table.appendChild(tbody); container.appendChild(table);
  }

  const datasourceBuckets = aggregations.datasource_0?.buckets || [];
  renderTable("datasourceTable", ["Datasource","Count"], datasourceBuckets.map(b=>[b.key,b.doc_count.toLocaleString()]), "Datasource Distribution");
  const mappedTraitsBuckets = aggregations.mappedTraits_1?.buckets || [];
  renderTable("mappedTraitsTable", ["Trait","Count"], mappedTraitsBuckets.map(b=>[b.key,b.doc_count.toLocaleString()]), "Mapped Traits Distribution");
  const familyBuckets = aggregations.family_2?.buckets || [];
  renderTable("familyTable", ["Family","Count"], familyBuckets.map(b=>[b.key,b.doc_count.toLocaleString()]), "Family Distribution");
  const genusBuckets = aggregations.genus_3?.buckets || [];
  renderTable("genusTable", ["Genus","Count"], genusBuckets.map(b=>[b.key,b.doc_count.toLocaleString()]), "Genus Distribution");
}

function fetchStatsData() {
  const statsApiUrl = "https://biscicol.org/phenobase/api/v1/query//phenobase2/_search?size=15&from=0";
  $.ajax({
    url: statsApiUrl, method: "POST", contentType: "application/json",
    data: JSON.stringify(requestData), dataType: "json",
    success: function (response) {
      if (response && response.aggregations) renderTables(response.aggregations);
      else { console.error("No aggregations in response."); alert("No data available for stats view."); }
    },
    error: function (error) { console.error("Error fetching stats:", error); alert("Failed to load stats data."); }
  });
}

