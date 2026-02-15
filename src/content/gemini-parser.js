// Gemini Conversation Parser
// Extracts conversation data from Gemini web interface

class GeminiParser {
  constructor() {
    this.platform = 'Gemini';
    this.conversationId = this.extractConversationId();
  }

  extractConversationId() {
    // Extract from URL: https://gemini.google.com/app/uuid or /chat/uuid
    const match = window.location.pathname.match(/\/(app|chat)\/([a-f0-9]+)/);
    return match ? match[2] : null;
  }

  extractMessages() {
    const messages = [];
    
    // Gemini uses message-content class structure
    const messageElements = document.querySelectorAll('[class*="conversation-turn"], [class*="message"]');
    
    messageElements.forEach((element, index) => {
      // Determine role based on classes or data attributes
      const isUser = element.querySelector('[class*="user"]') !== null ||
                     element.closest('[class*="user-turn"]') !== null;
      
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

    // Get title from first user message if document.title is just "Gemini"
    const firstUserMsg = messages.find(m => m.role === 'user');
    const title = document.title === 'Gemini' && firstUserMsg 
    ? firstUserMsg.content.slice(0, 50) + (firstUserMsg.content.length > 50 ? '...' : '')
    : document.title;

    return {
      platform: this.platform,
      conversationId: this.conversationId,
      url: window.location.href,
      title: title,
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
          console.error('[LISA] Gemini extraction error:', error);
          sendResponse({ success: false, error: error.message });
        }
      }
      return true;
    });
  }
}

// Initialize parser
const parser = new GeminiParser();
parser.initializeListener();

chrome.runtime.sendMessage({ 
  action: 'parserReady', 
  platform: 'Gemini' 
});
