// Claude Code Session Parser
// claude.ai/code/* — data-epitaxy-entry structure
// User = UUID entry IDs, Assistant = msg_ prefix IDs
// DOM aggressively virtualized at BOTH entry and item level

if (typeof ClaudeCodeParser !== 'undefined') {
} else {

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

  findScroller() {
    // 'div, main' — matches every other platform's scroller detection in
    // this codebase; 'div' alone would return null (no scroll sweep at
    // all) if the real conversation container happens to be a <main>.
    var candidates = [...document.querySelectorAll('div, main')].filter(function(el) {
      var s = getComputedStyle(el);
      return (s.overflowY === 'auto' || s.overflowY === 'scroll')
             && el.scrollHeight > el.clientHeight + 200;
    });
    // A complex /code/ page can have other large scrollable regions (a
    // file/diff viewer, a session sidebar) with a bigger scrollHeight than
    // the actual conversation list, especially since the list's own
    // virtualizer may report a modest scrollHeight. Prefer whichever
    // candidate actually contains conversation entries over "biggest
    // scrollable element on the page."
    var withEntries = candidates.filter(function(el) {
      return el.querySelector('[data-epitaxy-entry]') !== null;
    });
    var pool = withEntries.length > 0 ? withEntries : candidates;
    return pool.sort(function(a, b) { return b.scrollHeight - a.scrollHeight; })[0] || null;
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
      if (items.has(key)) continue;

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
    // Poll for the scroller — matches every other platform's extractor in
    // lisa-v-parser.js. A one-shot lookup can miss it if called slightly
    // before the page's virtualized list has finished hydrating.
    var scroller = null;
    for (var attempt = 0; attempt < 10; attempt++) {
      scroller = this.findScroller();
      if (scroller) break;
      await new Promise(function(r) { setTimeout(r, 500); });
    }
    var items = new Map();

    if (scroller) {
      // Scroll anchoring (the browser default) can adjust scrollTop on its
      // own while the virtualizer mounts/resizes items above the viewport,
      // fighting the manual decrement below and making the up-sweep think
      // it reached the top before it actually did. Restored after.
      var originalAnchor = scroller.style.overflowAnchor;
      scroller.style.overflowAnchor = 'none';

      // Scroll-UP sweep, in small steps with real 'scroll' events and
      // waits — same pattern already used for Poe/HuggingChat/Grok's
      // virtualized lists. A single instant `scrollTop = 0` jump (the old
      // behavior here) lands past whatever the epitaxy virtualizer has
      // actually mounted for a long conversation, so it never backfills the
      // earliest entries and they're silently dropped unless the user had
      // already scrolled to the top by hand before exporting.
      // Smaller steps with a longer dwell at each one than other platforms
      // in this file use — Claude Code's own lazy-load trigger (and the
      // epitaxy virtualizer's own item mount/unmount) needs more than a
      // quick pass-through to register (observed live: 38 of 98 messages
      // caught at the old 0.6-viewport/250ms pace, full 98 once the app had
      // already warmed up on a second attempt).
      this.collectVisibleItems(items);
      var stepUp = scroller.clientHeight * 0.4;
      for (var u = 0; u < 300 && scroller.scrollTop > 0; u++) {
        scroller.scrollTop = Math.max(0, scroller.scrollTop - stepUp);
        scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
        await new Promise(function(r) { setTimeout(r, 400); });
        this.collectVisibleItems(items);
      }
      scroller.scrollTop = 0;
      scroller.dispatchEvent(new Event('scroll', { bubbles: true }));

      // Claude Code's own app can lazily load older history into its
      // client-side state once scrollTop actually hits 0 — on a long
      // conversation that load can take several seconds, on a short one
      // it's near-instant. Poll scrollHeight and keep collecting as it
      // grows, only moving on once it's held steady for a bit; capped so a
      // conversation with nothing left to load doesn't hang. This replaces
      // a single fixed wait that was too short for long conversations
      // (observed live: 37 of 90 messages caught with an 800ms wait).
      var settleHeight = -1;
      var settleStable = 0;
      for (var s = 0; s < 24 && settleStable < 4; s++) {
        await new Promise(function(r) { setTimeout(r, 500); });
        this.collectVisibleItems(items);
        if (scroller.scrollHeight === settleHeight) {
          settleStable++;
        } else {
          settleStable = 0;
        }
        settleHeight = scroller.scrollHeight;
      }

      // Scroll-DOWN sweep back to the bottom, same slowed-down stepped
      // pattern as the up-sweep above.
      var step = scroller.clientHeight * 0.4;
      var lastScrollTop = -1;
      for (var i = 0; i < 300; i++) {
        scroller.scrollTop += step;
        scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
        await new Promise(function(r) { setTimeout(r, 400); });
        this.collectVisibleItems(items);
        if (Math.abs(scroller.scrollTop - lastScrollTop) < 2) break;
        lastScrollTop = scroller.scrollTop;
      }
      scroller.style.overflowAnchor = originalAnchor;
    } else {
      this.collectVisibleItems(items);
    }

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
