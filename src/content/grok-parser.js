// Grok Conversation Parser
// Extracts conversation data from grok.com

// ── API-first capture for Grok ──
// grok.com loads a conversation in two calls (found live via DevTools):
//   GET  /rest/app-chat/conversations/<id>/response-node?includeThreads=true
//        → { responseNodes: [{ responseId, sender, parentResponseId? }] }
//   POST /rest/app-chat/conversations/<id>/load-responses  { responseIds }
//        → { responses: [{ responseId, message, sender, createTime,
//                          partial, isControl, … }] }
// The page itself only keeps the latest messages mounted (live: last 7 of
// 112 captured), so reading the API is the only complete capture. Edits /
// regenerations make the nodes a tree — the active branch is followed from
// the newest leaf back to the root. Finished responses are cached per
// conversation, so repeat calls (ACM re-checks, export after handoff) only
// load what's new.
var LISA_GROK_RESPONSE_CACHE = {};

function lisaGrokConversationId() {
  var m = window.location.pathname.match(/\/(?:c|chat)\/([0-9a-zA-Z-]{8,})/);
  return m ? m[1] : null;
}

async function lisaGrokExtractViaAPI() {
  var convId = lisaGrokConversationId();
  if (!convId) return null;
  var base = '/rest/app-chat/conversations/' + encodeURIComponent(convId);

  var r = await fetch(base + '/response-node?includeThreads=true', { credentials: 'include' });
  if (!r.ok) throw new Error('response-node ' + r.status);
  var nodes = ((await r.json()).responseNodes || []).filter(function(n) { return n && n.responseId; });
  if (!nodes.length) return null;

  var cache = LISA_GROK_RESPONSE_CACHE[convId] || (LISA_GROK_RESPONSE_CACHE[convId] = new Map());
  var missing = nodes.map(function(n) { return n.responseId; }).filter(function(id) { return !cache.has(id); });
  for (var i = 0; i < missing.length; i += 50) {
    var r2 = await fetch(base + '/load-responses', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ responseIds: missing.slice(i, i + 50) })
    });
    if (!r2.ok) throw new Error('load-responses ' + r2.status);
    ((await r2.json()).responses || []).forEach(function(x) {
      // An in-flight (partial) reply isn't cached — it's reloaded next time.
      if (x && x.responseId && !x.partial) cache.set(x.responseId, x);
    });
  }

  // Active branch: newest leaf → root via parentResponseId (falls back to
  // creation order when the API gives no parent links).
  var time = function(id) { return Date.parse((cache.get(id) || {}).createTime) || 0; };
  var path;
  if (nodes.some(function(n) { return n.parentResponseId; })) {
    var byId = new Map(nodes.map(function(n) { return [n.responseId, n]; }));
    var hasChild = new Set(nodes.map(function(n) { return n.parentResponseId; }).filter(Boolean));
    var order = new Map(nodes.map(function(n, i) { return [n.responseId, i]; }));
    // Newest leaf = the live branch. A response not in the cache is the
    // in-flight one (partial replies aren't cached) — always the newest, so
    // rank it first; it has no createTime of its own yet. Ties fall back to
    // the server's node order.
    var rank = function(id) { return cache.has(id) ? time(id) : Infinity; };
    var leaves = nodes.filter(function(n) { return !hasChild.has(n.responseId); });
    leaves.sort(function(a, b) {
      return (rank(b.responseId) - rank(a.responseId)) || (order.get(b.responseId) - order.get(a.responseId));
    });
    path = [];
    for (var cur = leaves[0], guard = 0; cur && guard < 100000; guard++) {
      path.push(cur.responseId);
      cur = cur.parentResponseId ? byId.get(cur.parentResponseId) : null;
    }
    path.reverse();
  } else {
    path = nodes.map(function(n) { return n.responseId; }).sort(function(a, b) { return time(a) - time(b); });
  }

  var messages = [];
  path.forEach(function(id) {
    var x = cache.get(id);
    if (!x || x.isControl) return;
    var text = String(x.message || '').trim();
    if (!text) return;
    messages.push({
      role: String(x.sender || '').toLowerCase() === 'human' ? 'user' : 'assistant',
      content: text,
      index: messages.length,
      timestamp: x.createTime || '',
      messageId: id
    });
  });
  console.log('[LISA] Grok API capture: ' + messages.length + ' messages (' + nodes.length +
              ' nodes, ' + missing.length + ' loaded now)');
  if (!messages.length) return null;
  return {
    platform: 'Grok',
    conversationId: convId,
    url: window.location.href,
    title: (document.title || '').replace(/\s*[-|]\s*Grok\s*$/i, '').trim() || 'Grok conversation',
    extractedAt: new Date().toISOString(),
    messageCount: messages.length,
    messages: messages,
    _captureMethod: 'api-grok'
  };
}
// Same contract as the Claude / Claude Code modules, so LisaVParser's
// _captureViaApiWithRetry() and ACM / Handoff (_getApiCapture) drive it.
window.__LISA_GROK_API_CAPTURE = {
  extractViaAPI: lisaGrokExtractViaAPI,
  extractSharedViaAPI: function() { return Promise.resolve(null); }
};

class GrokParser {
  constructor() {
    this.platform = 'Grok';
    this.conversationId = this.extractConversationId();
  }

  extractConversationId() {
    // grok.com/c/<uuid> (older links: /chat/<uuid>)
    const match = window.location.pathname.match(/\/(?:c|chat)\/([a-zA-Z0-9-]+)/);
    return match ? match[1] : 'grok-session-' + Date.now();
  }

  async extractMessages() {
    const messages = [];

    // Primary: Grok wraps each turn with items-end (user) / items-start (assistant)
    const messageWrappers = document.querySelectorAll('.relative.group.flex.flex-col.justify-center.w-full');

    for (const wrapper of messageWrappers) {
      const role = wrapper.classList.contains('items-end') ? 'user'
                 : wrapper.classList.contains('items-start') ? 'assistant'
                 : null;
      if (!role) continue;

      const messageBubble = wrapper.querySelector('[class*="message-bubble"]');
      if (!messageBubble) continue;

      const textContent = this.extractTextContent(messageBubble);
      if (textContent && textContent.trim().length > 0) {
        messages.push({ role, content: textContent.trim(), index: messages.length, timestamp: new Date().toISOString() });
      }
    }

    // Fallback: data-testid attributes only (safer than class wildcards)
    if (messages.length === 0) {
      document.querySelectorAll('[data-testid*="message"]').forEach((el, i) => {
        const isUser = el.querySelector('[data-testid="User-Name"]') !== null;
        const textContent = this.extractTextContent(el);
        if (textContent && textContent.trim().length > 0) {
          messages.push({ role: isUser ? 'user' : 'assistant', content: textContent.trim(), index: i, timestamp: new Date().toISOString() });
        }
      });
    }

    return messages;
  }

  extractTextContent(element) {
    const clone = element.cloneNode(true);
    
    // Remove UI elements
    clone.querySelectorAll('button, svg, [role="button"], [data-testid*="icon"]').forEach(el => el.remove());
    
    return clone.textContent || clone.innerText || '';
  }

  async extractConversation() {
    this.conversationId = this.extractConversationId();
    // API first (complete — the page only keeps the latest messages); DOM
    // capture as fallback.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const apiResult = await lisaGrokExtractViaAPI();
        if (apiResult) return apiResult;
      } catch (err) {
        console.warn('[LISA] Grok API capture attempt ' + (attempt + 1) + ' failed:', err && err.message);
      }
      if (attempt === 0) await new Promise(r => setTimeout(r, 500));
    }
    const messages = await this.extractMessages();

    if (messages.length === 0) return null;

    return {
      platform: this.platform,
      conversationId: this.conversationId,
      url: window.location.href,
      title: document.title,
      extractedAt: new Date().toISOString(),
      messageCount: messages.length,
      messages: messages
    };
  }

  initializeListener() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'ping') {
        sendResponse({ success: true, platform: this.platform });
        return true;
      }
      if (request.action === 'extractConversation') {
        this.extractConversation().then(conversation => {
          sendResponse({ success: true, data: conversation });
        }).catch(error => {
          console.error('[LISA] Grok extraction error:', error);
          sendResponse({ success: false, error: error.message });
        });
        return true;
      }
      return false; // not ours — let other listeners answer, or the sender fail fast
    });
  }
}

// Initialize parser
const parser = new GrokParser();
parser.initializeListener();

chrome.runtime.sendMessage({ 
  action: 'parserReady', 
  platform: 'Grok' 
});
