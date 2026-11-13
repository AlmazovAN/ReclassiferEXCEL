// V4-04: immutable, read-only index of the already filtered Failure Classifier.
// No request text, engineering answers, runtime state or export policy is read here.
(function (root) {
  'use strict';
  const LEVELS = Object.freeze(['equipment', 'element', 'failure', 'cause']);
  const normalize = value => typeof value === 'string' ? value.replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ').trim().toLocaleLowerCase('ru-RU') : '';
  const key = path => JSON.stringify(path.map(normalize));
  const exactKey = path => JSON.stringify(path);
  const freeze = value => {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
    return value;
  };
  const validPath = (path, min, max) => Array.isArray(path) && path.length >= min &&
    path.length <= max && Array.from(path).every(value => typeof value === 'string' && normalize(value));
  const append = (map, k, value) => {
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(value);
  };
  function buildIndex(dataset, options = {}) {
    if (!dataset || !Array.isArray(dataset.records) ||
        !['valid', 'warning'].includes(dataset.validation?.status)) {
      throw new TypeError('V4 index requires a validated, filtered Failure Classifier Dataset');
    }
    const branches = [], exact = new Map(), normalized = new Map();
    const prefixes = new Map(), components = LEVELS.map(() => new Map());
    const diagnostics = { inputRows: dataset.records.length, incompleteRows: [],
      duplicateRows: [], normalizationCollisions: [],
      upstreamDuplicatesRemoved: dataset.meta?.duplicatesRemoved ?? null,
      upstreamNormalizationLoss: 'Variants removed by the upstream normalizer cannot be recovered' };
    dataset.records.forEach((record, row) => {
      // Raw workbooks and legacy arrays are not this API's input contract.
      if (!record || Array.isArray(record) || typeof record !== 'object' ||
          ['disabled', 'sadu'].some(field => Object.hasOwn(record, field))) {
        throw new TypeError('Use the existing Failure Classifier normalizer before indexing');
      }
      const path = LEVELS.map(field => record[field]);
      if (!validPath(path, 4, 4)) { diagnostics.incompleteRows.push(row); return; }
      const canonicalKey = exactKey(path);
      if (exact.has(canonicalKey)) { diagnostics.duplicateRows.push(row); return; }
      const branch = freeze({ id: branches.length, path: path.slice(), sourceRow: row });
      branches.push(branch);
      exact.set(canonicalKey, branch);
      append(normalized, key(path), branch);
      for (let i = 0; i < 4; i++) {
        append(prefixes, key(path.slice(0, i)), branch);
        append(components[i], normalize(path[i]), branch);
      }
    });
    for (const [normalizedPath, variants] of normalized) {
      if (variants.length > 1) diagnostics.normalizationCollisions.push({
        normalizedPath: JSON.parse(normalizedPath), paths: variants.map(x => x.path)
      });
    }
    const meta = dataset.meta || {};
    const provenance = {};
    for (const field of ['schemaVersion', 'dataVersion', 'dataFingerprint', 'fileName',
      'sourceType', 'sourceSheet', 'latestChangedAt', 'loadedAt']) {
      provenance[field] = typeof meta[field] === 'string' ? meta[field] : null;
    }
    provenance.versionIdentified = Boolean(provenance.dataFingerprint || provenance.dataVersion);
    const lookup = path => {
      if (!validPath(path, 4, 4)) return freeze({ status: 'INCOMPLETE', branches: [] });
      const candidates = normalized.get(key(path)) || [];
      const canonical = exact.get(exactKey(path));
      return freeze({ status: canonical ? 'EXACT' : candidates.length > 1 ? 'AMBIGUOUS' :
        candidates.length ? 'NORMALIZED' : 'NOT_FOUND',
      branches: canonical ? [canonical] : candidates.slice(),
      collision: candidates.length > 1 });
    };
    function byComponent(level, term) {
      const index = LEVELS.indexOf(level);
      if (index < 0 || !normalize(term)) throw new TypeError('Unknown level or empty term');
      const matches = (components[index].get(normalize(term)) || []).slice();
      return freeze({ branches: matches,
        equipment: [...new Set(matches.map(x => x.path[0]))],
        elements: [...new Set(matches.map(x => x.path[1]))] });
    }
    function children(prefix = []) {
      if (!validPath(prefix, 0, 3)) throw new TypeError('Prefix must contain 0..3 nonempty levels');
      const matches = prefixes.get(key(prefix)) || [];
      const values = [...new Set(matches.map(x => x.path[prefix.length]))];
      const canonicalPrefixes = [...new Set(matches.map(x => exactKey(x.path.slice(0, prefix.length))))];
      return freeze({ values, branches: matches.slice(), ambiguousPrefix: canonicalPrefixes.length > 1 });
    }
    const scopeMatches = (branch, scope) => scope.every((value, i) => normalize(branch.path[i]) === normalize(value));
    function validateRegistry(entries, isAlias) {
      if (!Array.isArray(entries)) throw new TypeError('Registry must be an array');
      return entries.map(entry => {
        const level = isAlias ? LEVELS.indexOf(entry?.level) : 3;
        const scope = entry?.scope ?? [];
        const kinds = isAlias ? ['equivalent', 'diagnostic'] :
          ['factual_cause', 'explicit_unknown', 'action_or_circumstance', 'symptom_or_disputed'];
        if (!entry || level < 0 || !validPath(scope, 0, level) ||
            !normalize(entry.canonical) || (isAlias && !normalize(entry.term)) ||
            !['approved', 'proposed'].includes(entry.status) ||
            !kinds.includes(entry.kind) || !normalize(entry.source)) {
          throw new TypeError('Registry entry needs level, canonical, scope, kind, status and source');
        }
        const targets = branches.filter(b => b.path[level] === entry.canonical && scopeMatches(b, scope));
        if (!targets.length) throw new TypeError('Registry target is absent from this classifier/scope');
        return freeze({ level: LEVELS[level], term: isAlias ? entry.term : entry.canonical,
          canonical: entry.canonical, scope: scope.slice(), kind: entry.kind,
          status: entry.status, source: entry.source });
      });
    }
    // Empty by default: engineering equivalents must be reviewed, never invented from a benchmark.
    const aliases = validateRegistry(options.aliases ?? [], true);
    // Exact label proposals from the existing baseline audit, NOT engineering approval.
    const labelKinds = {
      'Причина не установлена (Акт, фото)': 'explicit_unknown',
      'Монтаж': 'action_or_circumstance', 'Демонтаж': 'action_or_circumstance',
      'Настройка': 'action_or_circumstance', 'Тестирование оборудования': 'action_or_circumstance',
      'Дублирование заявки': 'action_or_circumstance',
      'Отказ не подтвержден': 'symptom_or_disputed',
      'Отказ не подтверждён': 'symptom_or_disputed',
      'Внутренний отказ (без признаков)': 'symptom_or_disputed'
    };
    const proposals = [...new Set(branches.map(b => b.path[3]))]
      .filter(cause => Object.hasOwn(labelKinds, cause)).map(canonical => ({
        canonical, kind: labelKinds[canonical], status: 'proposed', scope: [],
        source: 'User-provided dictionary; engineering approval pending'
      }));
    const semantics = validateRegistry(options.causeSemantics ?? proposals, false);
    function resolveAlias(level, term, prefix = []) {
      const position = LEVELS.indexOf(level);
      if (position < 0 || !normalize(term) || !validPath(prefix, 0, position))
        throw new TypeError('Invalid alias level, term or prefix');
      const entries = aliases.filter(a => a.level === level && normalize(a.term) === normalize(term));
      const matches = branches.filter(b => scopeMatches(b, prefix) && entries.some(a =>
        a.status === 'approved' && a.kind === 'equivalent' &&
        b.path[position] === a.canonical && scopeMatches(b, a.scope)));
      const values = [...new Set(matches.map(b => b.path[position]))];
      return freeze({ status: values.length > 1 ? 'AMBIGUOUS' : values.length ? 'RESOLVED' : 'UNRESOLVED',
        values, branches: matches, entries: entries.slice(), evidenceProven: false });
    }
    function causeSemantics(path) {
      const found = lookup(path);
      if (!['EXACT', 'NORMALIZED'].includes(found.status)) return freeze({
        status: found.status, kind: 'unreviewed', evidenceProven: false, requiresEngineeringReview: true });
      const branch = found.branches[0];
      const entries = semantics.filter(s => s.canonical === branch.path[3] && scopeMatches(branch, s.scope));
      const approved = entries.filter(s => s.status === 'approved');
      const kinds = [...new Set(approved.map(s => s.kind))];
      return freeze({ status: kinds.length > 1 ? 'CONFLICT' : kinds.length ? 'REVIEWED_LABEL' : 'UNREVIEWED',
        kind: kinds.length === 1 ? kinds[0] : 'unreviewed',
        suggestedKinds: [...new Set(entries.filter(s => s.status === 'proposed').map(s => s.kind))],
        entries: entries.slice(),
        evidenceProven: false, requiresEngineeringReview: kinds.length !== 1 || kinds[0] === 'symptom_or_disputed' });
    }
    const causeReviewRegister = () => freeze(branches.map(b => ({path: b.path, ...causeSemantics(b.path)})));
    diagnostics.uniqueBranches = branches.length;
    freeze(diagnostics); freeze(provenance); freeze(branches);
    return Object.freeze({ list: () => branches, lookup, children, byComponent,
      resolveAlias, causeSemantics, causeReviewRegister,
      aliases: freeze(aliases), provenance, diagnostics });
  }
  const api = Object.freeze({ version: '4.0.0-v4-04', levels: LEVELS, normalize, buildIndex });
  root.ReclassifierClassifierIndexV4 = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
