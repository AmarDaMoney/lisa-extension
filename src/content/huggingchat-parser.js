// HuggingChat Conversation Parser
// Extracts conversation data from huggingface.co/chat
if (typeof HuggingChatParser === 'undefined') {
class HuggingChatParser {
  constructor() {
    this.platform = 'HuggingChat';
    this.conversationId = this.extractConversationId();
  }
  extractConversationId() {
    const match = window.location.pathname.match(/\/chat\/conversation\/([a-f0-9]+)/);
    return match ? match[1] : null;
  }
  async scrollToLoadAll() {
    const scroller = document.querySelector('.scrollbar-custom');
    if (!scroller) return;
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
    scroller.scrollTop = isReversed ? 0 : scroller.scrollHeight;
    await new Promise(r => setTimeout(r, 500));
  }
  extractMessages() {
    const messages = [];
    const converter = window.__lisaHtmlToMarkdown;
    // User messages use data-message-type, assistant uses data-message-role
    const allMsgs = document.querySelectorAll('[data-message-type="user"], [data-message-role="assistant"]');
    for (const msg of allMsgs) {
      const isUser = msg.dataset.messageType === 'user';
      let textContent = '';
      if (isUser) {
        // User text is typically direct text content
        const textEl = msg.querySelector('.whitespace-pre-wrap, .whitespace-pre-line') || msg;
        textContent = converter ? converter.extractAsMarkdown(textEl) : textEl.textContent?.trim() || '';
      } else {
        // Assistant text is in .prose
        const proseEl = msg.querySelector('.prose');
        if (proseEl) {
          textContent = converter ? converter.extractAsMarkdown(proseEl) : proseEl.textContent?.trim() || '';
        }
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
  async extractConversation() {
    this.conversationId = this.extractConversationId();
    await this.scrollToLoadAll();
    const messages = this.extractMessages();
    if (messages.length === 0) return null;
    return {
      platform: this.platform,
      conversationId: this.conversationId,
      url: window.location.href,
      title: document.title.replace(/ [-|] HuggingChat$/i, '').trim() || 'HuggingChat Conversation',
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
            console.error('[LISA] HuggingChat extraction error:', error);
            sendResponse({ success: false, error: error.message });
          });
        return true;
      }
      return true;
    });
  }
}
const huggingChatParser = new HuggingChatParser();
huggingChatParser.initializeListener();
chrome.runtime.sendMessage({ action: 'parserReady', platform: 'HuggingChat' });
} // end HuggingChatParser guard
