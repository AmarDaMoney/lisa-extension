// Claude Code Session Parser
// Extracts from claude.ai/code/* pages using data-epitaxy-entry structure
// User entries have UUID IDs, assistant entries have msg_ prefix IDs
// DOM is aggressively virtualized — must accumulate while scrolling

if (typeof ClaudeCodeParser !== 'undefined') {
  // Already loaded — skip re-declaration
} else {

class ClaudeCodeParser {
  constructor() {
    this.platform = 'Claude Code';
    this.conversationId = this.extractConversationId();
  }

  extractConversationId() {
    const match = window.location.pathname.match(/\/code\/(session_[a-zA-Z0-9]+)/);
    return match ? match[1] : null;
  }

  extractTitle() {
    const titlebar = document.querySelector('.epitaxy-titlebar');
    if (titlebar) {
      const titleDiv = titlebar.querySelector('span.flex.min-w-0.items-center > div:first-child');
      if (titleDiv && titleDiv.textContent.trim().length > 0) {
        return titleDiv.textContent.trim();
      }
    }
    const firstEntry = document.querySelector('[data-epitaxy-entry]:not([data-epitaxy-entry^="msg_"])');
    if (firstEntry) {
      const text = firstEntry.textContent.trim().slice(0, 80);
      if (text) return text;
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
    text = text.split('\n').filter((ln, i, a) => i === 0 || ln.trim() === '' || ln.trim() !== a[i-1].trim()).join('\n');
    return text.trim();
  }

  findScroller() {
    return [...document.querySelectorAll('div')].filter(function(el) {
      var s = getComputedStyle(el);
      return (s.overflowY === 'auto' || s.overflowY === 'scroll')
             && el.scrollHeight > el.clientHeight + 200;
    }).sort(function(a, b) { return b.scrollHeight - a.scrollHeight; })[0] || null;
  }

  collectVisibleEntries(accumulated) {
    var converter = window.__lisaHtmlToMarkdown;
    var allEls = document.querySelectorAll('[data-epitaxy-entry]');
    for (var i = 0; i < allEls.length; i++) {
      var el = allEls[i];
      var entryId = el.getAttribute('data-epitaxy-entry');
      if (!entryId || accumulated.has(entryId)) continue;
      var idx = parseInt(el.getAttribute('data-epitaxy-entry-index') || '0', 10);
      var isAssistant = entryId.startsWith('msg_');
      var role = isAssistant ? 'assistant' : 'user';
      var rows = el.querySelectorAll('.group\\/message-row');
      var targets = rows.length > 0 ? rows : [el];
      var parts = [];
      for (var j = 0; j < targets.length; j++) {
        var clone = targets[j].cloneNode(true);
        clone.querySelectorAll('[class*="group/tool"], button, svg, [role="button"], [class*="opacity-0"]').forEach(function(e) { e.remove(); });
        var text;
        if (converter) {
          text = converter.extractAsMarkdown(clone);
        } else {
          text = clone.textContent || '';
        }
        if (text && text.trim()) parts.push(text.trim());
      }
      var fullText = this.cleanText(parts.join('\n'));
      if (fullText.length > 0) {
        accumulated.set(entryId, { role: role, content: fullText, sortIdx: idx });
      }
    }
  }

  async extractConversation() {
    this.conversationId = this.extractConversationId();
    var scroller = this.findScroller();
    var accumulated = new Map();

    if (scroller) {
      // Scroll to top
      scroller.scrollTop = 0;
      await new Promise(function(r) { setTimeout(r, 500); });
      this.collectVisibleEntries(accumulated);

      // Scroll down incrementally, collecting at each position
      var step = scroller.clientHeight * 0.6;
      var lastScrollTop = -1;
      for (var i = 0; i < 200; i++) {
        scroller.scrollTop += step;
        scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
        await new Promise(function(r) { setTimeout(r, 250); });
        this.collectVisibleEntries(accumulated);
        // Stop when scroll position stops changing (hit bottom)
        if (Math.abs(scroller.scrollTop - lastScrollTop) < 2) break;
        lastScrollTop = scroller.scrollTop;
      }
    } else {
      this.collectVisibleEntries(accumulated);
    }

    // Sort by entry index and build messages
    var sorted = [...accumulated.values()].sort(function(a, b) { return a.sortIdx - b.sortIdx; });
    var messages = sorted.map(function(entry, i) {
      return {
        role: entry.role,
        content: entry.content,
        index: i,
        timestamp: new Date().toISOString()
      };
    });

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
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'ping') {
        sendResponse({ success: true, platform: this.platform });
        return true;
      }
      if (request.action === 'extractConversation') {
        this.extractConversation()
          .then(conversation => sendResponse({ success: true, data: conversation }))
          .catch(error => {
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
