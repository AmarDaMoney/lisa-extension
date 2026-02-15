// Microsoft Copilot Conversation Parser
// Extracts conversation data from copilot.microsoft.com

class CopilotParser {
  constructor() {
    this.platform = 'Microsoft Copilot';
    this.conversationId = this.extractConversationId();
  }

  extractConversationId() {
    // Copilot may use session or conversation IDs
    const match = window.location.pathname.match(/\/chat\/([a-zA-Z0-9-]+)/);
    return match ? match[1] : 'copilot-session';
  }

  extractMessages() {
    const messages = [];
    
    // Copilot uses cib- prefixed classes
    const messageElements = document.querySelectorAll('[class*="cib-message"], [class*="message"], cib-message-group');
    
    messageElements.forEach((element, index) => {
      // Safely get className as string (handles SVGAnimatedString)
      const classStr = typeof element.className === 'string' 
        ? element.className 
        : (element.className?.baseVal || '');
      
      // Determine if user or Copilot
      const isUser = element.getAttribute('source') === 'user' ||
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
    clone.querySelectorAll('button, svg, [role="button"], [class*="icon"]').forEach(el => el.remove());
    
    // Copilot may have specific content containers
    const contentDiv = clone.querySelector('[class*="content"]');
    return contentDiv ? (contentDiv.textContent || contentDiv.innerText || '') : (clone.textContent || clone.innerText || '');
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
          console.error('[LISA] Copilot extraction error:', error);
          sendResponse({ success: false, error: error.message });
        }
      }
      return true;
    });
  }
}

// Initialize parser
const parser = new CopilotParser();
parser.initializeListener();

chrome.runtime.sendMessage({ 
  action: 'parserReady', 
  platform: 'Microsoft Copilot' 
});
