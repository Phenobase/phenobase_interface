// Initialize pagination variables
let currentPage = 1;
const pageSize = 15; // Number of results per page

// API URL with placeholders for pagination
var apiUrl = `https://biscicol.org/phenobase/api/v1/query//phenobase/_search?size=${pageSize}&from=0`;
var queryStringRootURL = "https://biscicol.org/phenobase/api/v1/download/_search?q="; // Root URL for download link
var downloadLink = ""; // Holds the constructed download link

// Initialize the Leaflet map
var map = L.map('map').setView([0, 0], 2); // Default to world view

// Define different map layers
const baseLayers = {
  "Regular": L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '© OpenStreetMap contributors'
  }),
  "Topo": L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '© OpenTopoMap contributors'
  }),
  "Satellite": L.tileLayer('https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
    maxZoom: 18,
    subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
    attribution: '© Google'
  })
};

// Add the default map layer
baseLayers.Regular.addTo(map);

// Add layer control to switch between map types
L.control.layers(baseLayers).addTo(map);

// Initialize marker cluster group to handle overlapping markers
var markersCluster = L.markerClusterGroup().addTo(map);

// Request payload for the aggregations
var requestData = {
  aggs: {
    datasource_0: {
      terms: {
        field: "datasource",
        size: 10,
      },
    },
    mapped_traits_1: {
      terms: {
        field: "mapped_traits",
        size: 500,
      },
    },
    family_2: {
      terms: {
        field: "family",
        size: 50,
      },
    },
    basis_of_record_3: {
      terms: {
        field: "basis_of_record",
        size: 50,
      },
    },
  },
  query: {
    bool: {
      must: [], // This will hold the selected facet queries and scientific name filter
    },
  },
};

// Keep track of selected facets
var selectedFacets = {};
var scientificNameFilter = null; // To keep track of the scientific name search filter

// Function to convert JSON query object to Lucene query string
function convertJsonToLucene(jsonQuery) {
  let conditions = [];

  // Check if it's a boolean query with "must" conditions
  if (jsonQuery.bool && Array.isArray(jsonQuery.bool.must)) {
    jsonQuery.bool.must.forEach((condition) => {
      if (condition.term) {
        // Convert term conditions
        for (const [field, value] of Object.entries(condition.term)) {
          conditions.push(`${field}:"${value}"`);
        }
      } else if (condition.match) {
        // Convert match conditions
        for (const [field, value] of Object.entries(condition.match)) {
          conditions.push(`${field}:"${value}"`);
        }
      }
    });
  }

  // Join conditions with "AND"
  return conditions.join(' AND ');
}

// Function to fetch data from the Elasticsearch API
function fetchResults() {
  showLoader(); // Show loader when starting a new fetch

  // Calculate the offset for pagination
  const offset = (currentPage - 1) * pageSize;
  const apiWithPagination = `${apiUrl.split('?')[0]}?size=${pageSize}&from=${offset}`;

  $.ajax({
    url: apiWithPagination,
    method: "POST",
    contentType: "application/json",
    data: JSON.stringify(requestData),
    dataType: "json",
    success: function (response) {
      hideLoader(); // Hide loader when data is successfully fetched
      console.log("API Response:", response);

      // Ensure the response contains the hits data
      if (response && response.hits && response.hits.hits) {
        var results = response.hits.hits;
        var totalResults = calculateTotalFromFacets(response.aggregations); // Total number of results from the facets

        // Calculate showing results range
        const startResult = offset + 1; // Starting index of results shown (1-based)
        const endResult = Math.min(offset + results.length, totalResults); // End index of results shown
        const showingResults = `${startResult} - ${endResult}`; // Format to "Showing X - Y"

        renderResults(results);
        renderFacets(response.aggregations);
        renderSelectedFacets(); // Render selected facets with "X" buttons
        updateDownloadLink(); // Update the download link with the current query
        renderPagination(totalResults); // Render pagination controls
        renderMapMarkers(results); // Render markers on the map

        // Update the heading to show the number of results
        updateResultsHeading(showingResults, totalResults);
      } else {
        console.error("Unexpected response structure:", response);
        alert("Unexpected response structure. Check the console for details.");
      }
    },
    error: function (error) {
      hideLoader(); // Hide loader in case of an error
      console.error("Error fetching data:", error);
    },
  });
}

// Function to calculate the total number of results based on facet aggregations
function calculateTotalFromFacets(aggregations) {
  let total = 0;

  // Example of calculating total based on datasource_0 aggregation - adjust as needed
  if (aggregations.datasource_0 && aggregations.datasource_0.buckets) {
    total = aggregations.datasource_0.buckets.reduce((sum, bucket) => sum + bucket.doc_count, 0);
  }

  // You can add other aggregations here if necessary to sum up the correct total
  // For example, you might need to include other fields depending on your facet structure

  return total;
}

// Function to update the results heading with the number of displayed and total results
function updateResultsHeading(showingResults, totalResults) {
  // Format the numbers with commas for better readability
  const formattedTotalResults = totalResults.toLocaleString();

  // Construct the message for the heading
  const headingMessage = `Showing ${showingResults} of ${formattedTotalResults} total possible results`;

  // Find the element and update its text
  document.getElementById('resultsHeading').textContent = headingMessage;
}

// Call fetchResults when the document is ready
$(document).ready(function () {
  fetchResults();
  $("#downloadButton").click(function (event) {
    updateDownloadLink();
    console.log(downloadLink);
    if (!downloadLink) {
      event.preventDefault(); // Prevent default action if no link is available
    }
  });
});

// Function to render markers on the map using latitude and longitude from the ES data
function renderMapMarkers(results) {
  // Clear existing markers
  markersCluster.clearLayers();

  // Group results by location
  const locationMap = {};

  results.forEach(function (doc) {
    const { latitude, longitude } = doc._source; // Adjust these field names based on your actual data structure
    const locationKey = `${latitude},${longitude}`;

    if (!locationMap[locationKey]) {
      locationMap[locationKey] = [];
    }
    locationMap[locationKey].push(doc);
  });

  // Iterate over grouped locations and create markers with paginated popups
  Object.entries(locationMap).forEach(([locationKey, docs]) => {
    const [latitude, longitude] = locationKey.split(',').map(Number);

    // Create marker only if latitude and longitude exist
    if (latitude && longitude) {
      const marker = L.marker([latitude, longitude]);
      markersCluster.addLayer(marker);

      // Create the initial popup content with pagination
      let currentIndex = 0;

      function updatePopup() {
        const start = currentIndex * 10;
        const end = Math.min(start + 10, docs.length);
        const currentDocs = docs.slice(start, end);

        let popupContent = `
          <div style="max-height: 200px; overflow-y: auto; padding-right: 10px;">
        `;

        // Loop through each document to display its fields
        currentDocs.forEach(doc => {
          const sourceData = doc._source;
          popupContent += `<div style="margin-bottom: 0; font-size: 12px; line-height: 1.1;">`; // Condensed spacing
          Object.entries(sourceData).forEach(([key, value]) => {
            popupContent += `<p style="margin: 2px 0;"><strong>${key}:</strong> ${value}</p>`; // Reduced margin between lines
          });
          popupContent += `</div><hr style="margin: 4px 0;">`; // Reduced spacing for separator line
        });

        popupContent += `</div>`;

        // Add navigation buttons only if there are multiple pages
        if (docs.length > 10) {
          popupContent += `
            <div style="display: flex; justify-content: space-between; margin-top: 5px;">
              <button id="prevRecord" ${currentIndex === 0 ? 'disabled' : ''}>Previous</button>
              <span>Page ${currentIndex + 1} of ${Math.ceil(docs.length / 10)}</span>
              <button id="nextRecord" ${end >= docs.length ? 'disabled' : ''}>Next</button>
            </div>`;
        }

        marker.setPopupContent(popupContent);
      }

      // Bind the initial popup to the marker
      marker.bindPopup().openPopup();
      updatePopup();

      // Prevent popup from closing when interacting with buttons
      marker.on('popupopen', function () {
        attachPopupEventListeners();
      });

      function attachPopupEventListeners() {
        document.getElementById('nextRecord')?.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          if (currentIndex < Math.ceil(docs.length / 10) - 1) {
            currentIndex++;
            updatePopup();
            setTimeout(attachPopupEventListeners, 0); // Reattach listeners after update
          }
        });

        document.getElementById('prevRecord')?.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          if (currentIndex > 0) {
            currentIndex--;
            updatePopup();
            setTimeout(attachPopupEventListeners, 0); // Reattach listeners after update
          }
        });
      }
    }
  });

  // Fit the map to show all markers
  if (markersCluster.getLayers().length > 0) {
    map.fitBounds(markersCluster.getBounds());
  }
}

// Function to render the results in the UI
function renderResults(results) {
  var table = $("#resultsTable");
  table.find("thead").remove();

  var tableBody = $("#resultsTable tbody");
  tableBody.empty(); // Clear existing rows

  var thead = `<thead>
            <tr>
                <th>View Details</th>
                <th>Datasource</th>
                <th>Scientific Name</th>
                <th>Taxon Rank</th>
                <th>Year</th>
                <th>Day of Year</th>
                <th>Family</th>
                <th>Trait</th>
                <th>Prediction Class</th>
                <th>Image</th>
            </tr>
        </thead>`;
  table.prepend(thead); // Add <thead> to the table

  results.forEach(function (doc) {
    var row = `<tr data-source='${JSON.stringify(doc._source)}'>
      <td class="view-details">
        <i class="fa fa-search view-icon" style="cursor: pointer;" title="View Details" data-source='${JSON.stringify(doc._source)}'></i>
      </td>  
      <td>${doc._source.datasource}</td>
      <td>${doc._source.scientific_name}</td>
      <td>${doc._source.taxon_rank}</td>
      <td>${doc._source.year}</td>
      <td>${doc._source.day_of_year}</td>
      <td>${doc._source.family}</td>
      <td>${doc._source.trait}</td>
      <td>${doc._source.prediction_class}</td>
      <td>
        <a href="${doc._source.observed_image_url}" target="_blank">
          <img src="${doc._source.observed_image_guid}" width="85" height="85" alt="Image">
        </a>
      </td>
    </tr>`;
    tableBody.append(row);
  });

  // Add click event listener to the magnifying glass icon to show details in a modal
  $(".view-icon").click(function () {
    var sourceData = $(this).data("source");
    showDetailsModal(sourceData);
  });
}

// Function to render dynamic facets
function renderFacets(aggregations) {
  $("#dataSourceFacets").empty();
  $("#traitFacets").empty();
  $("#familyFacets").empty();
  $("#basisOfRecordFacets").empty();

  // Populate DataSource facet
  renderFacetLinks(aggregations.datasource_0, "#dataSourceFacets", "datasource");
  // Populate Trait facet
  renderFacetLinks(aggregations.mapped_traits_1, "#traitFacets", "mapped_traits");
  // Populate Family facet
  renderFacetLinks(aggregations.family_2, "#familyFacets", "family");
  // Populate Basis of Record facet
  renderFacetLinks(aggregations.basis_of_record_3, "#basisOfRecordFacets", "basis_of_record");
}

// Helper function to render facet links
function renderFacetLinks(aggregation, container, field) {
  if (aggregation && aggregation.buckets) {
    aggregation.buckets.forEach(function (bucket) {
      const isSelected = selectedFacets[field] && selectedFacets[field].includes(bucket.key);
      var countFormatted = bucket.doc_count.toLocaleString(); // Format count with commas
      $(container).append(`
        <div class="facet-link-container">
          <a class="facet-link ${isSelected ? 'selected' : ''}" href="#" data-field="${field}" data-value="${bucket.key}">
            ${bucket.key} (${countFormatted}) ${isSelected ? '<span class="remove-facet" data-field="'+field+'" data-value="'+bucket.key+'">X</span>' : ''}
          </a>
        </div>
      `);
    });

    // Add click event listener to dynamically update results
    $(container)
      .find(".facet-link")
      .click(function (event) {
        event.preventDefault();
        var field = $(this).data("field");
        var value = $(this).data("value");
        if (!$(this).hasClass('selected')) {
          showLoader(); // Show loader when a facet is clicked
          addFacet(field, value);
        }
      });

    // Add click event listener to remove the facet when "X" is clicked
    $(container).on("click", ".remove-facet", function (event) {
      event.stopPropagation();
      var field = $(this).data("field");
      var value = $(this).data("value");
      removeFacet(field, value);
    });
  }
}

// Function to render the selected facets separately and persist the "X" button
function renderSelectedFacets() {
  Object.entries(selectedFacets).forEach(([field, values]) => {
    values.forEach((value) => {
      const facetLink = $(`.facet-link[data-field="${field}"][data-value="${value}"]`);
      if (facetLink.length && !facetLink.hasClass('selected')) {
        facetLink.addClass('selected');
        facetLink.append(`<span class="remove-facet" data-field="${field}" data-value="${value}">X</span>`);
      }
    });
  });
}

// Function to add a facet to the selected list and update the query
function addFacet(field, value) {
  // Add the selected facet to the selectedFacets object
  if (!selectedFacets[field]) {
    selectedFacets[field] = [];
  }
  if (!selectedFacets[field].includes(value)) {
    selectedFacets[field].push(value);
  }
  
  // Update the query part of the request data
  updateQueryWithSelectedFacets();

  // Re-fetch results with the updated query
  fetchResults();
}

// Function to remove a selected facet
function removeFacet(field, value) {
  if (selectedFacets[field]) {
    selectedFacets[field] = selectedFacets[field].filter((v) => v !== value);
    if (selectedFacets[field].length === 0) {
      delete selectedFacets[field];
    }
  }

  // Update the query part of the request data
  updateQueryWithSelectedFacets();

  // Re-fetch results with the updated query
  fetchResults();
}

// Function to update the requestData query based on selected facets and scientific name
function updateQueryWithSelectedFacets() {
  requestData.query.bool.must = []; // Reset the must array

  // Add facet filters
  Object.entries(selectedFacets).forEach(([field, values]) => {
    values.forEach((value) => {
      requestData.query.bool.must.push({ term: { [field]: value } });
    });
  });

  // Add scientific name filter if present
  if (scientificNameFilter) {
    requestData.query.bool.must.push(scientificNameFilter);
  }

  // If no filters are selected, reset to match all
  if (requestData.query.bool.must.length === 0) {
    requestData.query = { match_all: {} };
  }

  // Update the download link with the current query
  updateDownloadLink();
}

// Function to construct the download link based on the current query
function updateDownloadLink() {
  // Convert the JSON query to Lucene format using the conversion function
  const luceneQuery = convertJsonToLucene(requestData.query);

  // Construct the download link using the Lucene query
  downloadLink = `${queryStringRootURL}${encodeURIComponent(luceneQuery)}&limit=100000`;

  // Enable the download button and update the href attribute
  $("#downloadButton")
    .attr("href", downloadLink)
    .attr("download", "phenobase_data.json")
    .prop("disabled", false);
}

// Function to handle scientific name search when the button is clicked
function handleScientificNameSearch() {
  var scientificName = $("#scientificNameSearch").val().trim();

  // Update the scientific name filter
  if (scientificName) {
    scientificNameFilter = { match: { scientific_name: scientificName } };
  } else {
    scientificNameFilter = null; // Clear the filter if input is empty
  }

  // Update the query with selected facets and the scientific name
  updateQueryWithSelectedFacets();

  // Fetch results based on the updated query
  fetchResults();
}

// Event listener for the search button click
$("#searchButton").click(function () {
  handleScientificNameSearch();
});

// Function to render pagination controls
function renderPagination(totalResults) {
  console.log("rendering pagination")
  const paginationContainer = document.getElementById('pagination');
  paginationContainer.innerHTML = ''; // Clear existing pagination

  // Calculate total pages
  const totalPages = Math.ceil(totalResults / pageSize);

  // Add Previous button
  if (currentPage > 1) {
    const prevButton = document.createElement('button');
    prevButton.className = 'pagination-button';
    prevButton.textContent = 'Previous';
    prevButton.onclick = () => {
      currentPage--;
      fetchResults(); // Fetch new results for the updated page
    };
    paginationContainer.appendChild(prevButton);
  }

  // Add Next button
  if (currentPage < totalPages) {
    const nextButton = document.createElement('button');
    nextButton.className = 'pagination-button';
    nextButton.textContent = 'Next';
    nextButton.onclick = () => {
      currentPage++;
      fetchResults(); // Fetch new results for the updated page
    };
    paginationContainer.appendChild(nextButton);
  }
}

// Function to show details modal with _source fields
function showDetailsModal(sourceData) {
  var modal = $("#detailsModal");
  var modalBody = $("#modalBody");
  modalBody.empty(); // Clear previous content

  // Create a container to hold the image and the details
  var contentContainer = $(`
      <div style="display: flex; flex-wrap: wrap; gap: 20px;">
          <div style="flex: 0 0 auto;">
              <a href="${sourceData.observed_image_url}" target="_blank">
                  <img src="${sourceData.observed_image_guid}" width="85" height="85" alt="Image">
              </a>
          </div>
          <div style="flex: 1;">
              <!-- Details will be appended here -->
          </div>
      </div>
  `);

  // Append the container to the modal body
  modalBody.append(contentContainer);

  // Append each key-value pair as a paragraph to the details section
  Object.entries(sourceData).forEach(([key, value]) => {
      // Check if the key is for image or link and display them with special formatting if needed
      if (key === 'observed_image_url' || key === 'observed_image_guid') {
          // Display these fields specially, e.g., with the image and link already displayed
          contentContainer.find('div:last-child').append(`<p><strong>${key}:</strong> <a href="${sourceData.observed_image_url}" target="_blank">${value}</a></p>`);
      } else {
          // Add the rest of the details normally
          contentContainer.find('div:last-child').append(`<p><strong>${key}:</strong> ${value}</p>`);
      }
  });

  // Show the modal
  modal.css("display", "flex");
}

// Event listener to close the modal
$("#closeModal").click(function () {
  $("#detailsModal").hide();
});

// Function to show the loader and disable further interactions
function showLoader() {
  $("#loader").css("display", "flex");
  $(".facet-link").css("pointer-events", "none"); // Disable further clicks on facet links
}

// Function to hide the loader and re-enable interactions
function hideLoader() {
  $("#loader").css("display", "none");
  $(".facet-link").css("pointer-events", "auto"); // Re-enable clicks on facet links
}

// Toggle between Table and Map view
$("#showTable").click(function () {
  $("#tableContainer").show(); // Show the table container
  $("#mapContainer").hide(); // Hide the map container
  $("#statsContainer").hide(); // Hide the stats container
});


$("#showMap").click(function () {
  $("#mapContainer").show(); // Show the map container
  $("#tableContainer").hide(); // Hide the table container
  $("#statsContainer").hide(); // Hide the stats container

  // Resize the map to ensure it's displayed correctly when shown
  setTimeout(() => {
    map.invalidateSize();
  }, 100);
});


// Function to render tables based on aggregations
function renderTables(aggregations) {
  // Helper function to create a table
  function renderTable(id, headers, rows, title) {
    const container = document.getElementById(id);
    container.innerHTML = ""; // Clear previous content

    // Create table title
    const titleElement = document.createElement("h3");
    titleElement.textContent = title;
    container.appendChild(titleElement);

    // Create table element
    const table = document.createElement("table");
    table.classList.add("table", "table-striped");

    // Create table header
    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    headers.forEach((header) => {
      const th = document.createElement("th");
      th.textContent = header;
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Create table body
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

    // Append the table to the container
    container.appendChild(table);
  }

  // Datasource Table
  const datasourceBuckets = aggregations.datasource_0?.buckets || [];
  const datasourceHeaders = ["Datasource", "Count"];
  const datasourceRows = datasourceBuckets.map((bucket) => [bucket.key, bucket.doc_count.toLocaleString()]);
  renderTable("datasourceTable", datasourceHeaders, datasourceRows, "Datasource Distribution");

  // Mapped Traits Table
  const mappedTraitsBuckets = aggregations.mapped_traits_1?.buckets || [];
  const mappedTraitsHeaders = ["Trait", "Count"];
  const mappedTraitsRows = mappedTraitsBuckets.map((bucket) => [bucket.key, bucket.doc_count.toLocaleString()]);
  renderTable("mappedTraitsTable", mappedTraitsHeaders, mappedTraitsRows, "Mapped Traits Distribution");

  // Family Table
  const familyBuckets = aggregations.family_2?.buckets || [];
  const familyHeaders = ["Family", "Count"];
  const familyRows = familyBuckets.map((bucket) => [bucket.key, bucket.doc_count.toLocaleString()]);
  renderTable("familyTable", familyHeaders, familyRows, "Family Distribution");

  // Basis of Record Table
  const basisOfRecordBuckets = aggregations.basis_of_record_3?.buckets || [];
  const basisOfRecordHeaders = ["Basis of Record", "Count"];
  const basisOfRecordRows = basisOfRecordBuckets.map((bucket) => [bucket.key, bucket.doc_count.toLocaleString()]);
  renderTable("basisOfRecordTable", basisOfRecordHeaders, basisOfRecordRows, "Basis of Record Distribution");
}

// Function to fetch stats data from the API using POST request
function fetchStatsData() {
  const statsApiUrl = "https://biscicol.org/phenobase/api/v1/query//phenobase/_search?size=15&from=0";

  $.ajax({
    url: statsApiUrl,
    method: "POST",
    contentType: "application/json",
    data: JSON.stringify(requestData),
    dataType: "json",
    success: function (response) {
      console.log("Stats API Response:", response);

      // Check if aggregations exist in the response
      if (response && response.aggregations) {
        renderTables(response.aggregations);
      } else {
        console.error("No aggregations found in the response.");
        alert("No data available for stats view.");
      }
    },
    error: function (error) {
      console.error("Error fetching stats data:", error);
      alert("Failed to load stats data. Check console for details.");
    },
  });
}

// Event listener for the Stats View tab
$("#showStats").click(function () {
  $("#statsContainer").show();
  $("#mapContainer").hide();
  $("#tableContainer").hide();

  // Fetch stats data when switching to Stats View
  fetchStatsData();
});
