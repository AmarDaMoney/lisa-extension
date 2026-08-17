// Poe Conversation Parser
// Extracts conversation data from poe.com
class PoeParser {
  constructor() {
    this.platform = 'Poe';
    this.conversationId = this.extractConversationId();
  }

  extractConversationId() {
    const match = window.location.pathname.match(/\/chat\/([a-zA-Z0-9]+)/);
    return match ? match[1] : null;
  }

  extractMessages() {
    const messages = [];
    const container = document.querySelector('[class*="ChatMessagesScrollWrapper_scrollableContainer"]') || document;

    // Each message tuple contains one user or assistant message
    const tuples = container.querySelectorAll('[class*="ChatMessagesView_messageTuple"]');

    for (const tuple of tuples) {
      // Skip bot info cards
      if (tuple.querySelector('[class*="BotInfoCard"]')) continue;

      // Detect role: user messages use right-side bubble
      const isUser = !!tuple.querySelector('[class*="Message_rightSideMessageBubble"]');

      let textContent = '';
      if (isUser) {
        const textEl = tuple.querySelector('[class*="Message_messageTextContainer"]');
        if (textEl) textContent = this.extractTextContent(textEl);
      } else {
        const markdownEl = tuple.querySelector('[class*="Markdown_markdownContainer"]');
        if (markdownEl) textContent = this.extractTextContent(markdownEl);
      }

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
    // Remove UI elements, buttons, citations, attachments
    clone.querySelectorAll('button, svg, [role="button"], [class*="Attachment"], [class*="citation"]').forEach(el => el.remove());
    return clone.textContent || clone.innerText || '';
  }

  async extractConversation() {
    this.conversationId = this.extractConversationId();
    const messages = this.extractMessages();

    if (messages.length === 0) {
      return null;
    }

    return {
      platform: this.platform,
      conversationId: this.conversationId,
      url: window.location.href,
      title: document.title.replace(/ [-|] Poe$/i, '').trim() || 'Poe Conversation',
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
            console.error('[LISA] Poe extraction error:', error);
            sendResponse({ success: false, error: error.message });
          });
        return true;
      }
      return true;
    });
  }
}

// Initialize parser
const poeParser = new PoeParser();
poeParser.initializeListener();
chrome.runtime.sendMessage({
  action: 'parserReady',
  platform: 'Poe'
});
