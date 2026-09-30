/**
 * conversation-id.js — Canonical URL -> conversation-id derivation.
 *
 * Single source of truth for the per-platform URL pattern table used to
 * identify a conversation from its URL, shared between acm-monitor.js's
 * live tracking (content script, reads window.location) and popup.js's
 * retroactive lookup for a saved snapshot (which only has a stored URL,
 * not a live page). Pure — no window/DOM dependency.
 *
 * Browser: function is a global.
 * Node:    module.exports = { getConversationIdFromUrl }
 */

// Returns { platform, id } where id is null if the host matched but the
// path didn't (caller decides what a "no id" match means for its case —
// live tracking synthesizes a fresh id, a retroactive snapshot lookup
// should just treat it as unresolvable). Returns null outright if the
// host itself doesn't match any known platform, or the URL is malformed.
function getConversationIdFromUrl(urlString) {
  let host, path;
  try {
    const u = new URL(urlString);
    host = u.hostname;
    path = u.pathname;
  } catch (_) {
    return null;
  }

  const patterns = [
    [/chatgpt\.com/,            /\/c\/([a-f0-9-]+)/],
    [/claude\.ai/,              /\/chat\/([a-zA-Z0-9-]+)/],
    [/gemini\.google/,          /\/app\/([a-zA-Z0-9-]+)/],
    [/grok\.com/,               /\/c\/([a-zA-Z0-9-]+)/],
    [/chat\.mistral\.ai/,       /\/chat\/([a-zA-Z0-9-]+)/],
    [/chat\.deepseek\.com/,     /\/chat\/([a-zA-Z0-9-]+)/],
    [/perplexity\.ai/,          /\/search\/([a-zA-Z0-9-]+)/],
    [/poe\.com/,                /\/chat\/([a-zA-Z0-9]+)/],
    [/huggingface\.co/,         /\/chat\/conversation\/([a-f0-9]+)/],
    [/meta\.ai/,                /\/prompt\/([a-f0-9-]+)/],
    [/copilot\.microsoft\.com/, /\/chat\/([a-zA-Z0-9-]+)/],
  ];
  for (const [hostRe, pathRe] of patterns) {
    if (hostRe.test(host)) {
      const m = path.match(pathRe);
      const platform = host.replace('www.', '').split('.')[0];
      return { platform, id: m ? `${platform}-${m[1]}` : null };
    }
  }
  return null;
}

// Dual-mode: global in browser, module.exports in Node
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getConversationIdFromUrl };
}
