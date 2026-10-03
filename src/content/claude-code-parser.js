// Claude Code Session Parser
// claude.ai/code/* — data-epitaxy-entry structure
// User = UUID entry IDs, Assistant = msg_ prefix IDs
// DOM aggressively virtualized at BOTH entry and item level

if (typeof ClaudeCodeParser !== 'undefined') {
} else {

// ── API-first capture for Claude Code ──
// The /code/ page loads its history from
//   /v1/code/sessions/<session_id>/events   (anthropic-version header required)
// 50 events per page, newest first, paged with ?cursor=<next_cursor>.
// Confirmed live: ~5.6k events / 112 pages for a long session. Events
// include tool calls, tool results, progress and control traffic; only
// two kinds carry the conversation:
//   - 'user' events whose message.content is typed text (string or text
//     blocks) — tool results come back as 'user' events too, but as
//     tool_result blocks, so they're skipped here
//   - 'assistant' events — one per content block, so a single reply is
//     spread over many events; every text block between two user messages
//     is joined into one assistant message
// Tool calls/results are left out on purpose, matching what the DOM
// sweep keeps (it strips tool widgets), and keeping exports readable.
// Sub-agent traffic (parent_tool_use_id set) is skipped for the same reason.
var LISA_CC_API_VERSION = '2023-06-01';

// Per-session cache so repeat calls (the ACM monitor re-checks on page
// activity; exports/handoffs reuse it) only fetch what's new. Pages are
// newest-first and the log is append-only, so paging stops at the first
// already-known event — usually after a single request instead of ~100+.
// Only conversation-bearing events are kept in memory; every id is kept
// so the stop check works.
var lisaCCEventCache = {};

async function lisaClaudeCodeFetchAllEvents(sessionId) {
  var base = '/v1/code/sessions/' + encodeURIComponent(sessionId) + '/events';
  var cache = lisaCCEventCache[sessionId] || null;
  var events = [];
  var cursor = null;
  var pages = 0;
  var reachedKnown = false;
  do {
    var resp = await fetch(base + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''), {
      method: 'GET',
      credentials: 'include',
      headers: { 'Accept': 'application/json', 'anthropic-version': LISA_CC_API_VERSION }
    });
    if (!resp.ok) throw new Error('events ' + resp.status);
    var json = await resp.json();
    var data = Array.isArray(json.data) ? json.data : [];
    for (var i = 0; i < data.length; i++) {
      if (cache && data[i] && data[i].event_id && cache.ids.has(data[i].event_id)) { reachedKnown = true; break; }
      events.push(data[i]);
    }
    pages++;
    if (reachedKnown) break;
    // A cursor that doesn't advance would loop forever — stop instead.
    if (json.next_cursor && json.next_cursor === cursor) break;
    cursor = json.next_cursor || null;
  } while (cursor && pages < 1000);

  // Only commit a cache built from a complete walk (or a clean join onto
  // an existing one) — a walk cut short by the page cap must not be
  // treated as the full history next time.
  var complete = reachedKnown || !cursor;
  var ids = cache && reachedKnown ? cache.ids : new Set();
  var kept = [];
  for (var k = 0; k < events.length; k++) {
    var ev = events[k];
    if (!ev) continue;
    if (ev.event_id) ids.add(ev.event_id);
    if (ev.event_type === 'user' || ev.event_type === 'assistant') kept.push(ev);
  }
  var all = cache && reachedKnown ? kept.concat(cache.events) : kept;
  if (complete) lisaCCEventCache[sessionId] = { ids: ids, events: all };
  return { events: all, pages: pages, totalIds: ids.size };
}

function lisaClaudeCodeTextOf(message) {
  var c = message && message.content;
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '';
  var parts = [];
  for (var i = 0; i < c.length; i++) {
    var b = c[i];
    if (b && b.type === 'text' && typeof b.text === 'string' && b.text.trim()) parts.push(b.text);
  }
  return parts.join('\n');
}

function lisaClaudeCodeEventsToMessages(events) {
  // Oldest first. The API pages newest-first; reverse, then stable-sort
  // by created_at in case page boundaries ever interleave.
  var seen = new Set();
  var ordered = [];
  for (var i = events.length - 1; i >= 0; i--) {
    var e = events[i];
    if (!e) continue;
    if (e.event_id) {
      if (seen.has(e.event_id)) continue;
      seen.add(e.event_id);
    }
    ordered.push({ e: e, k: ordered.length, t: Date.parse(e.created_at) || 0 });
  }
  ordered.sort(function(a, b) { return (a.t - b.t) || (a.k - b.k); });

  var messages = [];
  var turn = null; // current assistant reply being assembled
  var flush = function() {
    if (turn && turn.parts.length) {
      messages.push({
        role: 'assistant',
        content: turn.parts.join('\n\n'),
        index: messages.length,
        timestamp: turn.timestamp,
        messageId: turn.messageId,
        model: turn.model || undefined
      });
    }
    turn = null;
  };

  for (var j = 0; j < ordered.length; j++) {
    var ev = ordered[j].e;
    var payload = ev.payload || {};
    if (payload.parent_tool_use_id) continue; // sub-agent traffic
    var msg = payload.message || {};
    if (ev.event_type === 'user') {
      var userText = lisaClaudeCodeTextOf(msg).trim();
      if (!userText) continue; // tool_result-only event
      flush();
      messages.push({
        role: 'user',
        content: userText,
        index: messages.length,
        timestamp: ev.created_at || '',
        messageId: payload.uuid || ev.event_id || null
      });
    } else if (ev.event_type === 'assistant') {
      var text = lisaClaudeCodeTextOf(msg).trim();
      if (!turn) turn = { parts: [], timestamp: ev.created_at || '', messageId: msg.id || null, model: msg.model || null };
      // Guard against the same block arriving twice in one reply.
      if (text && turn.parts[turn.parts.length - 1] !== text) turn.parts.push(text);
    }
  }
  flush();
  return messages;
}

async function lisaClaudeCodeExtractViaAPI() {
  var m = window.location.pathname.match(/\/code\/(session_[a-zA-Z0-9]+)/);
  if (!m) return null;
  var sessionId = m[1];
  var fetched = await lisaClaudeCodeFetchAllEvents(sessionId);
  var messages = lisaClaudeCodeEventsToMessages(fetched.events);
  // Full walks are worth seeing; the monitor's 1-page incremental checks
  // would otherwise flood the console.
  (fetched.pages > 3 ? console.log : console.debug)(
    '[LISA CC] API capture: ' + messages.length + ' messages from ' +
    fetched.totalIds + ' events / ' + fetched.pages + ' page(s) fetched');
  if (messages.length === 0) return null;
  return {
    platform: 'Claude Code',
    conversationId: sessionId,
    url: window.location.href,
    title: (typeof claudeCodeParser !== 'undefined' && claudeCodeParser)
      ? claudeCodeParser.extractTitle() : (document.title || 'Claude Code Session'),
    extractedAt: new Date().toISOString(),
    messageCount: messages.length,
    messages: messages,
    _captureMethod: 'api-code-events',
    _totalEvents: fetched.totalIds
  };
}
// Same shape as __LISA_CLAUDE_API_CAPTURE so LisaVParser's existing
// _captureViaApiWithRetry() can drive it.
window.__LISA_CLAUDE_CODE_API_CAPTURE = {
  extractViaAPI: lisaClaudeCodeExtractViaAPI,
  extractSharedViaAPI: function() { return Promise.resolve(null); }
};

// ── Shared Claude Code scroll sweep ──
// Used by ClaudeCodeParser.extractConversation() below and by
// LisaVParser.extractClaudeCodeMessages() (lisa-v-parser.js), which is the
// path both the popup and the floating button actually take. One copy so
// the two can't drift apart again.
//
// Claude Code pages its history: it loads ONE older page each time the
// list *arrives* at the top (edge-triggered). Sitting at scrollTop 0 and
// waiting never loads a second page — the trigger has to leave the top
// zone and re-enter it, which is exactly what a user's manual
// "scroll up, scroll down, scroll up again" does. So the up-phase keeps
// re-arming that trigger (nudge down, climb back) until two consecutive
// arrivals at the top bring in nothing new.
function lisaClaudeCodeFindScroller() {
  // 'div, main' — a <main> conversation container would otherwise be
  // missed. Prefer a candidate that actually contains conversation entries
  // over "biggest scrollable element" — a /code/ page's file/diff viewer
  // or session sidebar can have a bigger scrollHeight than the list.
  var candidates = [...document.querySelectorAll('div, main')].filter(function(el) {
    var s = getComputedStyle(el);
    return (s.overflowY === 'auto' || s.overflowY === 'scroll')
           && el.scrollHeight > el.clientHeight + 200;
  });
  var withEntries = candidates.filter(function(el) {
    return el.querySelector('[data-epitaxy-entry]') !== null;
  });
  var pool = withEntries.length > 0 ? withEntries : candidates;
  return pool.sort(function(a, b) { return b.scrollHeight - a.scrollHeight; })[0] || null;
}

async function lisaClaudeCodeSweep(collect) {
  var wait = function(ms) { return new Promise(function(r) { setTimeout(r, ms); }); };
  var firstEntryId = function() {
    var el = document.querySelector('[data-epitaxy-entry]');
    return el ? el.getAttribute('data-epitaxy-entry') : null;
  };

  // Poll for the scroller — a one-shot lookup can miss it if called
  // slightly before the virtualized list has finished hydrating.
  var scroller = null;
  for (var attempt = 0; attempt < 10; attempt++) {
    scroller = lisaClaudeCodeFindScroller();
    if (scroller) break;
    await wait(500);
  }
  if (!scroller) { collect(); return; }

  var scrollTo = function(top) {
    scroller.scrollTop = top;
    scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
  };

  // Scroll anchoring would adjust scrollTop on its own while the
  // virtualizer mounts/resizes items above the viewport. Restored after.
  var originalAnchor = scroller.style.overflowAnchor;
  scroller.style.overflowAnchor = 'none';
  try {
    collect();

    // ── Up-phase: climb, wait at the top, re-arm, repeat ──
    var quietTops = 0;
    var arrivals = 0;
    while (quietTops < 2 && arrivals < 60) {
      // Stepped climb (not an instant jump — that lands past whatever the
      // virtualizer has mounted and never backfills the earliest entries).
      var stepUp = scroller.clientHeight * 0.6;
      for (var u = 0; u < 400 && scroller.scrollTop > 0; u++) {
        scrollTo(Math.max(0, scroller.scrollTop - stepUp));
        await wait(250);
        collect();
      }
      scrollTo(0);
      arrivals++;

      // Wait for an older page to arrive: scrollHeight growth OR a new
      // first entry (the virtualizer may keep its height estimate flat
      // while swapping content).
      var h0 = scroller.scrollHeight;
      var first0 = firstEntryId();
      var grew = false;
      for (var t = 0; t < 10; t++) {
        await wait(250);
        collect();
        if (scroller.scrollHeight !== h0 || firstEntryId() !== first0) { grew = true; break; }
      }
      if (grew) {
        // Let the rest of the page finish rendering before moving on.
        await wait(400);
        collect();
        quietTops = 0;
      } else {
        quietTops++;
      }
      console.log('[LISA CC] top #' + arrivals + ': grew=' + grew +
                    ' height ' + h0 + '→' + scroller.scrollHeight +
                    ' first ' + first0 + '→' + firstEntryId());
      if (quietTops >= 2) break;

      // Re-arm the load-more trigger: leave the top zone, then the climb
      // at the top of the loop brings us back into it.
      var maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      scrollTo(Math.min(scroller.clientHeight * 1.5, maxTop));
      await wait(300);
      collect();
    }

    // ── Down-phase: stepped sweep back to the bottom ──
    // Runs after all history has loaded, so every entry is seen again
    // here with its final index (callers refresh entryIdx on re-sighting).
    var step = scroller.clientHeight * 0.6;
    var lastScrollTop = -1;
    for (var i = 0; i < 400; i++) {
      scrollTo(scroller.scrollTop + step);
      await wait(250);
      collect();
      if (Math.abs(scroller.scrollTop - lastScrollTop) < 2) break;
      lastScrollTop = scroller.scrollTop;
    }
  } finally {
    scroller.style.overflowAnchor = originalAnchor;
  }
}
window.__lisaClaudeCodeSweep = lisaClaudeCodeSweep;

class ClaudeCodeParser {
  constructor() {
    this.platform = 'Claude Code';
    this.conversationId = this.extractConversationId();
  }

  extractConversationId() {
    var match = window.location.pathname.match(/\/code\/(session_[a-zA-Z0-9]+)/);
    return match ? match[1] : null;
  }

  extractTitle() {
    var titlebar = document.querySelector('.epitaxy-titlebar');
    if (titlebar) {
      var titleDiv = titlebar.querySelector('span.flex.min-w-0.items-center > div:first-child');
      if (titleDiv && titleDiv.textContent.trim().length > 0) {
        return titleDiv.textContent.trim();
      }
    }
    return 'Claude Code Session';
  }

  cleanText(text) {
    if (!text) return '';
    text = text.replace(/^Vous avez dit\s*:?\s*/i, '');
    text = text.replace(/^You said\s*:?\s*/i, '');
    text = text.replace(/^Claude a répondu\s*:?\s*/i, '');
    text = text.replace(/^Claude replied\s*:?\s*/i, '');
    text = text.replace(/^Afficher moins\s*/i, '');
    text = text.replace(/^Show less\s*/i, '');
    text = text.replace(/Crédits d'utilisation épuisés.*/i, '');
    text = text.replace(/Usage credits exhausted.*/i, '');
    text = text.replace(/il y a \d+\s*(mois|jours?|heures?|minutes?|secondes?)\s*$/i, '');
    text = text.replace(/\d+\s*(months?|days?|hours?|minutes?|seconds?)\s*ago\s*$/i, '');
    text = text.replace(/\n\d{1,2}:\d{2}\s*(AM|PM)\s*$/i, '');
    text = text.split('\n').filter(function(ln, i, a) {
      return i === 0 || ln.trim() === '' || ln.trim() !== a[i-1].trim();
    }).join('\n');
    return text.trim();
  }

  collectVisibleItems(items) {
    var converter = window.__lisaHtmlToMarkdown;
    var allEls = document.querySelectorAll('[data-epitaxy-entry]');
    for (var i = 0; i < allEls.length; i++) {
      var el = allEls[i];
      var entryId = el.getAttribute('data-epitaxy-entry');
      var entryIdx = parseInt(el.getAttribute('data-epitaxy-entry-index') || '0', 10);
      var itemIdx = el.getAttribute('data-epitaxy-item-index');
      if (!entryId) continue;
      // Key: entryId + itemIdx (or entryId alone for single-item entries)
      var key = entryId + '|' + (itemIdx || '0');
      if (items.has(key)) {
        // Refresh position only — indices can shift when Claude Code
        // prepends older history, and the final down-sweep (run after all
        // history has loaded) sees every entry again with its final index.
        items.get(key).entryIdx = entryIdx;
        continue;
      }

      var isAssistant = entryId.startsWith('msg_');
      var role = isAssistant ? 'assistant' : 'user';

      var rows = el.querySelectorAll('.group\\/message-row');
      var targets = rows.length > 0 ? rows : [el];
      var parts = [];
      for (var j = 0; j < targets.length; j++) {
        var clone = targets[j].cloneNode(true);
        // Remove sr-only (duplicates visible text), tool labels, UI chrome
        clone.querySelectorAll('.sr-only, [class*="group/tool"], button, svg, [role="button"], [class*="opacity-0"], time').forEach(function(e) { e.remove(); });
        var text;
        if (converter) {
          text = converter.extractAsMarkdown(clone);
        } else {
          text = clone.textContent || '';
        }
        if (text && text.trim()) parts.push(text.trim());
      }
      // Dedup identical parts (user entries often contain duplicate message-rows)
      var seen = new Set();
      parts = parts.filter(function(p) { if (seen.has(p)) return false; seen.add(p); return true; });
      var fullText = this.cleanText(parts.join('\n'));
      if (fullText.length > 0) {
        items.set(key, {
          entryId: entryId,
          entryIdx: entryIdx,
          itemIdx: parseInt(itemIdx || '0', 10),
          role: role,
          text: fullText
        });
      }
    }
  }

  async extractConversation() {
    this.conversationId = this.extractConversationId();

    // API first (complete, no scrolling); scroll sweep only as fallback.
    for (var attempt = 0; attempt < 2; attempt++) {
      try {
        var apiResult = await lisaClaudeCodeExtractViaAPI();
        if (apiResult) return apiResult;
      } catch (err) {
        console.warn('[LISA CC] API capture attempt ' + (attempt + 1) + ' failed:', err && err.message);
      }
      if (attempt === 0) await new Promise(function(r) { setTimeout(r, 500); });
    }
    console.warn('[LISA CC] API capture unavailable, falling back to scroll sweep');

    var items = new Map();
    var self = this;
    await lisaClaudeCodeSweep(function() { self.collectVisibleItems(items); });

    // Group items by entryId, sort items within each entry
    var entryGroups = new Map();
    for (var item of items.values()) {
      if (!entryGroups.has(item.entryId)) {
        entryGroups.set(item.entryId, { role: item.role, entryIdx: item.entryIdx, items: [] });
      }
      entryGroups.get(item.entryId).items.push(item);
    }

    // Sort entries by entryIdx, sort items within each by itemIdx
    var sorted = [...entryGroups.values()].sort(function(a, b) { return a.entryIdx - b.entryIdx; });
    var messages = [];
    for (var g = 0; g < sorted.length; g++) {
      var group = sorted[g];
      group.items.sort(function(a, b) { return a.itemIdx - b.itemIdx; });
      var content = group.items.map(function(it) { return it.text; }).join('\n\n');
      if (content.length > 0) {
        messages.push({
          role: group.role,
          content: content,
          index: messages.length,
          timestamp: new Date().toISOString()
        });
      }
    }

    if (messages.length === 0) return null;

    return {
      platform: this.platform,
      conversationId: this.conversationId,
      url: window.location.href,
      title: this.extractTitle(),
      extractedAt: new Date().toISOString(),
      messageCount: messages.length,
      messages: messages,
      _captureMethod: 'dom-epitaxy-sweep'
    };
  }

  initializeListener() {
    chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
      if (request.action === 'ping') {
        sendResponse({ success: true, platform: 'Claude Code' });
        return true;
      }
      if (request.action === 'extractConversation') {
        claudeCodeParser.extractConversation()
          .then(function(conversation) { sendResponse({ success: true, data: conversation }); })
          .catch(function(error) {
            console.error('[LISA] Claude Code extraction error:', error);
            sendResponse({ success: false, error: error.message });
          });
        return true;
      }
      return false; // not ours — let other listeners answer, or the sender fail fast
    });
  }
}

var claudeCodeParser = new ClaudeCodeParser();
claudeCodeParser.initializeListener();

chrome.runtime.sendMessage({
  action: 'parserReady',
  platform: 'Claude Code'
});

} // end guard
