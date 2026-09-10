(function initPhenobaseSourceCitations(root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PhenobaseSourceCitations = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function buildSourceCitationApi(root) {
  const citationData = (root && root.PhenobaseSourceCitationData)
    || (typeof require === "function" ? require("./source-citations-data") : { sources: [] });

  const MONTH_ABBR = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];

  const FALLBACK_CITATION_TEMPLATE = (
    "Phenobase. {year}. Phenobase: a global resource for plant phenology data " +
    "(https://phenobase.org). [Date range of data used], Dataset accessed {accessDate}."
  );

  const SHARED_ACKNOWLEDGEMENT_PREFIX = (
    "We thank the following organizations whose many professional and volunteer " +
    "participants contributed data: "
  );

  const SOURCES = Array.isArray(citationData.sources)
    ? citationData.sources.slice().sort((left, right) => {
      const leftOrder = Number(left.citationOrder || 9999);
      const rightOrder = Number(right.citationOrder || 9999);
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return String(left.dataSource || "").localeCompare(String(right.dataSource || ""));
    })
    : [];

  function normalizeSourceKey(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  }

  function sourceByName() {
    const lookup = new Map();
    SOURCES.forEach((source) => {
      if (!source.dataSource) return;
      lookup.set(source.dataSource, source);
    });
    return lookup;
  }

  function aliasMap() {
    const aliases = new Map();
    SOURCES.forEach((source) => {
      const dataSource = String(source.dataSource || "").trim();
      if (!dataSource) return;
      aliases.set(normalizeSourceKey(dataSource), dataSource);
      (source.sourceAliases || []).forEach((alias) => {
        aliases.set(normalizeSourceKey(alias), dataSource);
      });
    });
    return aliases;
  }

  function canonicalDataSource(dataSource) {
    const source = String(dataSource || "").trim();
    return aliasMap().get(normalizeSourceKey(source)) || source;
  }

  function formatAccessDate(accessDate) {
    const value = accessDate || new Date();
    if (typeof value === "string") return value;
    return `${MONTH_ABBR[value.getMonth()]} ${value.getDate()}, ${value.getFullYear()}`;
  }

  function accessYear(accessDate) {
    const value = accessDate || new Date();
    if (typeof value === "string") {
      const match = value.match(/\b(20\d{2}|19\d{2})\b/);
      return match ? match[1] : value;
    }
    return String(value.getFullYear());
  }

  function renderCitationTemplate(template, accessDate) {
    return String(template || FALLBACK_CITATION_TEMPLATE)
      .replace(/\{year\}/g, accessYear(accessDate))
      .replace(/\{accessDate\}/g, formatAccessDate(accessDate))
      .replace(/\{access_date\}/g, formatAccessDate(accessDate));
  }

  function sourceCountEntries(dataSources) {
    if (!dataSources) return [];
    const entries = Array.isArray(dataSources)
      ? dataSources.map((dataSource) => [dataSource, null])
      : Object.entries(dataSources);
    return entries
      .filter(([dataSource, count]) => dataSource && (count == null || Number(count) > 0))
      .map(([dataSource, count]) => [String(dataSource), count == null ? null : Number(count)]);
  }

  function sourceCountsFromRecords(records) {
    const counts = {};
    (records || []).forEach((record) => {
      const dataSource = String(record?.dataSource || "").trim();
      if (!dataSource) return;
      counts[dataSource] = (counts[dataSource] || 0) + 1;
    });
    return counts;
  }

  function orderedSourceCountEntries(dataSources) {
    const order = new Map(SOURCES.map((source) => [source.dataSource, Number(source.citationOrder || 9999)]));
    return sourceCountEntries(dataSources).sort(([left], [right]) => {
      const leftOrder = order.has(canonicalDataSource(left)) ? order.get(canonicalDataSource(left)) : 9999;
      const rightOrder = order.has(canonicalDataSource(right)) ? order.get(canonicalDataSource(right)) : 9999;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return left.localeCompare(right);
    });
  }

  function citationForDataSource(dataSource, accessDate) {
    const canonical = canonicalDataSource(dataSource);
    const source = sourceByName().get(canonical) || {};
    return renderCitationTemplate(source.citationText, accessDate);
  }

  function sourceCitationRows(dataSources, accessDate) {
    return orderedSourceCountEntries(dataSources).map(([dataSource, count]) => ({
      dataSource,
      recordCount: count == null ? "" : count,
      citationText: citationForDataSource(dataSource, accessDate),
    }));
  }

  function acknowledgementsForDataSources(dataSources) {
    const sources = sourceByName();
    const canonicalSources = orderedSourceCountEntries(dataSources)
      .map(([dataSource]) => canonicalDataSource(dataSource));
    const names = canonicalSources
      .map((dataSource) => sources.get(dataSource)?.acknowledgementName)
      .filter((name, index, allNames) => name && allNames.indexOf(name) === index);
    const acknowledgements = [];
    if (names.length) {
      acknowledgements.push(`${SHARED_ACKNOWLEDGEMENT_PREFIX}${names.join(", ")}.`);
    }
    canonicalSources
      .map((dataSource) => sources.get(dataSource)?.acknowledgementText)
      .forEach((text) => {
        if (text && !acknowledgements.includes(text)) acknowledgements.push(text);
      });
    return acknowledgements;
  }

  function citationMarkdown(dataSources, accessDate) {
    const lines = [
      "# Citations",
      "",
      "Use the citation below for each data source included in this download. " +
        "Bracketed placeholders such as [Date range of data used] are intentionally retained for users to complete.",
      "",
      "## Source Citations",
      "",
    ];

    const rows = sourceCitationRows(dataSources, accessDate);
    if (rows.length) {
      rows.forEach((row) => {
        lines.push(`### ${row.dataSource}`, "", row.citationText, "");
      });
    } else {
      lines.push("No source records were exported.", "");
    }

    const acknowledgements = acknowledgementsForDataSources(dataSources);
    if (acknowledgements.length) {
      lines.push("## Acknowledgements", "");
      acknowledgements.forEach((acknowledgement) => {
        lines.push(acknowledgement, "");
      });
    }

    return `${lines.join("\n").trim()}\n`;
  }

  function sourceCitationsCsv(dataSources, accessDate, escapeCsvValue) {
    const escape = escapeCsvValue || ((value) => {
      const text = String(value ?? "");
      return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    });
    const fields = ["dataSource", "recordCount", "citationText"];
    const lines = [fields.map(escape).join(",")];
    sourceCitationRows(dataSources, accessDate).forEach((row) => {
      lines.push(fields.map((field) => escape(row[field])).join(","));
    });
    return `${lines.join("\n")}\n`;
  }

  function citationAndPoliciesText(dataSources, accessDate) {
    return citationMarkdown(dataSources, accessDate).replace(/^# Citations/, "Citation and data use policy");
  }

  return {
    acknowledgementsForDataSources,
    citationAndPoliciesText,
    citationForDataSource,
    citationMarkdown,
    sourceCitationRows,
    sourceCitationsCsv,
    sourceCountsFromRecords,
  };
}));
