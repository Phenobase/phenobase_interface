const DEFAULT_SEARCH_URL =
  "https://biscicol.org/phenobase/api/v1/query//phenobase2/_search";
const DEFAULT_MAPPING_URL =
  "https://biscicol.org/phenobase/api/v1/query//phenobase2/_mapping";

const MAX_SUGGESTIONS = 25;
const MAX_EXACT_RANK_SUGGESTIONS = 10;
const TAXON_SEARCH_BUCKET_SIZE = 120;

let mappingCache = null;

function getSearchUrl() {
  return process.env.PHENOBASE_ES_SEARCH_URL || DEFAULT_SEARCH_URL;
}

function getMappingUrl() {
  return process.env.PHENOBASE_ES_MAPPING_URL || DEFAULT_MAPPING_URL;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Phenobase request failed (${response.status}): ${body}`);
  }
  return response.json();
}

async function getMapping() {
  if (!mappingCache) {
    mappingCache = fetchJson(getMappingUrl()).catch((error) => {
      mappingCache = null;
      throw error;
    });
  }
  return mappingCache;
}

function getProperties(mapping) {
  const firstIndex = mapping && Object.values(mapping)[0];
  return firstIndex?.mappings?.properties || mapping?.mappings?.properties || {};
}

function getFieldDefinition(properties, fieldPath) {
  const [field, subfield] = String(fieldPath || "").split(".");
  const definition = properties[field];

  if (!definition) return null;
  if (!subfield) return definition;
  return definition.fields?.[subfield] || null;
}

function fieldExists(properties, fieldPath) {
  return Boolean(getFieldDefinition(properties, fieldPath));
}

function isKeywordField(properties, fieldPath) {
  return getFieldDefinition(properties, fieldPath)?.type === "keyword";
}

function firstExistingField(properties, candidates) {
  return candidates.find((field) => fieldExists(properties, field));
}

function resolveExactField(properties, sourceCandidates, exactCandidates) {
  const sourceField = firstExistingField(properties, sourceCandidates);
  const exactField = exactCandidates.find((field) => isKeywordField(properties, field));

  return {
    sourceField,
    exactField: exactField || sourceField,
    hasKeywordExactField: Boolean(exactField),
  };
}

function resolveTaxonFields(mapping) {
  const properties = getProperties(mapping);

  return {
    scientificName: resolveExactField(
      properties,
      ["scientificName", "scientific_name"],
      ["scientificName.keyword", "scientific_name.keyword", "scientificName", "scientific_name"]
    ),
    taxonSearch: resolveExactField(
      properties,
      ["taxonSearch"],
      ["taxonSearch.keyword", "taxonSearch"]
    ),
    genus: resolveExactField(properties, ["genus"], ["genus.keyword", "genus"]),
    family: resolveExactField(
      properties,
      ["standardizedFamily", "gbifFamily", "family"],
      ["standardizedFamily.keyword", "standardizedFamily", "gbifFamily.keyword", "gbifFamily", "family.keyword", "family"]
    ),
    rankField: firstExistingField(properties, ["taxonRank", "taxon_rank"]),
  };
}

function fallbackTaxonFields() {
  return {
    scientificName: {
      sourceField: "scientificName",
      exactField: "taxonSearch",
      hasKeywordExactField: true,
    },
    taxonSearch: {
      sourceField: "taxonSearch",
      exactField: "taxonSearch",
      hasKeywordExactField: true,
    },
    genus: {
      sourceField: "genus",
      exactField: "genus",
      hasKeywordExactField: true,
    },
    family: {
      sourceField: "standardizedFamily",
      exactField: "standardizedFamily",
      hasKeywordExactField: true,
    },
    rankField: "taxonRank",
  };
}

function normalizeValue(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeKey(value) {
  return normalizeValue(value).toLocaleLowerCase();
}

function startsWithQuery(value, q) {
  return normalizeKey(value).startsWith(normalizeKey(q));
}

function escapeWildcard(value) {
  return String(value || "").replace(/[\\*?\[\]{}]/g, (character) => `\\${character}`);
}

function buildPrefixQuery(fieldInfo, q) {
  if (!fieldInfo?.exactField) return null;

  return {
    wildcard: {
      [fieldInfo.exactField]: {
        value: `${escapeWildcard(q)}*`,
        case_insensitive: true,
      },
    },
  };
}

async function fetchSearch(body) {
  return fetchJson(getSearchUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function fetchKeywordSuggestions(fieldInfo, field, rank, q) {
  if (!fieldInfo?.exactField) return [];

  const body = {
    size: 0,
    track_total_hits: false,
    query: buildPrefixQuery(fieldInfo, q),
    aggs: {
      values: {
        terms: {
          field: fieldInfo.exactField,
          size: MAX_SUGGESTIONS,
          order: {
            _key: "asc",
          },
        },
      },
    },
  };

  const response = await fetchSearch(body);

  return (response?.aggregations?.values?.buckets || [])
    .map((bucket) => ({
      label: normalizeValue(bucket.key),
      rank,
      field,
      value: normalizeValue(bucket.key),
      _count: Number(bucket.doc_count || 0),
    }))
    .filter((suggestion) => startsWithQuery(suggestion.value, q));
}

async function fetchTaxonSearchSuggestions(fieldInfo, q) {
  if (!fieldInfo?.exactField) return [];

  const body = {
    size: 0,
    track_total_hits: false,
    query: buildPrefixQuery(fieldInfo, q),
    aggs: {
      values: {
        terms: {
          field: fieldInfo.exactField,
          size: TAXON_SEARCH_BUCKET_SIZE,
          order: {
            _count: "desc",
          },
        },
      },
    },
  };

  const response = await fetchSearch(body);

  return (response?.aggregations?.values?.buckets || [])
    .map((bucket) => ({
      value: normalizeValue(bucket.key),
      count: Number(bucket.doc_count || 0),
    }))
    .filter((bucket) => startsWithQuery(bucket.value, q));
}

function classifyTaxonSearchValue(value, genusValues, familyValues) {
  const normalized = normalizeValue(value);
  const lower = normalizeKey(normalized);

  if (normalized.includes(" ")) {
    return {
      field: "scientificName",
      rank: "species",
    };
  }

  if (familyValues.has(lower) || /aceae$/i.test(normalized)) {
    return {
      field: "standardizedFamily",
      rank: "family",
    };
  }

  if (genusValues.has(lower)) {
    return {
      field: "genus",
      rank: "genus",
    };
  }

  return null;
}

function addSuggestion(suggestions, seen, suggestion) {
  const value = normalizeValue(suggestion?.value);
  const field = String(suggestion?.field || "").trim();
  if (!value || !field) return;

  const key = `${field}:${normalizeKey(value)}`;
  const incomingCount = Number(suggestion._count || 0);
  const existing = seen.get(key);
  if (existing) {
    existing._count += incomingCount;
    if (incomingCount > (existing._bestCount || 0)) {
      existing.label = normalizeValue(suggestion.label || value);
      existing.rank = normalizeValue(suggestion.rank || field);
      existing.value = value;
      existing._bestCount = incomingCount;
    }
    return;
  }

  const normalized = {
    label: normalizeValue(suggestion.label || value),
    rank: normalizeValue(suggestion.rank || field),
    field,
    value,
    _count: incomingCount,
    _bestCount: incomingCount,
  };
  seen.set(key, normalized);
  suggestions.push(normalized);
}

function sortExactRankSuggestions(a, b) {
  const labelSort = a.label.localeCompare(b.label);
  if (labelSort !== 0) return labelSort;
  return a.field.localeCompare(b.field);
}

function sortSuggestions(a, b) {
  const fieldOrder = {
    standardizedFamily: 0,
    family: 0,
    genus: 0,
    scientificName: 1,
  };
  const aFieldOrder = fieldOrder[a.field] ?? 2;
  const bFieldOrder = fieldOrder[b.field] ?? 2;

  if (aFieldOrder !== bFieldOrder) return aFieldOrder - bFieldOrder;
  if (a._count !== b._count) return b._count - a._count;

  const labelSort = a.label.localeCompare(b.label);
  if (labelSort !== 0) return labelSort;
  return a.field.localeCompare(b.field);
}

async function getTaxonSuggestions(q) {
  const queryText = normalizeValue(q);
  if (!queryText) return [];

  let fields;
  try {
    fields = resolveTaxonFields(await getMapping());
  } catch (error) {
    fields = fallbackTaxonFields();
  }

  const [genusSuggestions, familySuggestions, taxonSearchBuckets] = await Promise.all([
    fetchKeywordSuggestions(fields.genus, "genus", "genus", queryText),
    fetchKeywordSuggestions(fields.family, "standardizedFamily", "family", queryText),
    fetchTaxonSearchSuggestions(fields.taxonSearch, queryText),
  ]);

  const genusValues = new Set(genusSuggestions.map((suggestion) => normalizeKey(suggestion.value)));
  const familyValues = new Set(familySuggestions.map((suggestion) => normalizeKey(suggestion.value)));
  const suggestions = [];
  const seen = new Map();

  [...genusSuggestions, ...familySuggestions]
    .sort(sortExactRankSuggestions)
    .slice(0, MAX_EXACT_RANK_SUGGESTIONS)
    .forEach((suggestion) => addSuggestion(suggestions, seen, suggestion));

  taxonSearchBuckets.forEach((bucket) => {
    const classification = classifyTaxonSearchValue(bucket.value, genusValues, familyValues);
    if (!classification) return;

    addSuggestion(suggestions, seen, {
      label: bucket.value,
      value: bucket.value,
      field: classification.field,
      rank: classification.rank,
      _count: bucket.count,
    });
  });

  return suggestions
    .sort(sortSuggestions)
    .slice(0, MAX_SUGGESTIONS)
    .map(({ _count, _bestCount, ...suggestion }) => suggestion);
}

module.exports = {
  getTaxonSuggestions,
  resolveTaxonFields,
};
