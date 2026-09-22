/**
 * export-builders.js — Canonical export payload builders.
 *
 * Single source of truth for both the extension (popup.html script tag)
 * and the eval harness (Node.js require).
 *
 * Browser: functions are globals.
 * Node:    module.exports = { buildLeanExport, buildMarkdownExport }
 */

/**
 * Build the lean JSON export payload from compressed data.
 * Returns the full download-ready object including compression gate.
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
      const clean = {};
      for (const [field, val] of Object.entries(rest)) {
        if (val === null || val === undefined) continue;
        if (Array.isArray(val) && val.length === 0) continue;
        if (val === 'general') continue;
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

  // Compression gate: if verbatim is smaller, export verbatim
  if (rawMessages && rawMessages.length > 0) {
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
 * Build the markdown handoff format from compressed data.
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

  // Anchor — session context
  lines.push('## Session Context');
  if (anchor.core_topic) lines.push('- Topic: ' + anchor.core_topic);
  if (anchor.session_register) lines.push('- Register: ' + anchor.session_register);
  if (anchor.dominant_concepts) lines.push('- Key concepts: ' + anchor.dominant_concepts.join(', '));
  if (anchor.key_entities) {
    const entityNoise = new Set(['WARNING','ERROR','SYNTAX','WINDOW','DAMPING','ITERATIONS',
      'NULL','TRUE','FALSE','TODO','FIXME','HACK','NOTE','DEBUG','INFO','WARN','LOG',
      'GET','POST','PUT','DELETE','PATCH','HEAD','OPTIONS',
      'SELECT','INSERT','UPDATE','DROP','CREATE','ALTER','WHERE','FROM',
      'AssertionError','AssertionError','TypeError','ReferenceError','SyntaxError']);
    const clean = anchor.key_entities.filter(e => !entityNoise.has(e) && !e.startsWith('@'));
    if (clean.length > 0) lines.push('- Entities: ' + clean.join(', '));
  }

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
    const tag = (t.role || 'user') === 'user' ? 'U' : 'A';
    lines.push(tag + ':');
    lines.push(t.summary || '');
    lines.push('');
  });

  const md = lines.join('\n');

  // Compression gate: compare markdown vs verbatim markdown
  if (rawMessages && rawMessages.length > 0) {
    const verbatimLines = ['# LISA Handoff (verbatim)', ''];
    rawMessages.forEach(m => {
      const tag = (m.role || 'user') === 'user' ? 'U' : 'A';
      verbatimLines.push(tag + ':');
      verbatimLines.push(m.content || '');
      verbatimLines.push('');
    });
    const verbatim = verbatimLines.join('\n');
    if (verbatim.length < md.length) return verbatim;
  }

  return md;
}

// Dual-mode: global in browser, module.exports in Node
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildLeanExport, buildMarkdownExport };
}
