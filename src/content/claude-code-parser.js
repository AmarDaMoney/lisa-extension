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
    return [...document.querySelectorAll('div')].filter(function(el) {
      var s = getComputedStyle(el);
      return (s.overflowY === 'auto' || s.overflowY === 'scroll')
             && el.scrollHeight > el.clientHeight + 200;
    }).sort(function(a, b) { return b.scrollHeight - a.scrollHeight; })[0] || null;
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
    var scroller = this.findScroller();
    var items = new Map();

    if (scroller) {
      scroller.scrollTop = 0;
      await new Promise(function(r) { setTimeout(r, 500); });
      this.collectVisibleItems(items);

      var step = scroller.clientHeight * 0.6;
      var lastScrollTop = -1;
      for (var i = 0; i < 200; i++) {
        scroller.scrollTop += step;
        scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
        await new Promise(function(r) { setTimeout(r, 250); });
        this.collectVisibleItems(items);
        if (Math.abs(scroller.scrollTop - lastScrollTop) < 2) break;
        lastScrollTop = scroller.scrollTop;
      }
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
