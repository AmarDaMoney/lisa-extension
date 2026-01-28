// DeepSeek Conversation Parser
// Extracts conversation data from chat.deepseek.com

class DeepSeekParser {
  constructor() {
    this.platform = 'deepseek.com';
    this.conversationId = this.extractConversationId();
  }

  extractConversationId() {
    // Extract from URL: https://chat.deepseek.com/c/uuid or /chat/uuid
    const match = window.location.pathname.match(/\/(c|chat)\/([a-f0-9-]+)/);
    return match ? match[2] : null;
  }

  extractMessages() {
    const messages = [];
    
    // DeepSeek message structure
    const messageElements = document.querySelectorAll('[class*="Message"], [class*="message"], [data-message-role]');
    
    messageElements.forEach((element, index) => {
      // Safely get className as string (handles SVGAnimatedString)
      const classStr = typeof element.className === 'string' 
        ? element.className 
        : (element.className?.baseVal || '');
      
      // Check for role attribute or class names
      const role = element.getAttribute('data-message-role');
      const isUser = role === 'user' || 
                     classStr.includes('user') ||
                     element.querySelector('[class*="user"]') !== null;
      
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
    clone.querySelectorAll('button, svg, [role="button"], [class*="action"]').forEach(el => el.remove());
    
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
  platform: 'deepseek.com' 
});
