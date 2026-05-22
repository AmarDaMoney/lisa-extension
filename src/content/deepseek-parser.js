// DeepSeek Conversation Parser
// Extracts conversation data from chat.deepseek.com

class DeepSeekParser {
  constructor() {
    this.platform = 'DeepSeek';
    this.conversationId = this.extractConversationId();
  }

  extractConversationId() {
    // Extract from URL: https://chat.deepseek.com/c/uuid or /chat/uuid
    const match = window.location.pathname.match(/\/(c|chat)\/([a-f0-9-]+)/);
    return match ? match[2] : null;
  }

  extractMessages() {
    const messages = [];

    // Primary: .ds-message is DeepSeek's stable message container
    let messageElements = document.querySelectorAll('.ds-message');

    // Fallback: data-message-role attribute (more reliable than class wildcards)
    if (messageElements.length === 0) {
      messageElements = document.querySelectorAll('[data-message-role]');
    }

    messageElements.forEach((element, index) => {
      const dataRole = element.getAttribute('data-message-role');
      const role = dataRole
        ? (dataRole === 'user' ? 'user' : 'assistant')
        : (element.querySelector('.ds-markdown') ? 'assistant' : 'user');

      const textContent = this.extractTextContent(element);
      if (textContent && textContent.trim().length > 0) {
        messages.push({ role, content: textContent.trim(), index, timestamp: new Date().toISOString() });
      }
    });

    return messages;
  }

  extractTextContent(element) {
    const clone = element.cloneNode(true);
    clone.querySelectorAll('button, svg, [role="button"], [class*="action"], [class*="copy"]').forEach(el => el.remove());
    const prose = clone.querySelector('.ds-markdown') || clone.querySelector('[class*="content"]');
    return (prose ? prose.textContent : (clone.textContent || clone.innerText || '')).trim();
  }

  async extractConversation() {
    this.conversationId = this.extractConversationId();
    const progressive = window.lisaProgressive;
    const domCount = document.querySelectorAll('.ds-message, [data-message-role]').length;
    const bufferConvId = progressive?.conversationId || '';
    const bufferMatchesConv = !this.conversationId || !bufferConvId || bufferConvId.endsWith(this.conversationId);
    const bufferReady = progressive && progressive.mode !== 'off' && progressive.buffer.size > domCount && bufferMatchesConv;
    if (!bufferReady) {
      const scroller = document.querySelector('.ds-conversation-wrapper, main');
      if (scroller && window.lisaProgressive) {
        await window.lisaProgressive.performScrollSweep(scroller);
      } else if (scroller) {
        scroller.scrollTop = 0;
        await new Promise(r => setTimeout(r, 700));
      }
    }
    let messages = this.extractMessages();
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
        try {
          const conversation = this.extractConversation();
          sendResponse({ success: true, data: conversation });
        } catch (error) {
          console.error('[LISA] DeepSeek extraction error:', error);
          sendResponse({ success: false, error: error.message });
        }
      }
      return true;
    });
  }
}

// Initialize parser
const parser = new DeepSeekParser();
parser.initializeListener();

chrome.runtime.sendMessage({ 
  action: 'parserReady', 
  platform: 'DeepSeek' 
});
