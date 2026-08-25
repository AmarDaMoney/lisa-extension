// Claude Code Session Parser
// Lightweight variant of claude-parser.js for claude.ai/code/* pages
// Extracts title from h1 (page title is just "Claude Code")

if (typeof ClaudeCodeParser !== 'undefined') {
  // Already loaded — skip re-declaration
} else {

class ClaudeCodeParser {
  constructor() {
    this.platform = 'Claude Code';
    this.conversationId = this.extractConversationId();
  }

  extractConversationId() {
    // URL: https://claude.ai/code/session_XXXX
    const match = window.location.pathname.match(/\/code\/(session_[a-zA-Z0-9]+)/);
    return match ? match[1] : null;
  }

  extractTitle() {
    // Claude Code pages show session title in h1
    const h1 = document.querySelector('h1');
    if (h1 && h1.textContent.trim().length > 0) {
      return h1.textContent.trim();
    }
    // Fallback: first user message snippet
    const firstMsg = document.querySelector('[data-test-render-count]');
    if (firstMsg) {
      const text = firstMsg.textContent.trim().slice(0, 80);
      if (text) return text + (firstMsg.textContent.trim().length > 80 ? '…' : '');
    }
    return 'Claude Code Session';
  }

  extractMessages() {
    const messages = [];
    const seen = new Set();

    const messageElements = document.querySelectorAll('[data-test-render-count]');

    messageElements.forEach((element, index) => {
      const hasStreaming = element.querySelector('[data-is-streaming]') !== null;
      const hasUserBg = element.querySelector('.bg-bg-300') !== null;
      const hasRightAlign = element.querySelector("[class*='justify-end']") !== null ||
                            element.querySelector("[class*='items-end']") !== null;
      const isUser = !hasStreaming && (hasUserBg || hasRightAlign);

      const textContent = this.extractTextContent(element);

      if (textContent && textContent.trim().length > 0) {
        const key = textContent.trim().substring(0, 80);
        if (!seen.has(key)) {
          seen.add(key);
          messages.push({
            role: isUser ? 'user' : 'assistant',
            content: textContent.trim(),
            index: index,
            timestamp: new Date().toISOString()
          });
        }
      }
    });

    return messages;
  }

  extractTextContent(element) {
    const clone = element.cloneNode(true);
    clone.querySelectorAll('button, svg, [role="button"], .sr-only, [class*="opacity-0"]').forEach(el => el.remove());
    let text = clone.textContent || clone.innerText || '';
    text = text.replace(/^Vous avez dit\s*:?\s*/i, '');
    text = text.replace(/^You said\s*:?\s*/i, '');
    text = text.replace(/^Claude a répondu\s*:?\s*/i, '');
    text = text.replace(/^Claude replied\s*:?\s*/i, '');
    text = text.replace(/^Afficher moins\s*/i, '');
    text = text.replace(/^Show less\s*/i, '');
    text = text.replace(/\n\d{1,2}:\d{2}\s*(AM|PM)\s*$/i, '');
    text = text.split('\n').filter((ln, i, a) => i === 0 || ln.trim() === '' || ln.trim() !== a[i-1].trim()).join('\n');
    return text.trim();
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
      title: this.extractTitle(),
      extractedAt: new Date().toISOString(),
      messageCount: messages.length,
      messages: messages,
      _captureMethod: 'dom'
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
            console.error('[LISA] Claude Code extraction error:', error);
            sendResponse({ success: false, error: error.message });
          });
        return true;
      }
      return true;
    });
  }
}

const claudeCodeParser = new ClaudeCodeParser();
claudeCodeParser.initializeListener();

chrome.runtime.sendMessage({
  action: 'parserReady',
  platform: 'Claude Code'
});

} // end guard
