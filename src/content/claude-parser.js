// Claude.ai Conversation Parser
// Extracts conversation data from Claude web interface

if (typeof ClaudeParser !== 'undefined') {
  // Already loaded — skip re-declaration
} else {

class ClaudeParser {
  constructor() {
    this.platform = 'Claude';
    this.conversationId = this.extractConversationId();
  }

  extractConversationId() {
    // Extract from URL: https://claude.ai/chat/uuid
    const match = window.location.pathname.match(/\/chat\/([a-f0-9-]+)/);
    return match ? match[1] : null;
  }

  extractMessages() {
    const messages = [];
    const seen = new Set();

    // Claude uses specific DOM structure for messages
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
    // Clone element to avoid modifying DOM
    const clone = element.cloneNode(true);
    
    // Remove button elements, icons, and UI components
    clone.querySelectorAll('button, svg, [role="button"], .sr-only, [class*="opacity-0"]').forEach(el => el.remove());
    
    // Get text content and strip Claude UI noise
    let text = clone.textContent || clone.innerText || '';
    text = text.replace(/^Vous avez dit\s*:?\s*/i, '');
    text = text.replace(/^You said\s*:?\s*/i, '');
    text = text.replace(/^Claude a répondu\s*:?\s*/i, '');
    text = text.replace(/^Claude replied\s*:?\s*/i, '');
    text = text.replace(/^Afficher moins\s*/i, '');
    text = text.replace(/^Show less\s*/i, '');
    text = text.replace(/\n\d{1,2}:\d{2}\s*(AM|PM)\s*$/i, '');
    // Collapse consecutive duplicate lines (UI labels can render twice)
    text = text.split('\n').filter((ln, i, a) => i === 0 || ln.trim() === '' || ln.trim() !== a[i-1].trim()).join('\n');
    return text.trim();
  }

  async extractConversation() {
    // ---- API-FIRST CAPTURE (instant, complete, structured) ----
    // Retries once after a short delay before accepting DOM fallback — a
    // one-shot attempt here silently downgraded otherwise-healthy API
    // captures to DOM quality on any transient hiccup (a slow org-id
    // lookup, a momentary network blip), with no visible sign to the user
    // that anything degraded. lisa-floating-button.js's capture path
    // already retries for exactly this reason; this brings the popup's
    // path — used by the Compress button and Save to Library — up to the
    // same reliability instead of being the more fragile of the two.
    if (window.__LISA_CLAUDE_API_CAPTURE) {
      const isShared = window.location.pathname.startsWith('/share/');
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const apiResult = isShared
            ? await window.__LISA_CLAUDE_API_CAPTURE.extractSharedViaAPI()
            : await window.__LISA_CLAUDE_API_CAPTURE.extractViaAPI();
          if (apiResult && apiResult.messages && apiResult.messages.length > 0) {
            console.log('[LISA] API capture success:', apiResult.messageCount, 'messages');
            return apiResult;
          }
        } catch (e) {
          console.warn('[LISA] API capture attempt', attempt + 1, 'failed:', e.message);
        }
        if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 500));
      }
      console.warn('[LISA] API capture failed after retry, falling back to DOM');
    }

    // ---- DOM FALLBACK (existing logic, unchanged) ----
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
      messages: messages,
      _captureMethod: 'dom'
    };
  }

  // Listen for extraction requests from popup
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
            console.error('[LISA] Claude extraction error:', error);
            sendResponse({ success: false, error: error.message });
          });
        return true;
      }
      return false; // not ours — let other listeners answer, or the sender fail fast
    });
  }
}

// Initialize parser when script loads
const parser = new ClaudeParser();
parser.initializeListener();

// Signal that parser is ready
chrome.runtime.sendMessage({ 
  action: 'parserReady', 
  platform: 'Claude' 
});

} // end guard
