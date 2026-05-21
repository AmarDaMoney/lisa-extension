// Grok Conversation Parser
// Extracts conversation data from grok.com

class GrokParser {
  constructor() {
    this.platform = 'Grok';
    this.conversationId = this.extractConversationId();
  }

  extractConversationId() {
    // Extract from URL: https://grok.com/chat/uuid or similar
    const match = window.location.pathname.match(/\/chat\/([a-zA-Z0-9-]+)/);
    return match ? match[1] : 'grok-session-' + Date.now();
  }

  async extractMessages() {
    const messages = [];

    // Primary: Grok wraps each turn with items-end (user) / items-start (assistant)
    const messageWrappers = document.querySelectorAll('.relative.group.flex.flex-col.justify-center.w-full');

    for (const wrapper of messageWrappers) {
      const role = wrapper.classList.contains('items-end') ? 'user'
                 : wrapper.classList.contains('items-start') ? 'assistant'
                 : null;
      if (!role) continue;

      const messageBubble = wrapper.querySelector('[class*="message-bubble"]');
      if (!messageBubble) continue;

      const textContent = this.extractTextContent(messageBubble);
      if (textContent && textContent.trim().length > 0) {
        messages.push({ role, content: textContent.trim(), index: messages.length, timestamp: new Date().toISOString() });
      }
    }

    // Fallback: data-testid attributes only (safer than class wildcards)
    if (messages.length === 0) {
      document.querySelectorAll('[data-testid*="message"]').forEach((el, i) => {
        const isUser = el.querySelector('[data-testid="User-Name"]') !== null;
        const textContent = this.extractTextContent(el);
        if (textContent && textContent.trim().length > 0) {
          messages.push({ role: isUser ? 'user' : 'assistant', content: textContent.trim(), index: i, timestamp: new Date().toISOString() });
        }
      });
    }

    return messages;
  }

  extractTextContent(element) {
    const clone = element.cloneNode(true);
    
    // Remove UI elements
    clone.querySelectorAll('button, svg, [role="button"], [data-testid*="icon"]').forEach(el => el.remove());
    
    return clone.textContent || clone.innerText || '';
  }

  async extractConversation() {
    this.conversationId = this.extractConversationId();
    const messages = await this.extractMessages();

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
        this.extractConversation().then(conversation => {
          sendResponse({ success: true, data: conversation });
        }).catch(error => {
          console.error('[LISA] Grok extraction error:', error);
          sendResponse({ success: false, error: error.message });
        });
        return true;
      }
      return true;
    });
  }
}

// Initialize parser
const parser = new GrokParser();
parser.initializeListener();

chrome.runtime.sendMessage({ 
  action: 'parserReady', 
  platform: 'Grok' 
});
