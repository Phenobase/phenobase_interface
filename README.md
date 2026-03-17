# Phenobase Interface

[![Netlify Status](https://api.netlify.com/api/v1/badges/db775c45-a020-414c-9bba-539bf5de3fcf/deploy-status)](https://app.netlify.com/projects/phenobase2/deploys)

Lightweight web UI for searching, mapping, and summarizing plant phenology records in Phenobase.

Live site: <https://phenobase.netlify.app/>

## Application Environment

- App type: static frontend
- Primary stack: HTML, CSS, JavaScript, jQuery, jQuery UI, Leaflet, Chart.js, Bootstrap 3
- Backend in this repo: none
- Backend contract: the UI builds Elasticsearch-style JSON queries client-side and sends them through the existing Phenobase proxy endpoint
- Verified locally with:
  - `node v20.19.6`
  - `npm 10.8.2`

## Repository Layout

- `app/`: source files served in local development
- `public/`: generated build output for deployment
- `components/`: standalone React + TypeScript experimental chart components added for future reuse; not wired into the current static app
- `gulpfile.js`: build pipeline that copies `app/` into `public/`
- `app/trait-viz/`: git submodule required by the current build copy step

## Local Setup

1. Clone the repo and enter it.
2. Initialize submodules:

```bash
git submodule update --init --recursive
```

3. Install dependencies:

```bash
npm install
```

4. Start the local dev server:

```bash
npm start
```

This serves `./app` at <http://localhost:8000>.

## Build and Deploy

Build static output into `public/`:

```bash
npx gulp clean
npx gulp build
```

Notes:
- `gulp build` expects `app/trait-viz/lib/*` to exist.
- Any static host can serve the generated `public/` directory.

## Interface Overview

The interface has two main areas:

- Left sidebar: filters, selected-filter summary, and download action
- Main content: `Table`, `Map`, and `Stats` views

The UI keeps a shared query state in `requestData.query`. Table, map, stats, and download all derive from that same filter state, but each view requests data differently.

## Sidebar Filters

Each filter title has an inline `i` help icon that opens a small popover.

### Data Source

- Rendered as a checkbox-style multi-select
- Supports multiple providers at once
- Some providers are present-only sources; selecting only those sources locks the Presence filter to `present`

### Presence

- Options: `Both`, `Present`, `Absent`
- Auto-locks to `Present` when every selected data source only supports present records

### Phenophase Categories

- Two filter modes:
  - `Simple terms`: grouped phenophase categories
  - `All traits`: raw mapped trait list
- The UI enforces mutual exclusivity between grouped phenophases and raw trait selection

### Decade Range

- Two-thumb decade slider built with jQuery UI
- Uses discrete decade bins such as `1950s`, `1960s`, `1970s`
- Default state is the full available decade range
- Supports single-decade filtering by placing both thumbs on the same decade
- Displays:
  - selected decade range text
  - visible decade tick labels
  - tiny histogram bars showing counts per decade
- URL state is synchronized with:
  - `decadeStart`
  - `decadeEnd`

Internally the UI now queries the indexed `decadeStart` field instead of dynamically working from raw `year`.

### Search by Scientific Name

- Full-text search across:
  - `scientificName`
  - `genus`
  - `family`
- The placeholder and help text both reflect that broader search scope
- When Stats is visible, scientific-name search now refreshes the Stats tab as well as the table query

### Geographic Filter

- Sidebar controls:
  - `Set bounds on map`
  - `Clear`
- The current selected bounding box is shown under the buttons as:
  - `Southwest: lat, lon | Northeast: lat, lon`
- Bounds are stored as a shared geo filter and affect table, stats, map query state, and download

### Selected Filters

- Active filters are summarized in the sidebar
- Individual facet chips can be cleared
- A full reset path also clears:
  - scientific name search
  - decade range
  - presence mode
  - phenophase / trait selections
  - bbox

### Download

- Download uses the current shared query converted to Lucene syntax
- The UI can download up to `100,000` matching records
- A confirmation dialog warns about:
  - citation / data-use policy
  - exact-match scientific-name behavior in downloads
  - startup delay for large downloads

## Main Views

### Table View

- Default record browser
- Shows paginated results with a dynamic page size based on available viewport height
- Columns include:
  - view details
  - data source
  - scientific name
  - year
  - day of year
  - family
  - genus
  - trait
  - verbatim trait
  - source record
- Clicking a row opens a modal with record details

### Map View

The map view is intentionally manual-rendered. Changing filters updates the underlying query immediately, but map points are only refreshed when the user clicks `Show Results` in the map control.

#### Base map and controls

- Leaflet map with selectable base layers:
  - Regular
  - Topo
  - Satellite
- Custom top-left bbox controls:
  - `BBox` / `BBox ON`
  - `Clear BBox`
  - `Show Results`

#### BBox workflow

- The top-left `BBox` control is always available
- Users can:
  - click `BBox`
  - drag on the map to draw a rectangle
  - release to store bounds into the shared geographic filter
- The sidebar `Set bounds on map` button also arms the same workflow
- Drawn bbox rectangles are non-interactive so they do not block clicking point markers
- Map help and status messages are shown as dismissible overlay boxes at the top of the map viewport

#### Map rendering behavior

- Map points are loaded incrementally in batches
- Hard cap: `10,000` records per render pass
- Progress messages are shown while loading
- If filters change after a render, the map is marked stale and the UI tells the user to click `Show Results`

#### Map point behavior

- Points are aggregated by rounded lat/lon position into a single dot
- Dot size increases with record count at that location
- Clicking a point opens a popup showing:
  - record count
  - example scientific name
  - source
  - observation metadata link when available
- If multiple records share a location, the popup notes that the metadata link is only for one example record

### Stats View

The Stats tab uses a separate stats-only request based on the current shared query.

#### Current stats sections

- `Datasource Distribution`
- `Mapped Traits: Day of Year by Decade`
- `Family Distribution`
- `Genus Distribution`

#### Mapped trait decade charts

For each mapped trait with `dayOfYear` data, the UI renders a small-multiple chart by decade.

Current behavior:

- one chart per mapped trait
- x-axis: decades
- y-axis: day of year
- one box plot per decade
- statistics are computed per decade from a day-of-year histogram
- whiskers now use true Tukey-style non-outlier bounds

Tooltip content includes:

- median DOY
- IQR range
- whisker range
- sample size

Stats refresh behavior:

- Opening `Stats` fetches fresh aggregations immediately
- While `Stats` is visible, changing sidebar filters refreshes the stats request
- Scientific-name search also refreshes Stats when the Stats tab is active

## Backend API Calls

The frontend talks to the Phenobase proxy endpoint and sends Elasticsearch-style JSON.

### 1) Table search + facets

- Endpoint:
  - `POST https://biscicol.org/phenobase/api/v1/query//phenobase2/_search?size={pageSize}&from={offset}`
- Caller:
  - `fetchResults()` in `app/app.core.js`
- Query source:
  - `requestData.query`
- Aggregations used by the sidebar:
  - `datasource_0`
  - `mappedTraits_1`
  - `family_2`
  - `genus_3`
  - `decade_4`

### 2) Stats

- Endpoint:
  - `POST https://biscicol.org/phenobase/api/v1/query//phenobase2/_search?size=0&from=0`
- Caller:
  - `fetchStatsData()` in `app/app.stats.js`
- Request characteristics:
  - `size: 0`
  - `track_total_hits: false`
  - uses the current shared query
  - requests custom stats aggregations for datasource, family, genus, and mapped-trait decade distributions

### 3) Map points

- Endpoint:
  - `POST https://biscicol.org/phenobase/api/v1/query//phenobase2/_search?size={batchSize}&from={offset}`
- Caller:
  - `loadMapDataIncrementally(true)` in `app/app.map.js`
- Request characteristics:
  - manual trigger via `Show Results`
  - `_source` fields include:
    - `latitude`
    - `longitude`
    - `scientificName`
    - `mappedTraits`
    - `year`
    - `dataSource`
    - `observedMetadataUrl`
    - `annotationID`
  - `track_total_hits: true`

### 4) Download

- Endpoint pattern:
  - `GET https://biscicol.org/phenobase/api/v1/download/_search?q={luceneQuery}&limit=100000`
- Caller:
  - `updateDownloadLink()` in `app/app.core.js`

## Query Model

The UI builds a shared query from:

- scientific-name search
- data source selection
- presence mode
- phenophase / trait selection
- decade range
- geographic bounding box

Important details:

- decade filtering uses `decadeStart`
- map and stats both consume the same active filter query
- map rendering is manual, but table and stats refresh immediately from filter changes

## Current Notable Behaviors

- The main app is still a jQuery-based static frontend
- The `components/` directory contains standalone React + TypeScript chart work that is not currently mounted into the shipped app
- Map view is intentionally not auto-rendered after every filter change, to avoid large point loads
- Stats charts depend on `dayOfYear`; traits without `dayOfYear` observations are skipped

## Key Source Files

- `app/index.html`: main layout and filter / view containers
- `app/app.core.js`: shared query state, results fetching, main view switching, download URL
- `app/app.facets.js`: sidebar filters, decade slider, selected-facet summaries, URL sync
- `app/app.map.js`: Leaflet map, bbox controls, point loading, map popups
- `app/app.stats.js`: stats request and mapped-trait decade box plots
- `app/styles.css`: shared layout and interaction styling
