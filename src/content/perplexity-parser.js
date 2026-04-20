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
    
    // Perplexity uses group/query for user messages and .prose for assistant responses
    // Collect user queries (DIV elements with group/query class, skip H1 duplicates)
    const queries = document.querySelectorAll('div[class*="group/query"]');
    // Collect assistant responses
    const proseElements = document.querySelectorAll('div.prose');

    // Interleave: each query is followed by a prose response
    const maxPairs = Math.max(queries.length, proseElements.length);
    for (let i = 0; i < maxPairs; i++) {
      if (i < queries.length) {
        const textContent = this.extractTextContent(queries[i]);
        if (textContent && textContent.trim().length > 0) {
          messages.push({
            role: 'user',
            content: textContent.trim(),
            index: messages.length,
            timestamp: new Date().toISOString()
          });
        }
      }
      if (i < proseElements.length) {
        const textContent = this.extractTextContent(proseElements[i]);
        if (textContent && textContent.trim().length > 0) {
          messages.push({
            role: 'assistant',
            content: textContent.trim(),
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
