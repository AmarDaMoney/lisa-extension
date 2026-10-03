// Microsoft Copilot Conversation Parser
// Extracts conversation data from copilot.com (formerly copilot.microsoft.com)

// ── Shared Copilot turn finder ──
// Used by CopilotParser below and LisaVParser.extractCopilotMessages() so
// the two can't drift. copilot.com (2026 redesign) marks turns with
// data-testid="chatQuestion" (user) / "chatOutput" (assistant), text in
// .fai-UserMessage__message / .fai-CopilotMessage__content — confirmed
// live. The old copilot.microsoft.com classes (user-message / ai-message)
// stay as a fallback. Returns [{ role, el }] in page order, where el is a
// cleaned CLONE of just the message text (screen-reader "You said" /
// "Copilot said" headings, buttons, avatar, name, disclaimer removed).
function lisaCopilotTurns() {
  const NEW = '[data-testid="chatQuestion"], [data-testid="chatOutput"]';
  const OLD = '[class*="user-message"], [class*="ai-message"]';
  let nodes = [...document.querySelectorAll(NEW)];
  const isNew = nodes.length > 0;
  if (!isNew) nodes = [...document.querySelectorAll(OLD)];
  // Keep outermost matches only — a turn can contain a nested match.
  nodes = nodes.filter(n => !nodes.some(o => o !== n && o.contains(n)));
  return nodes.map(n => {
    const role = isNew
      ? (n.getAttribute('data-testid') === 'chatQuestion' ? 'user' : 'assistant')
      : (String(n.className).includes('user-message') ? 'user' : 'assistant');
    const body = isNew
      ? (n.querySelector(role === 'user' ? '[class*="UserMessage__message"]' : '[class*="CopilotMessage__content"]') || n)
      : n;
    const el = body.cloneNode(true);
    el.querySelectorAll('h5, h6, [class*="accessibleHeading"], [class*="actionBar"], [class*="__actions"], [role="toolbar"], ' +
      '[class*="disclaimer"], [class*="__avatar"], [class*="__name"], [class*="FeedbackButtons"], button, svg, [role="button"]')
      .forEach(x => x.remove());
    return { role, el };
  });
}
window.__lisaCopilotTurns = lisaCopilotTurns;

class CopilotParser {
  constructor() {
    this.platform = 'Microsoft Copilot';
    this.conversationId = this.extractConversationId();
  }

  extractConversationId() {
    // Copilot may use session or conversation IDs
    const match = window.location.pathname.match(/\/chat\/(?:conversation\/)?([a-zA-Z0-9-]+)/);
    return match ? match[1] : 'copilot-session';
  }

  extractMessages() {
    const messages = [];
    
    const allMessages = lisaCopilotTurns();

    // Deduplicate identical consecutive content
    const seen = new Set();
    for (const msg of allMessages) {
      const text = (msg.el.textContent || '').trim();
      if (!text) continue;
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
            console.error('[LISA] Copilot extraction error:', error);
            sendResponse({ success: false, error: error.message });
          });
        return true;
      }
      return false; // not ours — let other listeners answer, or the sender fail fast
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
