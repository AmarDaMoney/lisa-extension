/**
 * checkpoint-detect.js — Canonical checkpoint-format detection.
 *
 * Single source of truth for recognizing LISA's structured checkpoint
 * reply format (CURRENT STATE/OBJECTIVE/DECISIONS/OPEN/RESOLVED/
 * CONSTRAINTS/KEY CONTEXT/NEXT), shared between acm-monitor.js's live
 * detection (content script, DOM-aware) and buildLeanExport's retroactive
 * recovery fallback (background/popup, no DOM). Pure — no window/DOM
 * dependency, no instance state.
 *
 * Browser: functions are globals.
 * Node:    module.exports = { CHECKPOINT_SECTIONS, stripCheckpointMarkdown,
 *                              countCheckpointHeaders, parseCheckpointResponse,
 *                              detectCheckpointInMessage }
 */

// var, not const: content scripts loaded as separate files in manifest.json
// share one global object the way sequential classic <script> tags do, but
// only var/function declarations attach to it — a top-level const would be
// scoped to this file alone and invisible to acm-monitor.js as a bare
// identifier.
var CHECKPOINT_SECTIONS = ['CURRENT STATE', 'OBJECTIVE', 'DECISIONS', 'OPEN', 'RESOLVED', 'CONSTRAINTS', 'KEY CONTEXT', 'NEXT'];

// Strips markdown emphasis/heading/list decoration so header matching
// works whether the AI writes "CURRENT STATE:" plain or bolds/numbers it
// ("**CURRENT STATE:**", "### Current State:", "1. Current State:", ...).
function stripCheckpointMarkdown(line) {
  return line
    .replace(/[*_~`]/g, '')
    .replace(/^#{1,6}\s*/, '')
    .replace(/^[-•]\s*/, '')
    .replace(/^\d+[.)]\s*/, '')
    .trim();
}

// How many of the 8 section headers appear in this text. Normalized/
// uppercased so bolded headers (**CURRENT STATE:**) or different casing
// don't cause a false negative.
function countCheckpointHeaders(text) {
  const normalizedText = stripCheckpointMarkdown(text).toUpperCase();
  let matchCount = 0;
  for (const section of CHECKPOINT_SECTIONS) {
    if (normalizedText.includes(section + ':')) matchCount++;
  }
  return matchCount;
}

function cleanSectionLines(lines) {
  return lines
    .map(l => l.replace(/^[-•*]\s*/, '').trim())
    .filter(l => l.length > 0 && l !== '[' && l !== ']');
}

function parseCheckpointResponse(text, messageCount) {
  const sections = {};

  // Split text into sections by header
  const lines = text.split('\n');
  let currentSection = null;
  let currentLines = [];

  for (const line of lines) {
    const normalized = stripCheckpointMarkdown(line);
    const normalizedUpper = normalized.toUpperCase();
    // Check if this line starts a new section
    let foundSection = null;
    for (const name of CHECKPOINT_SECTIONS) {
      if (normalizedUpper.startsWith(name + ':') || normalizedUpper.startsWith(name + ' :')) {
        foundSection = name;
        break;
      }
    }

    if (foundSection) {
      // Save previous section
      if (currentSection) {
        sections[currentSection] = cleanSectionLines(currentLines);
      }
      currentSection = foundSection;
      // Capture any inline content after the header
      const afterHeader = normalized.substring(normalized.indexOf(':') + 1).trim();
      currentLines = afterHeader ? [afterHeader] : [];
    } else if (currentSection) {
      currentLines.push(normalized);
    }
  }
  // Save last section
  if (currentSection) {
    sections[currentSection] = cleanSectionLines(currentLines);
  }

  if (Object.keys(sections).length < 3) return null;

  return {
    currentState: (sections['CURRENT STATE'] || []).join(' '),
    objective: (sections['OBJECTIVE'] || []).join(' '),
    decisions: sections['DECISIONS'] || [],
    open: sections['OPEN'] || [],
    resolved: sections['RESOLVED'] || [],
    constraints: sections['CONSTRAINTS'] || [],
    keyContext: sections['KEY CONTEXT'] || [],
    next: sections['NEXT'] || [],
    raw: text,
    capturedAt: Date.now(),
    messageCount
  };
}

// Retroactively detects whether a single message is a checkpoint reply.
// Scoped to assistant replies only — the checkpoint *request* prompt
// itself contains all 8 section labels verbatim as instructions, so
// without this it would false-positive on the user's own prompt.
function detectCheckpointInMessage(message) {
  if (!message || message.role !== 'assistant' || !message.content) return null;
  if (countCheckpointHeaders(message.content) < 6) return null;
  return parseCheckpointResponse(message.content, message.index);
}

// Dual-mode: global in browser, module.exports in Node
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CHECKPOINT_SECTIONS,
    stripCheckpointMarkdown,
    countCheckpointHeaders,
    parseCheckpointResponse,
    detectCheckpointInMessage
  };
}
