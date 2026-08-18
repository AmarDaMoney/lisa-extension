// Mistral AI Conversation Parser
// Extracts conversation data from chat.mistral.ai
// Handles SPA navigation: old conversation messages remain in DOM
class MistralParser {
  constructor() {
    this.platform = 'Mistral AI';
    this.conversationId = this.extractConversationId();
    // Track stale messages from previous conversations (SPA doesn't unmount)
    this.staleCount = 0;
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
          // Navigation to a different conversation
          this.staleCount = document.querySelectorAll('[data-message-author-role]').length;
          window.__lisaMistralStaleCount = this.staleCount;
          this.conversationId = newConvId;
          console.debug('[LISA] Mistral SPA navigation detected, stale messages:', this.staleCount);
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
    // Skip stale messages from previous conversations
    const currentElements = Array.from(allElements).slice(this.staleCount);

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
      return true;
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
