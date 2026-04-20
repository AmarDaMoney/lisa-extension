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
    
    // Copilot uses user-message and ai-message class patterns
    const userMessages = document.querySelectorAll('[class*="user-message"]');
    const aiMessages = document.querySelectorAll('[class*="ai-message"]');

    // Collect all messages with their position in DOM for correct ordering
    const allMessages = [];
    
    userMessages.forEach(el => {
      // Skip non-content containers (e.g. wrapper divs that also match)
      const textContent = this.extractTextContent(el);
      if (textContent && textContent.trim().length > 0) {
        allMessages.push({ el, role: 'user', pos: el.getBoundingClientRect().top });
      }
    });

    aiMessages.forEach(el => {
      const textContent = this.extractTextContent(el);
      if (textContent && textContent.trim().length > 0) {
        allMessages.push({ el, role: 'assistant', pos: el.getBoundingClientRect().top });
      }
    });

    // Sort by vertical position to maintain conversation order
    allMessages.sort((a, b) => a.pos - b.pos);

    // Deduplicate — nested elements may match multiple times
    const seen = new Set();
    for (const msg of allMessages) {
      const text = this.extractTextContent(msg.el).trim();
      const key = text.substring(0, 100);
      if (seen.has(key)) continue;
      seen.add(key);
      messages.push({
        role: msg.role,
        content: text,
        index: messages.length,
        timestamp: new Date().toISOString()
      });
    }

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
