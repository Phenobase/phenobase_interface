const { getTaxonSuggestions } = require("../../lib/taxonSuggest");

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
    const suggestions = await getTaxonSuggestions(event.queryStringParameters?.q || "");

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(suggestions),
    };
  } catch (error) {
    return {
      statusCode: 502,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ error: "Unable to fetch taxon suggestions" }),
    };
  }
};
