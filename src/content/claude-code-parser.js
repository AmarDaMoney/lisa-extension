// Claude Code Session Parser
// Extracts from claude.ai/code/* pages using data-epitaxy-entry structure
// User entries have UUID IDs, assistant entries have msg_ prefix IDs

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
    // Claude Code uses epitaxy-titlebar for session title
    const titlebar = document.querySelector('.epitaxy-titlebar');
    if (titlebar) {
      const titleDiv = titlebar.querySelector('div.flex.items-center.min-w-\\[32px\\]')
                    || titlebar.querySelector('span.flex.min-w-0.items-center > div:first-child');
      if (titleDiv && titleDiv.textContent.trim().length > 0) {
        return titleDiv.textContent.trim();
      }
    }
    // Fallback: first user message snippet
    const firstEntry = document.querySelector('[data-epitaxy-entry]:not([data-epitaxy-entry^="msg_"])');
    if (firstEntry) {
      const text = firstEntry.textContent.trim().slice(0, 80);
      if (text) return text + (firstEntry.textContent.trim().length > 80 ? '…' : '');
    }
    return 'Claude Code Session';
  }

  cleanText(text) {
    if (!text) return '';
    // Strip role prefixes (French and English)
    text = text.replace(/^Vous avez dit\s*:?\s*/i, '');
    text = text.replace(/^You said\s*:?\s*/i, '');
    text = text.replace(/^Claude a répondu\s*:?\s*/i, '');
    text = text.replace(/^Claude replied\s*:?\s*/i, '');
    text = text.replace(/^Afficher moins\s*/i, '');
    text = text.replace(/^Show less\s*/i, '');
    // Strip trailing timestamps
    text = text.replace(/\n\d{1,2}:\d{2}\s*(AM|PM)\s*$/i, '');
    // Strip "Crédits d'utilisation épuisés" / "Usage credits exhausted" noise
    text = text.replace(/Crédits d'utilisation épuisés.*/i, '');
    text = text.replace(/Usage credits exhausted.*/i, '');
    // Strip time-ago markers
    text = text.replace(/il y a \d+\s*(mois|jours?|heures?|minutes?|secondes?)\s*$/i, '');
    text = text.replace(/\d+\s*(months?|days?|hours?|minutes?|seconds?)\s*ago\s*$/i, '');
    // Collapse duplicate lines
    text = text.split('\n').filter((ln, i, a) => i === 0 || ln.trim() === '' || ln.trim() !== a[i-1].trim()).join('\n');
    return text.trim();
  }

  async performScrollSweep() {
    const scrollable = [...document.querySelectorAll('div')].filter(el => {
      const s = getComputedStyle(el);
      return (s.overflowY === 'auto' || s.overflowY === 'scroll')
             && el.scrollHeight > el.clientHeight + 200;
    }).sort((a, b) => b.scrollHeight - a.scrollHeight);

    const scroller = scrollable[0];
    if (!scroller) return;

    // Scroll to top first
    scroller.scrollTop = 0;
    await new Promise(r => setTimeout(r, 500));

    // Scroll down incrementally to load all virtualized entries
    const step = scroller.clientHeight * 0.7;
    let stableCount = 0;
    let lastEntryCount = 0;

    for (let i = 0; i < 100; i++) {
      scroller.scrollTop += step;
      scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
      await new Promise(r => setTimeout(r, 300));

      const entries = new Set([...document.querySelectorAll('[data-epitaxy-entry]')]
        .map(el => el.getAttribute('data-epitaxy-entry')));

      if (entries.size === lastEntryCount) {
        stableCount++;
        if (stableCount >= 3) break;
      } else {
        stableCount = 0;
        lastEntryCount = entries.size;
      }
    }

    // Scroll back to top to capture first entries
    scroller.scrollTop = 0;
    await new Promise(r => setTimeout(r, 500));
  }

  extractMessages() {
    const messages = [];
    const seenEntries = new Set();
    const converter = window.__lisaHtmlToMarkdown;

    // Collect all entry elements, group by entry ID
    const entryMap = new Map();
    const entryOrder = [];
    const allEls = document.querySelectorAll('[data-epitaxy-entry]');

    for (const el of allEls) {
      const entryId = el.getAttribute('data-epitaxy-entry');
      if (!entryId) continue;
      if (!entryMap.has(entryId)) {
        entryMap.set(entryId, []);
        entryOrder.push(entryId);
      }
      entryMap.get(entryId).push(el);
    }

    for (const entryId of entryOrder) {
      if (seenEntries.has(entryId)) continue;
      seenEntries.add(entryId);

      const elements = entryMap.get(entryId);
      const isAssistant = entryId.startsWith('msg_');
      const role = isAssistant ? 'assistant' : 'user';

      // Concatenate text from all message-rows in this entry
      const parts = [];
      for (const el of elements) {
        const msgRow = el.querySelector('.group\\/message-row') || el;
        const clone = msgRow.cloneNode(true);
        // Remove tool-action labels (French/English)
        clone.querySelectorAll('[class*="group/tool"], button, svg, [role="button"], [class*="opacity-0"]').forEach(e => e.remove());
        let text;
        if (converter) {
          text = converter.extractAsMarkdown(clone);
        } else {
          text = clone.textContent || '';
        }
        if (text && text.trim()) parts.push(text.trim());
      }

      const fullText = this.cleanText(parts.join('\n'));
      if (fullText.length > 0) {
        messages.push({
          role: role,
          content: fullText,
          index: messages.length,
          timestamp: new Date().toISOString()
        });
      }
    }

    return messages;
  }

  async extractConversation() {
    this.conversationId = this.extractConversationId();

    // Scroll sweep to load virtualized entries
    await this.performScrollSweep();

    // Extract after first sweep
    let messages = this.extractMessages();

    // Second pass: scroll to bottom to catch any remaining
    const scrollable = [...document.querySelectorAll('div')].filter(el => {
      const s = getComputedStyle(el);
      return (s.overflowY === 'auto' || s.overflowY === 'scroll')
             && el.scrollHeight > el.clientHeight + 200;
    }).sort((a, b) => b.scrollHeight - a.scrollHeight);

    if (scrollable[0]) {
      scrollable[0].scrollTop = scrollable[0].scrollHeight;
      await new Promise(r => setTimeout(r, 500));
      // Merge any new entries
      const secondPass = this.extractMessages();
      if (secondPass.length > messages.length) {
        messages = secondPass;
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
      _captureMethod: 'dom-epitaxy'
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

const claudeCodeParser = new ClaudeCodeParser();
claudeCodeParser.initializeListener();

chrome.runtime.sendMessage({
  action: 'parserReady',
  platform: 'Claude Code'
});

} // end guard
