// GitHub Copilot Conversation Parser
// Extracts conversation data from github.com/copilot

class GitHubCopilotParser {
  constructor() {
    this.platform = 'GitHub Copilot';
    this.conversationId = this.extractConversationId();
  }

  extractConversationId() {
    // Copilot chat lives at github.com/copilot; thread IDs may appear as
    // query params (?thread=<id>) or hash fragments, or not at all.
    const params = new URLSearchParams(window.location.search);
    const threadId = params.get('thread') || params.get('conversation') || params.get('id');
    if (threadId) return threadId;

    const hashMatch = window.location.hash.match(/[a-f0-9-]{8,}/);
    if (hashMatch) return hashMatch[0];

    // Fall back to a stable session key: reuse whatever was stored for this
    // page load so that re-injections don't produce a new id each time.
    const SESSION_KEY = 'lisa_gh_copilot_session_id';
    let sessionId = sessionStorage.getItem(SESSION_KEY);
    if (!sessionId) {
      sessionId = 'gh-copilot-' + Date.now();
      sessionStorage.setItem(SESSION_KEY, sessionId);
    }
    return sessionId;
  }

  extractMessages() {
    const messages = [];

    // GitHub Copilot uses React + Primer design system.
    // Try selectors from most-specific to most-generic so we stop as soon as
    // we get a meaningful match.

    let messageElements = null;

    // Strategy 1: data-testid attributes (GitHub's preferred stable hook)
    const byTestId = document.querySelectorAll(
      '[data-testid="thread-message"], [data-testid*="copilot-message"], [data-testid*="chat-message"]'
    );
    if (byTestId.length > 0) {
      messageElements = byTestId;
    }

    // Strategy 2: data-component (Primer component attribute)
    if (!messageElements || messageElements.length === 0) {
      const byComponent = document.querySelectorAll(
        '[data-component="ThreadMessage"], [data-component*="Message"], [data-component*="ChatBubble"]'
      );
      if (byComponent.length > 0) messageElements = byComponent;
    }

    // Strategy 3: aria-role-based — GitHub often marks chat turns with role="article"
    if (!messageElements || messageElements.length === 0) {
      const byArticle = document.querySelectorAll('article[data-message-id], article[data-role]');
      if (byArticle.length > 0) messageElements = byArticle;
    }

    // Strategy 4: data-message-role (matches pattern used by ChatGPT; GitHub may adopt it)
    if (!messageElements || messageElements.length === 0) {
      const byRole = document.querySelectorAll('[data-message-role], [data-author-role]');
      if (byRole.length > 0) messageElements = byRole;
    }

    // Strategy 5: class-name heuristics for the Copilot chat UI
    if (!messageElements || messageElements.length === 0) {
      const byClass = document.querySelectorAll(
        '[class*="CopilotChat"], [class*="copilot-chat"], [class*="ThreadMessage"], [class*="chatMessage"]'
      );
      if (byClass.length > 0) messageElements = byClass;
    }

    // Strategy 6: broadest fallback — any element that looks like a chat turn
    if (!messageElements || messageElements.length === 0) {
      messageElements = document.querySelectorAll('[class*="message"], [class*="Message"]');
    }

    if (!messageElements || messageElements.length === 0) return messages;

    messageElements.forEach((element, index) => {
      const role = this.detectRole(element);
      const textContent = this.extractTextContent(element);

      if (textContent && textContent.trim().length > 0) {
        messages.push({
          role: role,
          content: textContent.trim(),
          index: index,
          timestamp: new Date().toISOString()
        });
      }
    });

    return messages;
  }

  detectRole(element) {
    // Explicit data attributes take priority
    const explicit =
      element.getAttribute('data-message-role') ||
      element.getAttribute('data-author-role') ||
      element.getAttribute('data-role') ||
      element.getAttribute('data-actor-type');

    if (explicit) {
      return explicit === 'user' ? 'user' : 'assistant';
    }

    // Safely get className string (guards against SVGAnimatedString)
    const classStr =
      typeof element.className === 'string'
        ? element.className
        : element.className?.baseVal || '';

    // Look for "user" signals in class names or child elements
    if (
      classStr.includes('user') ||
      classStr.includes('human') ||
      element.querySelector('[data-actor-type="user"], [data-role="user"], [data-message-role="user"]') !== null
    ) {
      return 'user';
    }

    // Avatar / label heuristic: if a visible name like "You" or the GitHub username
    // appears in a header child, treat as user turn
    const header = element.querySelector('[class*="author"], [class*="Actor"], [class*="sender"]');
    if (header) {
      const headerText = header.textContent.trim().toLowerCase();
      if (headerText === 'you' || headerText === 'user') return 'user';
      if (headerText.includes('copilot') || headerText.includes('github copilot')) return 'assistant';
    }

    return 'assistant';
  }

  extractTextContent(element) {
    const clone = element.cloneNode(true);

    // Remove non-content UI chrome: buttons, icons, copy-code overlays, feedback widgets
    clone
      .querySelectorAll('button, svg, [role="button"], [class*="icon"], [class*="Icon"], [class*="feedback"], [class*="Feedback"], [class*="toolbar"], [aria-hidden="true"]')
      .forEach(el => el.remove());

    // Prefer a markdown/prose container if present
    const prose =
      clone.querySelector('[class*="markdown"], [class*="Markdown"], [class*="prose"]');
    if (prose) return prose.textContent || prose.innerText || '';

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
          console.error('[LISA] GitHub Copilot extraction error:', error);
          sendResponse({ success: false, error: error.message });
        }
      }
      return true;
    });
  }
}

// Initialize parser
const parser = new GitHubCopilotParser();
parser.initializeListener();

chrome.runtime.sendMessage({
  action: 'parserReady',
  platform: 'GitHub Copilot'
});
