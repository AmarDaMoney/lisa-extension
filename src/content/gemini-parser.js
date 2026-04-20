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
    
    // Gemini uses .conversation-container with user-query and response-container inside
    const turns = document.querySelectorAll('.conversation-container');

    for (const turn of turns) {
      // Extract user message
      const userQuery = turn.querySelector('[class*="user-query"]');
      if (userQuery) {
        const userText = this.extractTextContent(userQuery);
        if (userText && userText.trim().length > 0) {
          // Strip "Vous avez dit" / "You said" prefix that Gemini adds
          let cleanText = userText.trim()
            .replace(/^Vous avez dit\s*/i, '')
            .replace(/^You said\s*/i, '');
          messages.push({
            role: 'user',
            content: cleanText.trim(),
            index: messages.length,
            timestamp: new Date().toISOString()
          });
        }
      }

      // Extract assistant response
      const response = turn.querySelector('.presented-response-container') || turn.querySelector('[class*="response-container"]');
      if (response) {
        const respText = this.extractTextContent(response);
        if (respText && respText.trim().length > 0) {
          // Strip "Gemini a dit" / "Gemini said" and reasoning prefixes
          let cleanText = respText.trim()
            .replace(/^Afficher le raisonnement\s*/i, '')
            .replace(/^Show thinking\s*/i, '')
            .replace(/^Gemini a dit\s*/i, '')
            .replace(/^Gemini said\s*/i, '');
          messages.push({
            role: 'assistant',
            content: cleanText.trim(),
            index: messages.length,
            timestamp: new Date().toISOString()
          });
        }
      }
    }


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

    // Get title from conversation-title element or first user message
    const titleElement = document.querySelector('.conversation-title');
    const firstUserMsg = messages.find(m => m.role === 'user');
    const title = titleElement?.textContent?.trim() 
      || (firstUserMsg ? firstUserMsg.content.slice(0, 50) + (firstUserMsg.content.length > 50 ? '...' : '') : 'Gemini Conversation');

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
