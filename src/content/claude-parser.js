// Claude.ai Conversation Parser
// Extracts conversation data from Claude web interface

class ClaudeParser {
  constructor() {
    this.platform = 'claude.ai';
    this.conversationId = this.extractConversationId();
  }

  extractConversationId() {
    // Extract from URL: https://claude.ai/chat/uuid
    const match = window.location.pathname.match(/\/chat\/([a-f0-9-]+)/);
    return match ? match[1] : null;
  }

  extractMessages() {
    const messages = [];
    
    // Claude uses specific DOM structure for messages
    // This selector targets message containers
    const messageElements = document.querySelectorAll('[data-test-render-count]');
    
    messageElements.forEach((element, index) => {
      // Determine if user or assistant message
      const isUser = element.querySelector('[data-is-streaming="false"]')?.textContent.includes('You') || 
                     element.closest('[class*="human"]') !== null;
      
      // Extract text content, excluding UI elements
      const textContent = this.extractTextContent(element);
      
      if (textContent && textContent.trim().length > 0) {
        messages.push({
          role: isUser ? 'user' : 'assistant',
          content: textContent.trim(),
          index: index,
          timestamp: new Date().toISOString() // Claude doesn't expose timestamps easily
        });
      }
    });

    return messages;
  }

  extractTextContent(element) {
    // Clone element to avoid modifying DOM
    const clone = element.cloneNode(true);
    
    // Remove button elements, icons, and UI components
    clone.querySelectorAll('button, svg, [role="button"]').forEach(el => el.remove());
    
    // Get text content
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

  // Listen for extraction requests from popup
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
          console.error('[LISA] Claude extraction error:', error);
          sendResponse({ success: false, error: error.message });
        }
      }
      return true; // Keep channel open for async response
    });
  }
}

// Initialize parser when script loads
const parser = new ClaudeParser();
parser.initializeListener();

// Signal that parser is ready
chrome.runtime.sendMessage({ 
  action: 'parserReady', 
  platform: 'claude.ai' 
});
