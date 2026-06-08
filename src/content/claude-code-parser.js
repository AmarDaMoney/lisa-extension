/**
 * LISA Extension - Claude Code Parser
 * Version: 0.50.2
 * 
 * Extracts conversations from Claude Code sessions (claude.ai/code/session_*)
 * Updated for epitaxy-based virtual transcript UI
 */

class ClaudeCodeParser {
  constructor() {
    this.platform = "Claude Code";
  }

  extractConversationId() {
    const match = window.location.pathname.match(/\/code\/session_([a-zA-Z0-9]+)/);
    return match ? match[1] : null;
  }

  isUserMessage(entry) {
    return !!entry.querySelector('.epitaxy-user-turn');
  }

  extractTextContent(element) {
    const clone = element.cloneNode(true);
    clone.querySelectorAll('button, svg, [role="button"], [aria-hidden="true"]').forEach(el => el.remove());
    return clone.textContent.trim();
  }

  extractMessages() {
    const messages = [];
    const entries = document.querySelectorAll('[data-epitaxy-entry]');
    
    entries.forEach((entry, index) => {
      if (this.isUserMessage(entry)) {
        // User message — text in p.text-body elements inside epitaxy-user-turn
        const userTurn = entry.querySelector('.epitaxy-user-turn');
        if (!userTurn) return;
        const paragraphs = userTurn.querySelectorAll('p.text-body, p[class*="whitespace-pre-wrap"]');
        const content = Array.from(paragraphs)
          .map(p => p.textContent.trim())
          .filter(t => t.length > 0)
          .join('\n');
        if (content) {
          messages.push({ role: 'user', content, index, timestamp: new Date().toISOString() });
        }
      } else {
        // Assistant message — text in .epitaxy-markdown elements
        const markdownBlocks = entry.querySelectorAll('.epitaxy-markdown');
        if (markdownBlocks.length === 0) return;
        const content = Array.from(markdownBlocks)
          .map(block => this.extractTextContent(block))
          .filter(t => t.length > 0)
          .join('\n\n');
        if (content) {
          messages.push({ role: 'assistant', content, index, timestamp: new Date().toISOString() });
        }
      }
    });

    return messages;
  }

  extractTaskBlocks() {
    const tasks = [];
    // Tool use blocks — buttons with collapsed tool info
    document.querySelectorAll('[class*="group/tool"]').forEach((btn, index) => {
      const text = btn.textContent.trim();
      if (text) tasks.push({ type: 'task', summary: text.substring(0, 200), index });
    });
    return tasks;
  }

  extractConversation() {
    const messages = this.extractMessages();
    const tasks = this.extractTaskBlocks();

    if (messages.length === 0) return null;

    const rawResult = {
      platform: this.platform,
      conversationId: this.extractConversationId(),
      url: window.location.href,
      title: document.title.replace(/ - Claude$/, '').replace(/ _ Claude Code$/, ''),
      extractedAt: new Date().toISOString(),
      messageCount: messages.length,
      messages,
      tasks
    };
    
    return (typeof SemanticAnalyzer !== 'undefined') ? SemanticAnalyzer.analyze(rawResult) : rawResult;
  }

  initializeListener() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'ping') {
        sendResponse({ success: true, platform: this.platform });
      } else if (request.action === 'extractConversation') {
        const data = this.extractConversation();
        sendResponse({ success: !!data, data });
      }
      return true;
    });
  }
}

(function() {
  if (!window.location.href.includes('claude.ai/code/')) return;
  const parser = new ClaudeCodeParser();
  parser.initializeListener();
  chrome.runtime.sendMessage({ action: 'parserReady', platform: 'Claude Code' }).catch(() => {});
  console.debug('[LISA] ClaudeCodeParser initialized (epitaxy v2)');
})();
