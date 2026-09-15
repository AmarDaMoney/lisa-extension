/**
 * count.js — Token counting via Anthropic count_tokens endpoint.
 *
 * Ground truth: the model you're handing off to.
 * Cached by SHA256(text) so re-runs cost nothing.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CACHE_PATH = path.join(__dirname, 'counts.json');
const MODEL = process.env.LISA_EVAL_MODEL || 'claude-sonnet-4-6';

let cache = {};
try {
  cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
} catch (_) {}

function saveCache() {
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
}

/**
 * countTokens(text) — Returns token count for the given text.
 * Uses Anthropic count_tokens API, cached by content hash.
 */
async function countTokens(text) {
  const hash = crypto.createHash('sha256').update(text).digest('hex');
  const key = MODEL + ':' + hash;

  if (key in cache) return cache[key];

  // Lazy-load SDK
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic();

  const r = await client.messages.countTokens({
    model: MODEL,
    messages: [{ role: 'user', content: text }]
  });

  cache[key] = r.input_tokens;
  saveCache();
  return r.input_tokens;
}

/**
 * countTokensFallback(text) — Rough estimate without API.
 * Uses ~4 chars per token as approximation.
 * Only for offline mode when ANTHROPIC_API_KEY is not set.
 */
function countTokensFallback(text) {
  return Math.ceil(text.length / 4);
}

/**
 * count(text) — Uses cached API counts when available, API when
 * key is set, fallback only as last resort. This ensures eval
 * results are consistent regardless of whether the key is set
 * in this particular run — once a count is cached, it's always used.
 */
async function count(text) {
  const hash = crypto.createHash('sha256').update(text).digest('hex');
  const key = MODEL + ':' + hash;
  if (key in cache) return cache[key];
  if (process.env.ANTHROPIC_API_KEY) {
    return countTokens(text);
  }
  return countTokensFallback(text);
}

module.exports = { count, countTokens, countTokensFallback, MODEL };
