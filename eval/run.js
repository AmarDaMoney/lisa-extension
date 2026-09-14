#!/usr/bin/env node
/**
 * run.js — LISA eval harness.
 *
 * Loads extension code, runs the compression pipeline on each corpus case,
 * produces the lean export, measures token ratio vs raw transcript.
 *
 * Usage:
 *   node eval/run.js                  # ratio only (free, ~2s)
 *   node eval/run.js --judge          # ratio + reconstruction quality (paid)
 *   LISA_EVAL_MODEL=claude-opus-5 node eval/run.js  # count against specific model
 *
 * Exit code: 0 if all cases below TARGET ratio, 1 otherwise.
 */
const fs = require('fs');
const path = require('path');
const { loadLisa, pipeline, buildLeanExport } = require('./load-lisa');
const { count, MODEL } = require('./count');

const TARGET = parseFloat(process.env.LISA_EVAL_TARGET || '0.9');
const CORPUS = path.join(__dirname, 'corpus');
const OUT = path.join(__dirname, 'out');
const JUDGE = process.argv.includes('--judge');

// Render raw transcript the way a receiver reads it (not JSON)
function renderRaw(raw) {
  return raw.messages
    .map(m => `${(m.role || 'assistant').toUpperCase()}:\n${m.content || ''}`)
    .join('\n\n');
}

async function runCase(lisa, caseName) {
  const caseDir = path.join(CORPUS, caseName);
  const rawPath = path.join(caseDir, 'raw.json');

  if (!fs.existsSync(rawPath)) {
    console.error(`  SKIP ${caseName}: no raw.json`);
    return null;
  }

  const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
  const rawText = renderRaw(raw);

  // Run pipeline
  const compressed = pipeline(lisa, raw);
  const lean = buildLeanExport(compressed, raw.messages);
  const leanText = JSON.stringify(lean, null, 2);

  // Save output for git-diff
  fs.writeFileSync(path.join(OUT, `${caseName}.json`), leanText);

  // Count tokens
  const rawTokens = await count(rawText);
  const leanTokens = await count(leanText);
  const ratio = (leanTokens / rawTokens).toFixed(3);

  // Section breakdown
  const sections = {};
  sections.messages = await count(JSON.stringify(lean.messages || []));
  sections.anchor = await count(JSON.stringify(lean.anchor || ''));
  sections.semantic_anchors = await count(JSON.stringify(lean.semantic_anchors || {}));
  sections.session_metadata = await count(JSON.stringify(lean.session_metadata || {}));
  sections.other = leanTokens - Object.values(sections).reduce((a, b) => a + b, 0);

  const result = {
    case: caseName,
    messages: raw.messages.length,
    rawTokens,
    leanTokens,
    ratio: parseFloat(ratio),
    pass: parseFloat(ratio) <= TARGET,
    sections
  };

  // Reconstruction quality (opt-in)
  if (JUDGE) {
    const questionsPath = path.join(caseDir, 'questions.json');
    if (fs.existsSync(questionsPath)) {
      const judge = require('./judge');
      const questions = JSON.parse(fs.readFileSync(questionsPath, 'utf8'));
      result.quality = await judge.evaluate(leanText, questions);
    } else {
      result.quality = { note: 'no questions.json' };
    }
  }

  return result;
}

async function main() {
  console.log(`LISA Eval Harness — model: ${MODEL}, target ratio: ${TARGET}`);
  console.log('─'.repeat(80));

  // Load extension code once
  let lisa;
  try {
    lisa = loadLisa();
    console.log('Extension loaded OK');
  } catch (e) {
    console.error('Failed to load extension:', e.message);
    console.error('Make sure you run from the extension repo root: node eval/run.js');
    process.exit(2);
  }

  // Ensure output dir
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

  // Find corpus cases
  if (!fs.existsSync(CORPUS)) {
    console.error('No corpus/ directory. Create eval/corpus/<case>/raw.json to start.');
    process.exit(2);
  }
  const cases = fs.readdirSync(CORPUS).filter(d =>
    fs.statSync(path.join(CORPUS, d)).isDirectory()
  );

  if (cases.length === 0) {
    console.error('No cases found in eval/corpus/. Add at least one <case>/raw.json.');
    process.exit(2);
  }

  // Run each case
  const results = [];
  for (const c of cases) {
    process.stdout.write(`  ${c}... `);
    try {
      const r = await runCase(lisa, c);
      if (r) {
        results.push(r);
        const status = r.pass ? '✓' : '✗';
        console.log(`${status} ${r.messages} msgs | ${r.rawTokens} raw → ${r.leanTokens} lean | ratio ${r.ratio}`);

        // Section breakdown
        const s = r.sections;
        console.log(`    messages: ${s.messages}  anchor: ${s.anchor}  anchors: ${s.semantic_anchors}  meta: ${s.session_metadata}`);

        if (r.quality && r.quality.recall !== undefined) {
          console.log(`    quality: recall=${r.quality.recall} hallucination=${r.quality.hallucination} missing=${r.quality.missing}`);
        }
      }
    } catch (e) {
      console.log(`ERROR: ${e.message}`);
    }
  }

  // Summary
  console.log('─'.repeat(80));
  const passed = results.filter(r => r.pass).length;
  const meanRatio = results.length > 0
    ? (results.reduce((s, r) => s + r.ratio, 0) / results.length).toFixed(3)
    : 'N/A';
  console.log(`${passed}/${results.length} passed | mean ratio: ${meanRatio} | target: ${TARGET}`);

  // Exit code
  const allPass = results.length > 0 && results.every(r => r.pass);
  process.exit(allPass ? 0 : 1);
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(2);
});
