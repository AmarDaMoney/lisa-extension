// Perplexity AI Conversation Parser
// Extracts conversation data from perplexity.ai

class PerplexityParser {
  constructor() {
    this.platform = 'Perplexity';
    this.conversationId = this.extractConversationId();
  }

  extractConversationId() {
    // Extract from URL: https://perplexity.ai/search/uuid or /chat/uuid
    const match = window.location.pathname.match(/\/(search|chat)\/([a-zA-Z0-9._-]+)/);
    return match ? match[2] : null;
  }

  extractMessages() {
    const messages = [];
    
    // Perplexity message structure
    const messageElements = document.querySelectorAll('[class*="SearchResult"], [class*="message"], [class*="query"]');
    
    messageElements.forEach((element, index) => {
      // Safely get className as string (handles SVGAnimatedString)
      const classStr = typeof element.className === 'string' 
        ? element.className 
        : (element.className?.baseVal || '');
      
      // Determine role
      const isUser = classStr.includes('query') || 
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
    
    // Remove UI elements and citations
    clone.querySelectorAll('button, svg, [role="button"], [class*="citation"]').forEach(el => el.remove());
    
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
          console.error('[LISA] Perplexity extraction error:', error);
          sendResponse({ success: false, error: error.message });
        }
      }
      return true;
    });
  }
}

// Initialize parser
const parser = new PerplexityParser();
parser.initializeListener();

chrome.runtime.sendMessage({ 
  action: 'parserReady', 
  platform: 'Perplexity' 
});
