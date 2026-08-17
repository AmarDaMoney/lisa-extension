// Meta AI Conversation Parser
// Extracts conversation data from meta.ai
if (typeof MetaAIParser === 'undefined') {
class MetaAIParser {
  constructor() {
    this.platform = 'Meta AI';
    this.conversationId = this.extractConversationId();
  }
  extractConversationId() {
    const match = window.location.pathname.match(/\/prompt\/([a-f0-9-]+)/);
    return match ? match[1] : null;
  }
  async scrollToLoadAll() {
    const scroller = document.querySelector('.overflow-y-auto, [class*="overscroll-y-contain"]');
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
    const userMsgs = document.querySelectorAll('[data-message-type="user"]');
    const asstMsgs = document.querySelectorAll('[data-testid="assistant-message"]');
    // Interleave user/assistant by DOM order using a combined selector
    const allMsgs = document.querySelectorAll('[data-message-type="user"], [data-testid="assistant-message"]');
    for (const msg of allMsgs) {
      const isUser = msg.dataset.messageType === 'user';
      let textContent = '';
      if (isUser) {
        // User text is in span with break-words + text-response (not text-caption "Today" labels)
        const textEl = msg.querySelector('span[class*="break-words"][class*="text-response"]')
                     || msg.querySelector('span.break-words');
        if (textEl) {
          textContent = converter ? converter.extractAsMarkdown(textEl) : textEl.textContent?.trim() || '';
        }
      } else {
        // Assistant text: multiple .markdown-content divs; skip "Show thinking" toggle
        const clone = msg.cloneNode(true);
        clone.querySelectorAll('button, svg, [role="button"]').forEach(el => el.remove());
        const mdEls = clone.querySelectorAll('.markdown-content, [class*="markdown-content"]');
        const parts = [];
        for (const mdEl of mdEls) {
          const text = mdEl.textContent?.trim() || '';
          if (text === 'Show thinking' || text === 'Hide thinking' || text.length === 0) continue;
          parts.push(converter ? converter.extractAsMarkdown(mdEl) : text);
        }
        textContent = parts.join('\n\n');
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
      title: document.title.replace(/ [-|] Meta AI$/i, '').trim() || 'Meta AI Conversation',
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
            console.error('[LISA] Meta AI extraction error:', error);
            sendResponse({ success: false, error: error.message });
          });
        return true;
      }
      return true;
    });
  }
}
const metaAIParser = new MetaAIParser();
metaAIParser.initializeListener();
chrome.runtime.sendMessage({ action: 'parserReady', platform: 'Meta AI' });
} // end MetaAIParser guard
