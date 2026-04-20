// Mistral AI Conversation Parser
// Extracts conversation data from chat.mistral.ai

class MistralParser {
  constructor() {
    this.platform = 'Mistral AI';
    this.conversationId = this.extractConversationId();
  }

  extractConversationId() {
    // Extract from URL: https://chat.mistral.ai/chat/uuid
    const match = window.location.pathname.match(/\/chat\/([a-f0-9-]+)/);
    return match ? match[1] : null;
  }

  extractMessages() {
    const messages = [];
    
    // Mistral uses data-message-author-role attributes (same pattern as ChatGPT)
    let messageElements = document.querySelectorAll('[data-message-author-role]');
    
    // Fallback: class-based selectors for older Mistral versions
    if (messageElements.length === 0) {
      messageElements = document.querySelectorAll('[class*="group/message"], [class*="message"], [class*="chat-message"]');
    }
    
    messageElements.forEach((element, index) => {
      // Primary: use data attribute for role
      let role = element.getAttribute('data-message-author-role');
      let isUser;
      if (role) {
        isUser = role === 'user';
      } else {
        // Fallback: class-based detection
        const classStr = typeof element.className === 'string' 
          ? element.className 
          : (element.className?.baseVal || '');
        isUser = classStr.includes('user') || 
                 classStr.includes('human') ||
                 element.querySelector('[class*="user"]') !== null;
      }
      
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
    clone.querySelectorAll('button, svg, [role="button"], [class*="icon"]').forEach(el => el.remove());
    
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
          console.error('[LISA] Mistral extraction error:', error);
          sendResponse({ success: false, error: error.message });
        }
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
