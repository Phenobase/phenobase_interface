const {
  createPhenobaseDownload,
  parseDownloadLimit,
  parseDownloadQuery,
} = require("../../lib/downloadExport");

exports.handler = async function handler(event) {
  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  try {
    const query = parseDownloadQuery(event.queryStringParameters?.query || "");
    const limit = parseDownloadLimit(event.queryStringParameters?.limit || "");
    const download = await createPhenobaseDownload({ query, limit });

    return {
      statusCode: 200,
      headers: {
        "Content-Type": download.contentType,
        "Content-Disposition": `attachment; filename="${download.fileName}"`,
        "Content-Length": String(download.buffer.length),
      },
      body: download.buffer.toString("base64"),
      isBase64Encoded: true,
    };
  } catch (error) {
    return {
      statusCode: 502,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        error: "Unable to create Phenobase download",
        detail: error.message || String(error),
      }),
    };
  }
};
