// Mistral AI Conversation Parser
// Extracts conversation data from chat.mistral.ai
// Handles SPA navigation: old conversation messages may remain in the DOM
// The page's messages minus those left over from the previous conversation; never
// none of them (if Mistral reused the old elements, everything on the page is current).
function lisaMistralCurrent(elements) {
  const all = Array.from(elements);
  const stale = window.__lisaMistralStale;
  const current = stale ? all.filter(el => !stale.has(el)) : all;
  return current.length ? current : all;
}
window.__lisaMistralCurrent = lisaMistralCurrent;

class MistralParser {
  constructor() {
    this.platform = 'Mistral AI';
    this.conversationId = this.extractConversationId();
    // Messages still on the page from the previous conversation (SPA navigation).
    // The elements themselves, not a count: Mistral now replaces them, and a count
    // taken before the swap skipped the new conversation's own messages (0 exported).
    window.__lisaMistralStale = window.__lisaMistralStale || new WeakSet();
    this._lastUrl = window.location.href;
    this._watchNavigation();
  }

  _watchNavigation() {
    // Mistral is an SPA — URL changes without page reload
    // Record current message count as stale when URL changes
    const check = () => {
      const currentUrl = window.location.href;
      if (currentUrl !== this._lastUrl) {
        const newConvId = this.extractConversationId();
        if (newConvId !== this.conversationId) {
          // Navigation to a different conversation: what is on the page now is the old one.
          // (From no id to an id is the same new chat getting its id: nothing is stale.)
          const stale = new WeakSet();
          let n = 0;
          if (this.conversationId) document.querySelectorAll('[data-message-author-role]').forEach(el => { stale.add(el); n++; });
          window.__lisaMistralStale = stale;
          this.conversationId = newConvId;
          console.debug('[LISA] Mistral SPA navigation detected, stale messages:', n);
        }
        this._lastUrl = currentUrl;
      }
    };
    // Poll for URL changes (pushState doesn't fire popstate)
    setInterval(check, 500);
    // Also catch back/forward
    window.addEventListener('popstate', check);
  }

  extractConversationId() {
    const match = window.location.pathname.match(/\/chat\/([a-f0-9-]+)/);
    return match ? match[1] : null;
  }

  extractMessages() {
    const messages = [];
    const allElements = document.querySelectorAll('[data-message-author-role]');
    const currentElements = lisaMistralCurrent(allElements);

    currentElements.forEach((element, index) => {
      let role = element.getAttribute('data-message-author-role');
      let isUser;
      if (role) {
        isUser = role === 'user';
      } else {
        const classStr = typeof element.className === 'string'
          ? element.className
          : (element.className?.baseVal || '');
        isUser = classStr.includes('user') ||
                 classStr.includes('human') ||
                 element.querySelector('[class*="user"]') !== null;
      }

      const converter = window.__lisaHtmlToMarkdown;
      const textContent = converter ? converter.extractAsMarkdown(element) : this.extractTextContent(element);

      if (textContent && textContent.trim().length > 0) {
        messages.push({
          role: isUser ? 'user' : 'assistant',
          content: textContent.trim(),
          index: index,
          timestamp: new Date().toISOString()
        });
      }
    });
    return messages;
  }

  extractTextContent(element) {
    const clone = element.cloneNode(true);
    clone.querySelectorAll('button, svg, [role="button"], [class*="icon"]').forEach(el => el.remove());
    return clone.textContent || clone.innerText || '';
  }

  async extractConversation() {
    this.conversationId = this.extractConversationId();
    const messages = this.extractMessages();

    if (messages.length === 0) {
      return null;
    }
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
        this.extractConversation()
          .then(conversation => sendResponse({ success: true, data: conversation }))
          .catch(error => {
            console.error('[LISA] Mistral extraction error:', error);
            sendResponse({ success: false, error: error.message });
          });
        return true;
      }
      return false; // not ours — let other listeners answer, or the sender fail fast
    });
  }
}

// Initialize parser
const parser = new MistralParser();
parser.initializeListener();

chrome.runtime.sendMessage({
  action: 'parserReady',
  platform: 'Mistral AI'
});
