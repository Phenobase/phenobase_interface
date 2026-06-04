const DEFAULT_SEARCH_URL =
  "https://biscicol.org/phenobase/api/v1/query//phenobase2/_search";
const DEFAULT_MAPPING_URL =
  "https://biscicol.org/phenobase/api/v1/query//phenobase2/_mapping";

const DEFAULT_LIMIT = 100000;
const MAX_LIMIT = 100000;
const PAGE_SIZE = 1000;
const REQUIRED_DOWNLOAD_FIELDS = ["observedMetadataUrl"];

let mappingCache = null;
let crcTable = null;

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

async function getMappedFields() {
  const properties = getProperties(await getMapping());
  const fields = Object.keys(properties);
  const fieldSet = new Set(fields);
  const missingRequired = REQUIRED_DOWNLOAD_FIELDS.filter((field) => !fieldSet.has(field));

  if (missingRequired.length) {
    throw new Error(`Download mapping is missing required field(s): ${missingRequired.join(", ")}`);
  }

  return fields;
}

function parseDownloadLimit(rawLimit) {
  const limit = Number(rawLimit || DEFAULT_LIMIT);
  if (!Number.isFinite(limit) || limit <= 0) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(limit)));
}

function parseDownloadQuery(rawQuery) {
  if (!rawQuery) return { match_all: {} };

  const parsed = JSON.parse(rawQuery);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Download query must be a JSON object.");
  }
  return parsed;
}

function totalHitsValue(response) {
  const total = response?.hits?.total;
  if (typeof total === "number") return total;
  if (total && typeof total.value === "number") return total.value;
  return null;
}

async function fetchSearchPage(query, size, searchAfter, trackTotalHits) {
  const body = {
    size,
    _source: true,
    query: query || { match_all: {} },
    sort: [
      {
        annotationID: {
          order: "asc",
          missing: "_last",
        },
      },
    ],
    track_total_hits: !!trackTotalHits,
  };

  if (searchAfter) {
    body.search_after = searchAfter;
  }

  return fetchJson(getSearchUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function fetchRecords(query, limit) {
  const records = [];
  let searchAfter = null;
  let totalPossible = null;

  while (records.length < limit) {
    const size = Math.min(PAGE_SIZE, limit - records.length);
    const response = await fetchSearchPage(query, size, searchAfter, records.length === 0);
    const hits = response?.hits?.hits || [];

    if (records.length === 0) {
      totalPossible = totalHitsValue(response);
    }

    if (!hits.length) break;

    hits.forEach((hit) => {
      records.push(hit._source || {});
    });

    const lastHit = hits[hits.length - 1];
    searchAfter = lastHit?.sort;
    if (!searchAfter || hits.length < size) break;
  }

  return {
    records,
    totalPossible,
  };
}

function valueToCsvText(value) {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(valueToCsvText).join(",");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function escapeCsvValue(value) {
  const text = valueToCsvText(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function csvFromRecords(records, mappedFields) {
  const fields = mappedFields.slice();
  const fieldSet = new Set(fields);

  records.forEach((record) => {
    Object.keys(record || {}).forEach((field) => {
      if (fieldSet.has(field)) return;
      fieldSet.add(field);
      fields.push(field);
    });
  });

  const lines = [fields.map(escapeCsvValue).join(",")];
  records.forEach((record) => {
    lines.push(fields.map((field) => escapeCsvValue(record?.[field])).join(","));
  });

  return {
    csv: `${lines.join("\n")}\n`,
    fields,
  };
}

function rowsWithValue(records, field) {
  return records.reduce((count, record) => {
    const value = record?.[field];
    if (Array.isArray(value)) return count + (value.length ? 1 : 0);
    if (value == null || String(value).trim() === "") return count;
    return count + 1;
  }, 0);
}

function deriveObservedMetadataUrl(record) {
  const existingUrl = String(record?.observedMetadataUrl || "").trim();
  if (existingUrl) return existingUrl;

  const rawId = String(record?.annotationID || "").trim();
  const npnId = rawId.startsWith("npn:")
    ? rawId.slice(4)
    : (/^\d+$/.test(rawId) && /national phenology network/i.test(String(record?.dataSource || "")) ? rawId : "");

  if (!npnId) return "";
  return `https://services.usanpn.org/npn_portal/observations/getObservationById.json?request_src=PPO&observation_id=${encodeURIComponent(npnId)}&pretty=1`;
}

function enrichDownloadRecord(record) {
  const enriched = { ...(record || {}) };
  if (!String(enriched.observedMetadataUrl || "").trim()) {
    const derivedUrl = deriveObservedMetadataUrl(enriched);
    if (derivedUrl) enriched.observedMetadataUrl = derivedUrl;
  }
  return enriched;
}

function makeCrcTable() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
}

function crc32(buffer) {
  if (!crcTable) crcTable = makeCrcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = crcTable[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosDate, dosTime };
}

function createZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const { dosDate, dosTime } = dosDateTime();

  entries.forEach((entry) => {
    const nameBuffer = Buffer.from(entry.name, "utf8");
    const dataBuffer = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data || ""), "utf8");
    const crc = crc32(dataBuffer);

    const localHeader = Buffer.alloc(30 + nameBuffer.length);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(dataBuffer.length, 18);
    localHeader.writeUInt32LE(dataBuffer.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);
    nameBuffer.copy(localHeader, 30);

    localParts.push(localHeader, dataBuffer);

    const centralHeader = Buffer.alloc(46 + nameBuffer.length);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(dataBuffer.length, 20);
    centralHeader.writeUInt32LE(dataBuffer.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    nameBuffer.copy(centralHeader, 46);

    centralParts.push(centralHeader);
    offset += localHeader.length + dataBuffer.length;
  });

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

function downloadReadme({ query, limit, totalPossible, returned, fields, observedMetadataUrlRows }) {
  return [
    "The following contains information about your download from the Global Plant Phenology Database.",
    "",
    "data file = data.csv",
    `date query ran = ${new Date().toString()}`,
    `query = ${JSON.stringify(query)}`,
    "fields returned = all mapped Phenobase fields",
    `field count = ${fields.length}`,
    "required field observedMetadataUrl included = yes",
    `rows with observedMetadataUrl value = ${observedMetadataUrlRows}`,
    `user specified limit = ${limit}`,
    `total results possible = ${totalPossible == null ? "unknown" : totalPossible.toLocaleString()}`,
    `total results returned = ${returned.toLocaleString()}`,
    "",
  ].join("\n");
}

function citationAndPoliciesText() {
  return [
    "Citation and data use policy",
    "",
    "Use of these data should cite Phenobase and the contributing source datasets represented in the download.",
    "Review source-specific licensing and citation requirements before redistribution or publication.",
    "",
  ].join("\n");
}

async function createPhenobaseDownload({ query, limit }) {
  const mappedFields = await getMappedFields();
  const { records, totalPossible } = await fetchRecords(query, limit);
  const enrichedRecords = records.map(enrichDownloadRecord);
  const { csv, fields } = csvFromRecords(enrichedRecords, mappedFields);
  const observedMetadataUrlRows = rowsWithValue(enrichedRecords, "observedMetadataUrl");
  const readme = downloadReadme({
    query,
    limit,
    totalPossible,
    returned: records.length,
    fields,
    observedMetadataUrlRows,
  });

  const buffer = createZip([
    { name: "README.txt", data: readme },
    { name: "citation_and_data_use_policies.txt", data: citationAndPoliciesText() },
    { name: "data.csv", data: csv },
  ]);

  return {
    buffer,
    contentType: "application/zip",
    fileName: "phenobase_data.zip",
    recordCount: records.length,
    totalPossible,
    fields,
  };
}

module.exports = {
  MAX_LIMIT,
  createPhenobaseDownload,
  parseDownloadLimit,
  parseDownloadQuery,
};
