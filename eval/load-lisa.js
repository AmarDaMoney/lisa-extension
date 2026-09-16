/**
 * load-lisa.js — Load LISA extension code into a Node.js VM context.
 *
 * The extension files aren't modules: service-worker.js uses importScripts,
 * SemanticAnalyzer is a top-level const, LocalDisambiguator attaches to window.
 * A vm context with Chrome API stubs handles all of it.
 */
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');

function loadLisa() {
  const ctx = { console, setTimeout, clearTimeout, Math, Date, Object, Array, Set, Map,
                String, Number, JSON, RegExp, Error, TypeError, parseInt, parseFloat,
                isNaN, isFinite, encodeURIComponent, decodeURIComponent,
                Promise, structuredClone, Symbol, Proxy, Reflect, WeakMap, WeakSet };
  ctx.setInterval = setInterval; ctx.clearInterval = clearInterval;
  ctx.self = ctx;
  ctx.window = ctx;
  ctx.globalThis = ctx;

  // Chrome API stubs — Proxy-based catch-all so we don't play whack-a-mole
  const noop = () => {};
  const listener = { addListener: noop, removeListener: noop, hasListener: () => false };
  const handler = {
    get(_, prop) {
      if (prop === 'addListener' || prop === 'removeListener') return noop;
      if (prop === 'hasListener') return () => false;
      if (prop === 'get') return (_, cb) => cb && cb({});
      if (prop === 'set') return (_, cb) => cb && cb();
      if (prop === 'getManifest') return () => ({ version: '0.52.7' });
      if (prop === 'getURL') return p => p;
      if (prop === 'query') return (_, cb) => { if (cb) cb([]); return []; };
      if (prop === 'create') return noop;
      if (prop === 'sendMessage') return noop;
      if (prop === 'setUninstallURL') return noop;
      if (prop === 'remove') return noop;
      if (typeof prop === 'symbol') return undefined;
      return new Proxy({}, handler);
    },
    apply() { return undefined; }
  };
  ctx.chrome = new Proxy({}, handler);

  vm.createContext(ctx);

  const run = (f) => {
    const code = fs.readFileSync(f, 'utf8');
    vm.runInContext(code, ctx, { filename: f });
  };

  // importScripts stub — resolves relative to background/
  ctx.importScripts = (...rel) =>
    rel.forEach(r => run(path.join(SRC, 'background', r)));

  // Load in production order
  run(path.join(SRC, 'shared', 'snapshot-shim.js'));
  run(path.join(SRC, 'lib', 'compromise.js'));
  run(path.join(SRC, 'utils', 'local-disambiguator.js'));
  run(path.join(SRC, 'utils', 'semantic-analyzer.js'));
  run(path.join(SRC, 'background', 'service-worker.js'));

  // Pull classes/constructors out of the VM scope
  return vm.runInContext(
    '({ LISACompressor, SemanticAnalyzer, LocalDisambiguator, readSnapshot })',
    ctx
  );
}

/**
 * pipeline() — Reproduce the exact production flow from popup.js:882-918.
 * Measures what users actually get.
 */
function pipeline(lisa, raw) {
  const { LISACompressor, SemanticAnalyzer, LocalDisambiguator } = lisa;
  const data = structuredClone(raw);

  // 1. Local disambiguation (NER only — coref rewrite disabled in v0.52.7)
  if (LocalDisambiguator && data.messages) {
    try {
      const allText = data.messages.map(m => m.content || '').join('\n');
      const result = LocalDisambiguator.disambiguate(allText);
      data.localEntities = result.entities;
      data.disambigStats = result.stats;
    } catch (e) {
      // Skip silently, same as popup
    }
  }

  // 2. Semantic enrichment
  if (SemanticAnalyzer) {
    try {
      const enriched = SemanticAnalyzer.analyze(data);
      if (enriched && enriched.session_metadata && enriched.session_metadata.enriched) {
        Object.assign(data, enriched);
      }
    } catch (e) {
      // Skip silently
    }
  }

  // 3. Compress
  const compressor = new LISACompressor();
  const compressed = compressor.compress(data);

  // 4. Merge enrichment (same as popup merge block)
  if (data.semantic_anchors) compressed.semantic_anchors = data.semantic_anchors;
  if (data.action_vectors) compressed.action_vectors = data.action_vectors;
  if (data.flow_metrics) compressed.flow_metrics = data.flow_metrics;
  if (data.reconstruction_protocol) compressed.reconstruction_protocol = data.reconstruction_protocol;
  if (data.localEntities) compressed.localEntities = data.localEntities;
  if (data.disambigStats) compressed.disambigStats = data.disambigStats;
  if (data.session_metadata) {
    compressed.session_metadata = compressed.session_metadata || {};
    Object.assign(compressed.session_metadata, data.session_metadata);
  }

  return compressed;
}

// Export builders — canonical source in src/shared/export-builders.js
const { buildLeanExport, buildMarkdownExport } = require('../src/shared/export-builders');

module.exports = { loadLisa, pipeline, buildLeanExport, buildMarkdownExport };