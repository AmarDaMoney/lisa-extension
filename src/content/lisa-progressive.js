// LISA Progressive Capture — v0.50.1
// Buffers messages as they render, solving virtualisation on ChatGPT and others.
// Modes: 'off' | 'auto' | 'on'
//   off  — no observation, standard on-demand capture only
//   auto — observe silently; activate the moment virtualisation is detected
//   on   — always observe and buffer every message as it appears

class LisaProgressiveCapture {
  constructor() {
    this.mode = 'auto';
    this.active = false;
    this.virtualizationDetected = false;
    this.buffer = new Map();   // hash → block
    this.conversationId = null;
    this.observer = null;
    this.saveTimer = null;
    this.init();
  }

  async init() {
    const { progressiveCaptureMode } = await chrome.storage.sync.get('progressiveCaptureMode');
    this.mode = progressiveCaptureMode || 'on';
    this.conversationId = this.getConversationId();

    if (this.mode !== 'off') {
      await this.loadBuffer();
      this.startObserver();
      if (this.mode === 'on') {
        this.active = true;
        this.captureAllVisible();
      }
    }

    this.watchVisibility();
    this.watchNavigation();

    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg.action === 'setProgressiveMode') {
        this.setMode(msg.mode).then(() => sendResponse({ success: true }));
        return true;
      }
      if (msg.action === 'getProgressiveMode') {
        sendResponse({ mode: this.mode, active: this.active, buffered: this.buffer.size });
        return false;
      }
      if (msg.action === 'getProgressiveBuffer') {
        sendResponse({ blocks: Array.from(this.buffer.values()), conversationId: this.conversationId });
        return false;
      }
      if (msg.action === 'clearProgressiveBuffer') {
        this.clearBuffer().then(() => sendResponse({ success: true }));
        return true;
      }
    });
  }

  getConversationId() {
    const host = window.location.hostname;
    const path = window.location.pathname;
    const patterns = [
      [/chatgpt\.com/,             /\/c\/([a-f0-9-]+)/],
      [/claude\.ai/,               /\/chat\/([a-zA-Z0-9-]+)/],
      [/gemini\.google/,           /\/app\/([a-zA-Z0-9-]+)/],
      [/grok\.com/,                /\/c\/([a-zA-Z0-9-]+)/],
      [/chat\.mistral\.ai/,        /\/chat\/([a-zA-Z0-9-]+)/],
      [/chat\.deepseek\.com/,      /\/chat\/([a-zA-Z0-9-]+)/],
      [/perplexity\.ai/,           /\/search\/([a-zA-Z0-9-]+)/],
      [/copilot\.microsoft\.com/,  /\/chat\/([a-zA-Z0-9-]+)/],
    ];
    for (const [hostRe, pathRe] of patterns) {
      if (hostRe.test(host)) {
        const m = path.match(pathRe);
        const platform = host.replace('www.','').split('.')[0];
        return m ? `${platform}-${m[1]}` : `${platform}-${Date.now()}`;
      }
    }
    return `unknown-${Date.now()}`;
  }

  getMessageSelector() {
    const host = window.location.hostname;
    if (host.includes('chatgpt.com'))           return '[data-message-author-role]';
    if (host.includes('claude.ai'))             return '[class*="group/message"]';
    if (host.includes('gemini.google'))         return '.conversation-container';
    if (host.includes('grok.com'))              return '.relative.group.flex.flex-col.justify-center';
    if (host.includes('deepseek.com'))          return '.ds-message';
    if (host.includes('perplexity.ai'))         return 'div[class*="group/query"], div.prose';
    if (host.includes('mistral.ai'))            return '[class*="message"]';
    if (host.includes('copilot.microsoft.com')) return '[class*="user-message"], [class*="ai-message"]';
    return '[data-message-author-role]';
  }

  getRoleFromElement(el) {
    return el.getAttribute('data-message-author-role') ||
           (el.classList.contains('user') ? 'user' : 'assistant');
  }

  simpleHash(str) {
    const s = str.substring(0, 100);
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  captureElement(el) {
    const role = this.getRoleFromElement(el);
    const text = el.textContent.trim();
    if (!text || text.length < 5) return;
    const hash = this.simpleHash(text);
    if (this.buffer.has(hash)) return;
    this.buffer.set(hash, {
      hash,
      role,
      t: role === 'user' ? 'u' : 'a_text',
      v: text,
      capturedAt: new Date().toISOString()
    });
    this.scheduleSave();
  }

  captureAllVisible() {
    const selector = this.getMessageSelector();
    document.querySelectorAll(selector).forEach(el => this.captureElement(el));
  }

  startObserver() {
    const root = document.querySelector('main') || document.body;
    const selector = this.getMessageSelector();

    this.observer = new MutationObserver(mutations => {
      for (const mut of mutations) {
        // Auto-detect virtualisation: platform is unmounting old message nodes
        if (this.mode === 'auto' && !this.virtualizationDetected) {
          for (const node of mut.removedNodes) {
            if (node.nodeType !== Node.ELEMENT_NODE) continue;
            if (node.matches?.(selector) || node.querySelector?.(selector)) {
              this.virtualizationDetected = true;
              this.active = true;
              this.captureAllVisible();
              console.log('[LISA Progressive] Virtualisation detected — buffer active');
            }
          }
        }
        // Capture newly added messages when active
        if (this.active) {
          for (const node of mut.addedNodes) {
            if (node.nodeType !== Node.ELEMENT_NODE) continue;
            if (node.matches?.(selector)) {
              this.captureElement(node);
            } else {
              node.querySelectorAll?.(selector).forEach(el => this.captureElement(el));
            }
          }
        }
      }
    });

    this.observer.observe(root, { childList: true, subtree: true });
  }

  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveBuffer(), 2000);
  }

  async saveBuffer() {
    if (!this.conversationId) return;
    const key = `lisa-progressive-${this.conversationId}`;
    await chrome.storage.local.set({
      [key]: { ts: Date.now(), conversationId: this.conversationId, blocks: Array.from(this.buffer.values()) }
    });
  }

  async loadBuffer() {
    if (!this.conversationId) return;
    const key = `lisa-progressive-${this.conversationId}`;
    try {
      const result = await chrome.storage.local.get(key);
      const stored = result[key];
      if (!stored) return;
      if (Date.now() - stored.ts > 7 * 24 * 60 * 60 * 1000) return; // 7-day TTL
      for (const block of stored.blocks) this.buffer.set(block.hash, block);
    } catch (_) {}
  }

  async clearBuffer() {
    this.buffer.clear();
    if (this.conversationId) {
      await chrome.storage.local.remove(`lisa-progressive-${this.conversationId}`);
    }
  }

  async setMode(mode) {
    this.mode = mode;
    await chrome.storage.sync.set({ progressiveCaptureMode: mode });
    if (mode === 'off') {
      this.observer?.disconnect();
      this.observer = null;
      this.active = false;
    } else {
      if (!this.observer) this.startObserver();
      this.active = (mode === 'on');
      if (mode === 'on') this.captureAllVisible();
    }
  }

  // Called by parsers at export time — prepends buffered (virtualised) messages
  // domBlocks: flat array of blocks currently visible in the DOM
  mergeWithBuffer(domBlocks) {
    if (this.buffer.size === 0) return domBlocks;
    const domHashes = new Set(domBlocks.map(b => this.simpleHash(b.v || b.content || '')));
    const missing = Array.from(this.buffer.values())
      .filter(b => !domHashes.has(b.hash))
      .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
    return missing.length > 0 ? [...missing, ...domBlocks] : domBlocks;
  }

  pause() {
    this.observer?.disconnect();
  }

  resume() {
    if (this.mode === 'off') return;
    const root = document.querySelector('main') || document.body;
    if (this.observer) {
      this.observer.observe(root, { childList: true, subtree: true });
    } else {
      this.startObserver();
    }
    if (this.active) this.captureAllVisible();
  }

  watchVisibility() {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.pause();
      } else {
        this.resume();
      }
    });
  }

  async handleNewConversation() {
    const newId = this.getConversationId();
    if (newId === this.conversationId) return;
    console.log(`[LISA Progressive] New conversation: ${newId}`);
    await this.saveBuffer();
    this.conversationId = newId;
    this.buffer.clear();
    this.virtualizationDetected = false;
    this.active = (this.mode === 'on');
    await this.loadBuffer();
    this.observer?.disconnect();
    this.observer = null;
    if (this.mode !== 'off') {
      this.startObserver();
      if (this.mode === 'on') this.captureAllVisible();
    }
  }

  watchNavigation() {
    const origPush    = history.pushState.bind(history);
    const origReplace = history.replaceState.bind(history);
    history.pushState    = (...args) => { origPush(...args);    setTimeout(() => this.handleNewConversation(), 150); };
    history.replaceState = (...args) => { origReplace(...args); setTimeout(() => this.handleNewConversation(), 150); };
    window.addEventListener('popstate', () => setTimeout(() => this.handleNewConversation(), 150));
  }
}

window.lisaProgressive = new LisaProgressiveCapture();
