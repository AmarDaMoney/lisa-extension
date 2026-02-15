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

  extractMessages() {
    const messages = [];
    
    // Grok uses similar structure to Twitter/X
    // Target message containers
    const messageElements = document.querySelectorAll('[data-testid*="message"], [class*="message"], article');
    
    messageElements.forEach((element, index) => {
      // Determine if user or Grok message
      const isUser = element.querySelector('[data-testid="User-Name"]') !== null ||
                     element.textContent.includes('You:') ||
                     element.closest('[class*="user"]') !== null;
      
      const textContent = this.extractTextContent(element);
      
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
    
    // Remove UI elements
    clone.querySelectorAll('button, svg, [role="button"], [data-testid*="icon"]').forEach(el => el.remove());
    
    return clone.textContent || clone.innerText || '';
  }

  extractConversation() {
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
        try {
          const conversation = this.extractConversation();
          sendResponse({ success: true, data: conversation });
        } catch (error) {
          console.error('[LISA] Grok extraction error:', error);
          sendResponse({ success: false, error: error.message });
        }
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
