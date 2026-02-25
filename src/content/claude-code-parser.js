/**
 * LISA Extension - Claude Code Parser
 * Version: 0.48.2
 * 
 * Extracts conversations from Claude Code sessions (claude.ai/code/session_*)
 */

class ClaudeCodeParser {
  constructor() {
    this.platform = "Claude Code";
  }

  extractConversationId() {
    const match = window.location.pathname.match(/\/code\/session_([a-zA-Z0-9]+)/);
    return match ? match[1] : null;
  }

  isUserMessage(container) {
    if (container.classList.contains('bg-bg-200')) return true;
    if (container.querySelector('.bg-bg-200')) return true;
    if (container.classList.contains('text-text-100')) return false;
    return false;
  }

  extractTextContent(element) {
    const clone = element.cloneNode(true);
    clone.querySelectorAll('button, svg, [role="button"]').forEach(el => el.remove());
    return clone.textContent.trim();
  }

  extractMessages() {
    const messages = [];
    const containers = document.querySelectorAll('[class*="group/message"]');
    
    containers.forEach((container, index) => {
      const role = this.isUserMessage(container) ? 'user' : 'assistant';
      
      let paragraphs = container.querySelectorAll('p[node="[object Object]"]');
      if (paragraphs.length === 0) {
        paragraphs = container.querySelectorAll('.space-y-2 p, .space-y-2');
      }
      
      const content = Array.from(paragraphs)
        .map(p => this.extractTextContent(p))
        .filter(t => t.length > 0)
        .join('\n');
      
      if (content) {
        messages.push({ role, content, index, timestamp: new Date().toISOString() });
      }
    });

    return messages;
  }

  extractTaskBlocks() {
    const tasks = [];
    document.querySelectorAll('[class*="group/status"]').forEach((btn, index) => {
      const summary = btn.querySelector('.truncate');
      if (summary) {
        const text = summary.textContent.trim();
        if (text) tasks.push({ type: 'task', summary: text, index });
      }
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
  console.log('[LISA] ClaudeCodeParser initialized');
})();
