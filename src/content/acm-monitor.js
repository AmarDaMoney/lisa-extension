// LISA ACM — Active Context Management: Monitor Layer
// Phase 1: Message counting, token estimation, context health indicator
// Hooks into the same MutationObserver infrastructure as lisa-progressive.js
// ~80 lines. Zero new dependencies.

const ACMMonitor = {
  // State
  messageCount: 0,
  tokenEstimate: 0,
  conversationId: null,
  _lastUrl: null,

  // Thresholds (configurable via chrome.storage.sync)
  thresholds: {
    green: 40,    // 0 to green: healthy
    yellow: 80,   // green to yellow: building context pressure
    red: 120,     // yellow to red: recommend refresh
    critical: 160 // red+: context degrading
  },

  async init() {
    // Load any saved thresholds
    try {
      const stored = await chrome.storage.sync.get(['acmThresholds', 'acmEnabled']);
      if (stored.acmThresholds) {
        Object.assign(this.thresholds, stored.acmThresholds);
      }
      // ACM is on by default — user can disable
      if (stored.acmEnabled === false) return;
    } catch (_) {}

    this.conversationId = this._getConversationId();
    this._lastUrl = window.location.href;

    // Load persisted state for this conversation
    await this._loadState();

    // Hook into existing MutationObserver via lisa-progressive's events
    // OR set up our own lightweight observer if progressive isn't active
    this._startObserving();

    // Watch for conversation switches (SPA navigation)
    this._watchNavigation();

    // Listen for status queries from floating button
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg.action === 'acm_getMonitorStatus') {
        sendResponse(this.getStatus());
        return false;
      }
      if (msg.action === 'acm_resetMonitor') {
        this.messageCount = 0;
        this.tokenEstimate = 0;
        this._saveState();
        this._updateDot();
        sendResponse({ success: true });
        return false;
      }
    });

    // Expose for floating button (same content script context)
    window.__lisaACM = this;

    console.debug('[LISA ACM] Monitor initialized — conversation:', this.conversationId);
  },

  _getConversationId() {
    // Reuse lisa-progressive's logic if available
    if (window.lisaProgressive) {
      return window.lisaProgressive.conversationId;
    }
    // Fallback — extract from URL
    const host = window.location.hostname;
    const path = window.location.pathname;
    const patterns = [
      [/chatgpt\.com/,            /\/c\/([a-f0-9-]+)/],
      [/claude\.ai/,              /\/chat\/([a-zA-Z0-9-]+)/],
      [/gemini\.google/,          /\/app\/([a-zA-Z0-9-]+)/],
      [/grok\.com/,               /\/c\/([a-zA-Z0-9-]+)/],
      [/chat\.mistral\.ai/,       /\/chat\/([a-zA-Z0-9-]+)/],
      [/chat\.deepseek\.com/,     /\/chat\/([a-zA-Z0-9-]+)/],
      [/perplexity\.ai/,          /\/search\/([a-zA-Z0-9-]+)/],
      [/poe\.com/,                /\/chat\/([a-zA-Z0-9]+)/],
      [/huggingface\.co/,         /\/chat\/conversation\/([a-f0-9]+)/],
      [/meta\.ai/,                /\/prompt\/([a-f0-9-]+)/],
      [/copilot\.microsoft\.com/, /\/chat\/([a-zA-Z0-9-]+)/],
    ];
    for (const [hostRe, pathRe] of patterns) {
      if (hostRe.test(host)) {
        const m = path.match(pathRe);
        const platform = host.replace('www.', '').split('.')[0];
        return m ? `${platform}-${m[1]}` : `${platform}-${Date.now()}`;
      }
    }
    return `unknown-${Date.now()}`;
  },

  _getMessageSelector() {
    // Reuse lisa-progressive's selector logic if available
    if (window.lisaProgressive && typeof window.lisaProgressive.getMessageSelector === 'function') {
      return window.lisaProgressive.getMessageSelector();
    }
    // Fallback — same selectors as lisa-progressive.js
    const host = window.location.hostname;
    if (host.includes('chatgpt.com'))           return '[data-message-author-role]';
    if (host.includes('claude.ai') && window.location.pathname.startsWith('/code/')) return '[data-epitaxy-entry]';
    if (host.includes('claude.ai'))             return '[data-is-streaming], [data-user-message-bubble]';
    if (host.includes('gemini.google'))         return '.conversation-container';
    if (host.includes('grok.com'))              return '.relative.group.flex.flex-col.justify-center';
    if (host.includes('deepseek.com'))          return '.ds-message';
    if (host.includes('perplexity.ai'))         return 'span[class*="whitespace-pre-line"], div.prose';
    if (host.includes('poe.com'))               return '[class*="ChatMessagesView_messageTuple"]';
    if (host.includes('huggingface.co'))        return '[data-message-type], [data-message-role]';
    if (host.includes('meta.ai'))               return '[data-message-type], [data-testid="assistant-message"]';
    if (host.includes('mistral.ai'))            return '[class*="message"]';
    if (host.includes('copilot.microsoft.com')) return '[class*="user-message"], [class*="ai-message"]';
    return '[data-message-author-role]';
  },

  _startObserving() {
    // Count existing visible messages on page load
    const selector = this._getMessageSelector();
    const existing = document.querySelectorAll(selector);
    if (existing.length > 0 && this.messageCount === 0) {
      // Page loaded with existing messages — count them
      this.messageCount = existing.length;
      let charTotal = 0;
      existing.forEach(el => { charTotal += (el.textContent || '').length; });
      this.tokenEstimate = Math.round(charTotal / 3.5);
      this._saveState();
    }

    // Set up our own lightweight observer — we only count, no heavy capture
    const root = document.querySelector('main') || document.body;
    const seenNodes = new WeakSet();

    this._observer = new MutationObserver(mutations => {
      let newMessages = 0;
      let newChars = 0;

      for (const mut of mutations) {
        for (const node of mut.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          if (seenNodes.has(node)) continue;

          const matches = [];
          if (node.matches?.(selector)) matches.push(node);
          else node.querySelectorAll?.(selector).forEach(el => matches.push(el));

          for (const el of matches) {
            if (seenNodes.has(el)) continue;
            seenNodes.add(el);
            newMessages++;
            newChars += (el.textContent || '').length;
          }
        }
      }

      if (newMessages > 0) {
        this.messageCount += newMessages;
        this.tokenEstimate += Math.round(newChars / 3.5);
        this._updateDot();
        this._saveState();

        // Notify service worker at checkpoint intervals (every 10 messages)
        if (this.messageCount % 10 === 0 && this.messageCount >= 20) {
          chrome.runtime.sendMessage({
            action: 'acm_checkpoint',
            conversationId: this.conversationId,
            messageCount: this.messageCount,
            tokenEstimate: this.tokenEstimate,
            healthLevel: this.getHealthLevel()
          }).catch(() => {}); // service worker may not handle this yet in Phase 1
        }
      }
    });

    this._observer.observe(root, { childList: true, subtree: true });
  },

  _watchNavigation() {
    // Listen for lisa-progressive's conversation-changed event
    document.addEventListener('lisa-conversation-changed', (e) => {
      this._handleConversationSwitch(e.detail?.newId);
    });

    // Fallback: poll URL for changes (SPA platforms that don't trigger events)
    setInterval(() => {
      if (window.location.href !== this._lastUrl) {
        this._lastUrl = window.location.href;
        const newId = this._getConversationId();
        if (newId !== this.conversationId) {
          this._handleConversationSwitch(newId);
        }
      }
    }, 2000);
  },

  async _handleConversationSwitch(newId) {
    // Save current state before switching
    await this._saveState();

    // Reset for new conversation
    this.conversationId = newId || this._getConversationId();
    this.messageCount = 0;
    this.tokenEstimate = 0;

    // Load any existing state for this conversation
    await this._loadState();
    this._updateDot();

    console.debug('[LISA ACM] Switched to conversation:', this.conversationId);
  },

  // Persistence — lightweight, per-conversation
  async _saveState() {
    if (!this.conversationId) return;
    try {
      const key = `lisa-acm-${this.conversationId}`;
      await chrome.storage.local.set({
        [key]: {
          messageCount: this.messageCount,
          tokenEstimate: this.tokenEstimate,
          conversationId: this.conversationId,
          updatedAt: Date.now()
        }
      });
    } catch (_) {}
  },

  async _loadState() {
    if (!this.conversationId) return;
    try {
      const key = `lisa-acm-${this.conversationId}`;
      const result = await chrome.storage.local.get(key);
      const stored = result[key];
      if (!stored) return;
      // Only restore if data is less than 24 hours old
      if (Date.now() - stored.updatedAt > 24 * 60 * 60 * 1000) return;
      this.messageCount = stored.messageCount || 0;
      this.tokenEstimate = stored.tokenEstimate || 0;
    } catch (_) {}
  },

  // Health computation
  getHealthLevel() {
    const mc = this.messageCount;
    if (mc < this.thresholds.green) return 'green';
    if (mc < this.thresholds.yellow) return 'yellow';
    if (mc < this.thresholds.red) return 'red';
    return 'critical';
  },

  getHealthScore() {
    // 0-100 score: 100 = fresh, 0 = severely degraded
    const mc = this.messageCount;
    if (mc <= 0) return 100;
    if (mc >= this.thresholds.critical) return Math.max(0, 100 - mc);
    // Linear decay from 100 to 10 across the threshold range
    const ratio = mc / this.thresholds.critical;
    return Math.round(100 - (ratio * 90));
  },

  getStatus() {
    return {
      messageCount: this.messageCount,
      tokenEstimate: this.tokenEstimate,
      healthLevel: this.getHealthLevel(),
      healthScore: this.getHealthScore(),
      conversationId: this.conversationId,
      thresholds: this.thresholds
    };
  },

  // DOM update — sets the color dot on the floating button
  _updateDot() {
    const dot = document.querySelector('.lisa-acm-dot');
    if (!dot) return;

    const level = this.getHealthLevel();
    const colors = {
      green: '#4ade80',
      yellow: '#facc15',
      red: '#f87171',
      critical: '#ef4444'
    };
    dot.style.background = colors[level] || colors.green;

    // Pulse animation for red/critical
    if (level === 'red' || level === 'critical') {
      dot.style.animation = 'lisa-acm-pulse 2s ease-in-out infinite';
    } else {
      dot.style.animation = 'none';
    }

    // Update tooltip
    dot.title = `Context: ${this.messageCount} msgs (~${this.tokenEstimate.toLocaleString()} tokens)`;
  }
};

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => ACMMonitor.init());
} else {
  ACMMonitor.init();
}
