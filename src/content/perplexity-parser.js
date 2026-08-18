// Perplexity AI Conversation Parser
// Extracts conversation data from perplexity.ai

if (typeof PerplexityParser === 'undefined') {
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
    const converter = window.__lisaHtmlToMarkdown;
    // Scope to conversation container to avoid sidebar noise
    const container = document.querySelector('.scrollable-container') || document;
    // Walk all user queries and assistant responses in DOM order
    // (Perplexity may start with an assistant response before any user query)
    const allEls = container.querySelectorAll('span[class*="whitespace-pre-line"], div.prose');
    for (const el of allEls) {
      const isUser = el.tagName === 'SPAN' && el.className.includes('whitespace-pre-line');
      const textContent = converter ? converter.extractAsMarkdown(el) : this.extractTextContent(el);
      if (textContent && textContent.trim().length > 0) {
        messages.push({
          role: isUser ? 'user' : 'assistant',
          content: textContent.trim(),
          index: messages.length,
          timestamp: new Date().toISOString()
        });
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

  async extractConversation() {
    this.conversationId = this.extractConversationId();
    // Try API capture first for full conversation history
    const apiCapture = window.__LISA_PERPLEXITY_API_CAPTURE;
    if (apiCapture) {
      try {
        const apiResult = await apiCapture.extractViaAPI();
        if (apiResult && apiResult.messages && apiResult.messages.length > 0) {
          return apiResult;
        }
      } catch (e) {
        console.debug('[LISA] Perplexity API capture failed, falling back to DOM:', e);
      }
    }
    // Fallback: DOM extraction
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
        this.extractConversation()
          .then(conversation => sendResponse({ success: true, data: conversation }))
          .catch(error => {
            console.error('[LISA] Perplexity extraction error:', error);
            sendResponse({ success: false, error: error.message });
          });
        return true;
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
} // end PerplexityParser guard
