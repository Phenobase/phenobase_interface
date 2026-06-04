const fs = require("fs");
const http = require("http");
const path = require("path");
const {
  createPhenobaseDownload,
  parseDownloadLimit,
  parseDownloadQuery,
} = require("./lib/downloadExport");
const { getTaxonSuggestions } = require("./lib/taxonSuggest");

const PORT = Number(process.env.PORT || 8005);
const APP_DIR = path.join(__dirname, "app");

const MIME_TYPES = {
  ".css": "text/css",
  ".html": "text/html",
  ".ico": "image/x-icon",
  ".js": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json",
  });
  response.end(JSON.stringify(payload));
}

function sendBuffer(response, statusCode, payload, headers = {}) {
  response.writeHead(statusCode, headers);
  response.end(payload);
}

function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(APP_DIR, requestedPath));

  if (!filePath.startsWith(APP_DIR)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.stat(filePath, (statError, stats) => {
    if (statError || !stats.isFile()) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    response.writeHead(200, {
      "Content-Type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream",
    });
    fs.createReadStream(filePath).pipe(response);
  });
}

async function handleRequest(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (request.method === "GET" && url.pathname === "/api/taxa/suggest") {
    try {
      const suggestions = await getTaxonSuggestions(url.searchParams.get("q") || "");
      sendJson(response, 200, suggestions);
    } catch (error) {
      sendJson(response, 502, {
        error: "Unable to fetch taxon suggestions",
      });
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/download") {
    try {
      const query = parseDownloadQuery(url.searchParams.get("query") || "");
      const limit = parseDownloadLimit(url.searchParams.get("limit") || "");
      const download = await createPhenobaseDownload({ query, limit });
      sendBuffer(response, 200, download.buffer, {
        "Content-Type": download.contentType,
        "Content-Disposition": `attachment; filename="${download.fileName}"`,
        "Content-Length": String(download.buffer.length),
      });
    } catch (error) {
      sendJson(response, 502, {
        error: "Unable to create Phenobase download",
        detail: error.message || String(error),
      });
    }
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405);
    response.end("Method not allowed");
    return;
  }

  serveStatic(request, response);
}

http.createServer(handleRequest).listen(PORT, () => {
  console.log(`Phenobase interface running at http://localhost:${PORT}`);
});
