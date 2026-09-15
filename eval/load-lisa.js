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

/**
 * buildLeanExport() — Produce the same lean export as downloadJSON().
 * This is what the user actually downloads / hands off.
 */
function buildLeanExport(compressed, rawMessages) {
  const tokens = compressed.semanticTokens || compressed.compressed || [];
  const messages = tokens.map(t => ({
    role: t.role,
    index: t.index,
    summary: t.summary
  }));

  const anchors = Object.fromEntries(
    Object.entries(compressed.semantic_anchors || {}).map(([k, { content, ...rest }]) => {
      // Strip null values and empty arrays to save tokens
      const clean = {};
      for (const [field, val] of Object.entries(rest)) {
        if (val === null || val === undefined) continue;
        if (Array.isArray(val) && val.length === 0) continue;
        if (val === 'general') continue; // default topic adds no signal
        clean[field] = val;
      }
      return [k, clean];
    })
  );

  const leanPayload = {
    _instructions: 'LISA semantic export. Read anchor for session context. Use messages[].summary for condensed turns.',
    platform: compressed.metadata?.platform || 'Unknown',
    title: compressed.metadata?.title || '',
    messageCount: compressed.metadata?.messageCount || messages.length,
    messages,
    format: 'compressed',
    anchor: compressed.anchor || '',
    semantic_anchors: anchors,
    session_metadata: compressed.session_metadata || {}
  };

  // Compression gate: compare compressed vs verbatim, pick smaller
  if (rawMessages) {
    const verbatimPayload = {
      _instructions: 'LISA verbatim export. Compression skipped — original shorter than compressed.',
      platform: leanPayload.platform,
      title: leanPayload.title,
      messageCount: rawMessages.length,
      messages: rawMessages.map((m, i) => ({ role: m.role, index: i, content: m.content })),
      format: 'verbatim',
      isVerbatim: true,
      session_metadata: leanPayload.session_metadata
    };
    if (JSON.stringify(verbatimPayload).length < JSON.stringify(leanPayload).length) {
      return verbatimPayload;
    }
  }

  return leanPayload;
}

/**
 * buildMarkdownExport() — Markdown handoff format for paste-to-AI.
 * Same data as lean JSON, rendered as prose. Models tokenize prose
 * far more efficiently than nested JSON keys/brackets.
 */
function buildMarkdownExport(compressed, rawMessages) {
  const tokens = compressed.semanticTokens || compressed.compressed || [];
  const anchor = compressed.anchor || {};
  const glossary = compressed.glossary || {};

  const lines = [];

  // Header
  lines.push('# LISA Handoff');
  lines.push('');
  const platform = compressed.metadata?.platform || 'Unknown';
  const title = compressed.metadata?.title || '';
  if (title) lines.push('> ' + title);
  lines.push('> Platform: ' + platform + ' | Messages: ' + tokens.length);
  lines.push('');

  // Anchor block — session context
  lines.push('## Session Context');
  if (anchor.core_topic) lines.push('- Topic: ' + anchor.core_topic);
  if (anchor.session_register) lines.push('- Register: ' + anchor.session_register);
  if (anchor.dominant_concepts) lines.push('- Key concepts: ' + anchor.dominant_concepts.join(', '));
  if (anchor.key_entities) lines.push('- Entities: ' + anchor.key_entities.join(', '));

  // Register-shaped events
  const eventKeys = ['files_changed','decisions','open_tasks','constraints','conclusions','open_questions','resolutions','follow_ups'];
  eventKeys.forEach(k => {
    if (anchor[k] && (Array.isArray(anchor[k]) ? anchor[k].length > 0 : true)) {
      const label = k.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
      if (Array.isArray(anchor[k]) && typeof anchor[k][0] === 'string') {
        lines.push('- ' + label + ': ' + anchor[k].join(', '));
      } else if (Array.isArray(anchor[k])) {
        lines.push('- ' + label + ':');
        anchor[k].forEach(item => {
          if (typeof item === 'object' && item.proposal) {
            lines.push('  - ' + item.proposal);
          } else if (typeof item === 'object' && item.text) {
            lines.push('  - ' + item.text);
          } else {
            lines.push('  - ' + JSON.stringify(item));
          }
        });
      }
    }
  });
  lines.push('');

  // Glossary
  if (Object.keys(glossary).length > 0) {
    lines.push('## Glossary');
    Object.entries(glossary).forEach(([short, full]) => {
      lines.push('- ' + short + ' = ' + full);
    });
    lines.push('');
  }

  // Conversation
  lines.push('## Conversation');
  lines.push('');
  tokens.forEach(t => {
    const role = (t.role || 'user').charAt(0).toUpperCase() + (t.role || 'user').slice(1);
    lines.push('### ' + role);
    lines.push(t.summary || '');
    lines.push('');
  });

  const md = lines.join('\n');

  // Compression gate: compare markdown vs verbatim markdown
  if (rawMessages) {
    const verbatimLines = ['# LISA Handoff (verbatim)', ''];
    rawMessages.forEach(m => {
      const role = (m.role || 'user').charAt(0).toUpperCase() + (m.role || 'user').slice(1);
      verbatimLines.push('### ' + role);
      verbatimLines.push(m.content || '');
      verbatimLines.push('');
    });
    const verbatim = verbatimLines.join('\n');
    if (verbatim.length < md.length) return verbatim;
  }

  return md;
}

module.exports = { loadLisa, pipeline, buildLeanExport, buildMarkdownExport };
