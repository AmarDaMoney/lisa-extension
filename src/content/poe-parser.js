// Poe Conversation Parser
// Extracts conversation data from poe.com
if (typeof PoeParser === 'undefined') {
class PoeParser {
  constructor() {
    this.platform = 'Poe';
    this.conversationId = this.extractConversationId();
  }

  extractConversationId() {
    const match = window.location.pathname.match(/\/chat\/([a-zA-Z0-9]+)/);
    return match ? match[1] : null;
  }

  async scrollToLoadAll() {
    const scroller = document.querySelector('[class*="ChatMessagesScrollWrapper_scrollableContainer"]');
    if (!scroller) return;
    // Incremental scroll to load virtualized messages
    // Poe uses flex-direction: column-reverse, so scrollTop is 0 at bottom
    // and goes negative to scroll up (load older messages)
    const isReversed = getComputedStyle(scroller).flexDirection === 'column-reverse';
    let stableCount = 0;
    let lastHeight = scroller.scrollHeight;
    const step = scroller.clientHeight * 0.8;
    for (let i = 0; i < 50; i++) {
      if (isReversed) {
        scroller.scrollTop = scroller.scrollTop - step;
      } else {
        scroller.scrollTop = Math.max(0, scroller.scrollTop - step);
      }
      scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
      await new Promise(r => setTimeout(r, 400));
      if (scroller.scrollHeight !== lastHeight) {
        stableCount = 0;
        lastHeight = scroller.scrollHeight;
      } else {
        stableCount++;
        const atEnd = isReversed
          ? Math.abs(scroller.scrollTop) >= (scroller.scrollHeight - scroller.clientHeight - 10)
          : scroller.scrollTop <= 0;
        if (stableCount >= 3 && atEnd) break;
      }
    }
    // Scroll back to bottom
    scroller.scrollTop = isReversed ? 0 : scroller.scrollHeight;
    await new Promise(r => setTimeout(r, 500));
  }

  extractMessages() {
    const messages = [];
    const container = document.querySelector('[class*="ChatMessagesScrollWrapper_scrollableContainer"]') || document;

    // Each ChatMessage is one user or assistant message (tuples group pairs)
    const chatMsgs = container.querySelectorAll('[class*="ChatMessage_chatMessage"]');

    for (const msg of chatMsgs) {
      // Detect role: right-side bubble = user, left-side = assistant
      const isUser = !!msg.querySelector('[class*="rightSideMessageBubble"]');

      let textContent = '';
      if (isUser) {
        const textEl = msg.querySelector('[class*="Message_messageTextContainer"]');
        if (textEl) textContent = this.extractTextContent(textEl);
      } else {
        const markdownEl = msg.querySelector('[class*="Markdown_markdownContainer"]');
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
    // Scroll to load virtualized messages
    await this.scrollToLoadAll();
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
} // end PoeParser guard
