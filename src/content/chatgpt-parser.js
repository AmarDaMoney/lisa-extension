// ChatGPT Conversation Parser
// Extracts conversation data from ChatGPT web interface

class ChatGPTParser {
  constructor() {
    this.platform = 'ChatGPT';
    this.conversationId = this.extractConversationId();
  }

  extractConversationId() {
    // Extract from URL: https://chatgpt.com/c/uuid
    const match = window.location.pathname.match(/\/c\/([a-f0-9-]+)/);
    return match ? match[1] : null;
  }

  extractMessages() {
    const messages = [];

    // Primary selector — ChatGPT tags every message turn with data-message-author-role
    let messageGroups = document.querySelectorAll('[data-message-author-role]');

    // Fallback: article elements (used in some ChatGPT layouts)
    if (messageGroups.length === 0) {
      messageGroups = document.querySelectorAll('article[data-testid], [role="article"]');
    }

    messageGroups.forEach((element, index) => {
      const role = element.getAttribute('data-message-author-role') || 'assistant';
      const textContent = this.extractTextContent(element);
      if (textContent && textContent.trim().length > 0) {
        messages.push({
          role: role === 'user' ? 'user' : 'assistant',
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

    // Strip UI chrome — buttons, icons, copy controls, sr-only labels
    clone.querySelectorAll('button, svg, [role="button"], .sr-only, [data-testid*="action"]').forEach(el => el.remove());

    // Prefer markdown/prose container; fall back to full text
    const prose = clone.querySelector('[class*="markdown"], [class*="prose"], [data-message-content]');
    const text = prose ? prose.textContent : (clone.textContent || clone.innerText || '');
    return text.trim();
  }

  async extractConversation() {
    // Refresh conversationId — may be stale after SPA navigation
    this.conversationId = this.extractConversationId();

    // Fallback: scroll to top if progressive buffer is off or cold (no buffered data yet)
    const progressive = window.lisaProgressive;
    const domCount = document.querySelectorAll('[data-message-author-role]').length;
    const bufferConvId = progressive?.conversationId || '';
    const bufferMatchesConv = !this.conversationId || !bufferConvId || bufferConvId.endsWith(this.conversationId);
    const bufferReady = progressive && progressive.mode !== 'off' && progressive.buffer.size > domCount && bufferMatchesConv;
    if (!bufferReady) {
      const scroller = document.querySelector('div[class*="overflow-y-auto"]') ||
                       document.querySelector('main');
      if (scroller) {
        scroller.scrollTop = 0;
        await new Promise(r => setTimeout(r, 700));
      }
    }
    let messages = this.extractMessages();

    // Merge with progressive buffer — recovers virtualised messages
    if (window.lisaProgressive) {
      const merged = window.lisaProgressive.mergeWithBuffer(messages);
      messages = merged.map((m, i) => ({
        role:      m.role || 'assistant',
        content:   m.content || m.v || '',
        index:     i,
        timestamp: m.timestamp || m.capturedAt || new Date().toISOString()
      }));
    }

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
        this.extractConversation()
          .then(conversation => sendResponse({ success: true, data: conversation }))
          .catch(error => {
            console.error('[LISA] ChatGPT extraction error:', error);
            sendResponse({ success: false, error: error.message });
          });
        return true;
      }
      return true;
    });
  }
}

// Initialize parser
const parser = new ChatGPTParser();
parser.initializeListener();

chrome.runtime.sendMessage({ 
  action: 'parserReady', 
  platform: 'ChatGPT' 
});
