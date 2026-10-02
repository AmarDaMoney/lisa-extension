// Claude Code Session Parser
// claude.ai/code/* — data-epitaxy-entry structure
// User = UUID entry IDs, Assistant = msg_ prefix IDs
// DOM aggressively virtualized at BOTH entry and item level

if (typeof ClaudeCodeParser !== 'undefined') {
} else {

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
      return true;
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
