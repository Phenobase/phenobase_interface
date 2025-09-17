/* app.traits.js
 * Trait-hierarchy helper (no UI). DAG-friendly + cycle-safe + case-insensitive label lookup.
 *
 * Public API on window.PhenoTraits:
 *   - isHiddenRoot(label)
 *   - baseLabel(s)
 *   - loadHierarchy(csvUrl) -> { roots, nodesByLabel }
 *   - attachCountsAndAggregate(roots, nodesByLabel, mtBuckets) -> Map(labelLower -> count)
 *   - collectLeaves(node, mtCountsLC, opts) -> Set(mappedTraits labels)
 *   - findNodeByLabel(nodesByLabel, label)  // case-insensitive
 *   - findAbsentPartnerFor(node, nodesByLabel) // pairs "... present" <-> "... absent"
 *
 * Requires PapaParse (include before this file):
 *   <script src="https://cdn.jsdelivr.net/npm/papaparse@5.4.1/papaparse.min.js"></script>
 */

(function () {
  const HIDDEN_ROOT_LABEL = 'plant structure present';

  /* ----------------- utils ----------------- */
  function normalize(s) {
    return String(s || '').trim();
  }
  function isHiddenRoot(label) {
    return normalize(label).toLowerCase() === HIDDEN_ROOT_LABEL;
  }
  function baseLabel(s) {
    return String(s || '')
      .replace(/\b(present|absent)\b/ig, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function parseCsv(url) {
    return new Promise((resolve, reject) => {
      if (!window.Papa) return reject(new Error('PapaParse missing (include it before app.traits.js)'));
      Papa.parse(url, {
        download: true,
        header: true,
        skipEmptyLines: true,
        complete: (res) => resolve(res.data || []),
        error: reject,
      });
    });
  }

  /* ----------------- DAG builder ----------------- */
  function buildHierarchyFromCsvRows(rows) {
    const nodesById = new Map();           // id -> node
    const nodesByLabel = new Map();        // exact label -> node
    const nodesByLabelLC = new Map();      // lowercased label -> node (for case-insensitive find)

    function setLabelIndexes(node, label) {
      const clean = normalize(label);
      if (!clean) return;
      node.label = clean;
      nodesByLabel.set(clean, node);
      nodesByLabelLC.set(clean.toLowerCase(), node);
    }

    function ensureNode(id, label) {
      if (!id) return null;
      let node = nodesById.get(id);
      if (!node) {
        node = { id, label: '', children: [], parents: new Set(), self: 0, total: 0 };
        nodesById.set(id, node);
      }
      if (label) setLabelIndexes(node, label);
      return node;
    }

    // Reachability to prevent cycles: is 'target' reachable from 'start' following children?
    function isReachable(start, target) {
      if (!start || !target) return false;
      if (start === target) return true;
      const stack = [start];
      const seen = new Set();
      while (stack.length) {
        const n = stack.pop();
        if (!n || seen.has(n)) continue;
        if (n === target) return true;
        seen.add(n);
        for (const c of n.children) stack.push(c);
      }
      return false;
    }

    function addEdge(parent, child) {
      if (!parent || !child) return;
      // Prevent creating a cycle: parent must NOT be reachable from child
      if (isReachable(child, parent)) return; // skip edge to avoid cycle
      if (!parent.children.includes(child)) parent.children.push(child);
      child.parents.add(parent);
    }

    // Pass 1: create all nodes (IDs + labels) so mid-level nodes exist
    for (const row of rows) {
      const idsRaw = String(row.mappedTraitIDs || '');
      const lblRaw = String(row.mappedTraits || '');
      const ids = idsRaw.split('|').map(normalize).filter(Boolean);
      const labels = lblRaw.split('|'); // keep positions; normalize when assigning
      for (let i = 0; i < ids.length; i++) {
        ensureNode(ids[i], labels[i] || '');
      }
    }

    // Pass 2: link parent → child along each path (CSV is leaf -> ... -> root)
    for (const row of rows) {
      const ids = String(row.mappedTraitIDs || '').split('|').map(normalize).filter(Boolean);
      if (ids.length < 2) continue;
      for (let i = 0; i < ids.length - 1; i++) {
        const child = nodesById.get(ids[i]);
        const parent = nodesById.get(ids[i + 1]);
        addEdge(parent, child);
      }
    }

    // Roots = nodes with no parents
    const roots = [];
    for (const node of nodesById.values()) {
      if (!node.parents || node.parents.size === 0) roots.push(node);
    }

    // Expose both maps; keep LC map in closure for findNodeByLabel
    return { roots, nodesByLabel, _lc: nodesByLabelLC };
  }

  /* ----------------- counts + rollups ----------------- */
  // Returns Map<labelLower -> count]; sets node.self and node.total (unique-sum over subgraph)
  function attachCountsAndAggregate(roots, nodesByLabel, mtBuckets) {
    // Case-insensitive counts from ES buckets
    const mtCountsLC = new Map((mtBuckets || []).map(b => [normalize(b.key).toLowerCase(), b.doc_count || 0]));

    // Seed self counts
    for (const node of nodesByLabel.values()) {
      node.self = mtCountsLC.get((node.label || '').toLowerCase()) || 0;
      node.total = 0;
    }

    // Unique-sum over a node's reachable subgraph (cycle-safe).
    const memo = new WeakMap();
    function uniqueSum(node) {
      if (!node) return 0;
      if (memo.has(node)) return memo.get(node);
      let s = 0;
      const seen = new Set();
      const stack = [node];
      while (stack.length) {
        const n = stack.pop();
        if (!n || seen.has(n)) continue;
        seen.add(n);
        s += n.self;
        for (const c of n.children) stack.push(c);
      }
      memo.set(node, s);
      return s;
    }

    for (const node of nodesByLabel.values()) {
      node.total = uniqueSum(node);
    }

    // Fallback: if total ended up 0 but self > 0, keep self
    for (const n of nodesByLabel.values()) {
      if (n.total === 0 && n.self > 0) n.total = n.self;
    }

    return mtCountsLC;
  }

  /* ----------------- selection helpers ----------------- */
  // Collect all descendant labels that have ES counts (including node itself optionally). Cycle-safe.
  function collectLeaves(node, mtCountsLC, { includeSelf = true, filterHidden = true } = {}) {
    const out = new Set();
    const stack = [node];
    const seen = new Set();

    while (stack.length) {
      const n = stack.pop();
      if (!n || seen.has(n)) continue;
      seen.add(n);

      const keyLC = (n.label || '').toLowerCase();
      const counted = mtCountsLC.has(keyLC);
      const hidden = filterHidden && isHiddenRoot(n.label);

      if ((includeSelf || n !== node) && counted && !hidden) {
        out.add(n.label); // keep original label casing for the UI/query
      }
      for (const c of n.children) stack.push(c);
    }
    return out;
  }

  // Case-insensitive node lookup (prefers exact label match if present)
  function findNodeByLabel(nodesByLabel, label) {
    if (!label) return null;
    const exact = nodesByLabel.get(normalize(label));
    if (exact) return exact;
    const lcMap = findNodeByLabel._lcMap;
    if (lcMap) return lcMap.get(normalize(label).toLowerCase()) || null;
    return null;
  }

  // Pair "... present" with "... absent"
  function findAbsentPartnerFor(node, nodesByLabel) {
    const base = baseLabel(node.label);
    if (!base) return null;
    const candidate = `${base} absent`;
    return findNodeByLabel(nodesByLabel, candidate);
  }

  /* ----------------- public API ----------------- */
  window.PhenoTraits = {
    isHiddenRoot,
    baseLabel,
    async loadHierarchy(csvUrl) {
      const rows = await parseCsv(csvUrl);
      const { roots, nodesByLabel, _lc } = buildHierarchyFromCsvRows(rows);
      findNodeByLabel._lcMap = _lc; // case-insensitive lookups
      return { roots, nodesByLabel };
    },
    attachCountsAndAggregate,
    collectLeaves,
    findNodeByLabel,
    findAbsentPartnerFor,
  };
})();

