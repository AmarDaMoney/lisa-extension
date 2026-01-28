// ChatGPT Conversation Parser
// Extracts conversation data from ChatGPT web interface

class ChatGPTParser {
  constructor() {
    this.platform = 'chatgpt.com';
    this.conversationId = this.extractConversationId();
  }

  extractConversationId() {
    // Extract from URL: https://chatgpt.com/c/uuid
    const match = window.location.pathname.match(/\/c\/([a-f0-9-]+)/);
    return match ? match[1] : null;
  }

  extractMessages() {
    const messages = [];
    
    // ChatGPT message structure - updated selectors for current DOM
    // Try multiple selector strategies
    let messageGroups = document.querySelectorAll('[data-message-author-role]');
    
    // Fallback if first selector doesn't work
    if (messageGroups.length === 0) {
      messageGroups = document.querySelectorAll('[class*="group"]');
    }
    
    // Another fallback - look for conversation turns
    if (messageGroups.length === 0) {
      messageGroups = document.querySelectorAll('article, [role="article"]');
    }
    
    messageGroups.forEach((element, index) => {
      // Multiple ways to determine role
      let role = element.getAttribute('data-message-author-role');
      
      if (!role) {
        // Check class names for hints
        const classes = element.className || '';
        if (classes.includes('user') || element.querySelector('[data-message-author-role="user"]')) {
          role = 'user';
        } else {
          role = 'assistant';
        }
      }
      
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
    // Clone to avoid DOM modification
    const clone = element.cloneNode(true);
    
    // Remove buttons, icons, and UI elements
    clone.querySelectorAll('button, svg, [role="button"], .sr-only').forEach(el => el.remove());
    
    // Get markdown content if available, otherwise plain text
    const markdownDiv = clone.querySelector('[class*="markdown"]');
    return markdownDiv ? markdownDiv.textContent : (clone.textContent || clone.innerText || '');
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
          console.error('[LISA] ChatGPT extraction error:', error);
          sendResponse({ success: false, error: error.message });
        }
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
  platform: 'chatgpt.com' 
});
