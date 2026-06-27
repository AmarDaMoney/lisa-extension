// LISA Progressive Capture — v0.51.3
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
    window.__lisaProgressive = this;
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

    // Signal that progressive init is complete and buffer is populated
    document.dispatchEvent(new CustomEvent('lisa-progressive-ready', {
      detail: { bufferSize: this.buffer.size, mode: this.mode }
    }));

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
      if (msg.action === 'injectFileAttachment') {
        this.injectFiles(msg).then(r => sendResponse(r)).catch(e => sendResponse({ success: false, error: e.message }));
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
    if (host.includes('claude.ai') && window.location.pathname.startsWith('/code/')) return '[data-epitaxy-entry]';
    if (host.includes('claude.ai'))             return '[data-is-streaming], [data-user-message-bubble]';
    if (host.includes('gemini.google'))         return '.conversation-container';
    if (host.includes('grok.com'))              return '.relative.group.flex.flex-col.justify-center';
    if (host.includes('deepseek.com'))          return '.ds-message';
    if (host.includes('perplexity.ai'))         return 'div[class*="group/query"], div.prose';
    if (host.includes('mistral.ai'))            return '[class*="message"]';
    if (host.includes('copilot.microsoft.com')) return '[class*="user-message"], [class*="ai-message"]';
    return '[data-message-author-role]';
  }

  getRoleFromElement(el) {
    if (el.getAttribute('data-message-author-role')) return el.getAttribute('data-message-author-role');
    if (el.hasAttribute('data-user-message-bubble')) return 'user';
    if (el.classList.contains('user')) return 'user';
    return 'assistant';
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
    // Clone and strip UI noise before extracting text (mirrors claude-parser.js fix)
    const clone = el.cloneNode(true);
    clone.querySelectorAll('button, svg, [role="button"], .sr-only, [class*="opacity-0"]').forEach(n => n.remove());
    const text = clone.textContent.trim();
    if (!text || text.length < 5) return;
    // Filter out file-attachment widget noise
    if (text.includes('[object Object]')) return;
    const hash = this.simpleHash(text);
    if (this.buffer.has(hash)) return;
    if (!this._captureSeq) this._captureSeq = 0;
    this._captureSeq++;
    this.buffer.set(hash, {
      hash,
      role,
      t: role === 'user' ? 'u' : 'a_text',
      v: text,
      seq: this._captureSeq,
      capturedAt: new Date().toISOString()
    });
    this.scheduleSave();
    // Notify CPE (lisa-phoenix.js) of new capture
    document.dispatchEvent(new CustomEvent('lisa-message-captured', {
      detail: { role, textLength: text.length, bufferSize: this.buffer.size }
    }));
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
    // Hash domBlocks using same first-100-char hash as captureElement
    const domHashes = new Set(domBlocks.map(b => {
      const text = (b.v || b.content || '').trim();
      return this.simpleHash(text);
    }));
    // Also hash with stripped text to catch UI-noise differences
    domBlocks.forEach(b => {
      const text = (b.v || b.content || '').replace(/\s+/g, ' ').trim();
      domHashes.add(this.simpleHash(text));
    });
    const missing = Array.from(this.buffer.values())
      .filter(b => !domHashes.has(b.hash))
      .sort((a, b) => (a.seq || 0) - (b.seq || 0));
    return missing.length > 0 ? [...missing, ...domBlocks] : domBlocks;
  }

  // Sweep scroll top→bottom, capturing messages at each step
  // Stops when buffer count stabilises (no new messages in 2 consecutive steps)
  async performScrollSweep(scroller, stepDelay = 600) {
    if (!scroller) return;

    // Abort any previously running sweep
    if (this._sweepAbort) {
      this._sweepAbort.aborted = true;
      console.debug('[LISA Sweep] aborted previous sweep');
    }
    const abort = this._sweepAbort = { aborted: false };

    const scrollTo = (top) => {
      scroller.scrollTo({ top, behavior: 'instant' });
      scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
    };

    const sel = this.getMessageSelector();
    const domCount = () => document.querySelectorAll(sel).length;

    // Clear stale buffer — sweep only runs when buffer isn't useful (!bufferReady),
    // so existing entries are just the last few visible messages from page load.
    // Keeping them causes wrong ordering (low seq but chronologically last).
    this.buffer.clear();
    this._captureSeq = 0;

    // Start at top, double capture (let virtualizer settle, then grab)
    scrollTo(0);
    await new Promise(r => setTimeout(r, stepDelay));
    this.captureAllVisible();
    await new Promise(r => setTimeout(r, 250));
    this.captureAllVisible();
    console.debug('[LISA Sweep] start — buffer:', this.buffer.size,
                'dom:', domCount(), 'scrollH:', scroller.scrollHeight,
                'clientH:', scroller.clientHeight);

    // Half-viewport step = more overlap, fewer messages skipped between mount/unmount
    const step = Math.max(Math.floor(scroller.clientHeight / 2), 250);

    let lastBufferSize = this.buffer.size;
    let stableRounds = 0;
    let sweepStep = 0;

    while (stableRounds < 4) {
      if (abort.aborted) { console.debug('[LISA Sweep] aborted at step', sweepStep); break; }
      sweepStep++;
      scrollTo(scroller.scrollTop + step);

      // Double capture: once after virtualizer mounts, once after it settles
      await new Promise(r => setTimeout(r, stepDelay));
      this.captureAllVisible();
      await new Promise(r => setTimeout(r, 250));
      this.captureAllVisible();

      const dom = domCount();
      const atBottom = scroller.scrollTop >=
                       scroller.scrollHeight - scroller.clientHeight - 10;

      console.debug('[LISA Sweep] step', sweepStep,
                  '— scrollTop:', scroller.scrollTop,
                  'dom:', dom, 'buffer:', this.buffer.size,
                  'atBottom:', atBottom, 'stable:', stableRounds);

      if (atBottom) {
        await new Promise(r => setTimeout(r, stepDelay));
        this.captureAllVisible();
        console.debug('[LISA Sweep] hit bottom at step', sweepStep,
                    '— final buffer:', this.buffer.size);
        break;
      }

      // Only count stable rounds after scrolling past 80% — avoids premature
      // bail when buffer already has pre-captured messages from live observation
      const scrollProgress = scroller.scrollTop / (scroller.scrollHeight - scroller.clientHeight);
      if (this.buffer.size > lastBufferSize) {
        stableRounds = 0;
        lastBufferSize = this.buffer.size;
      } else if (scrollProgress > 0.8) {
        stableRounds++;
      }
    }

    if (stableRounds >= 4) console.debug('[LISA Sweep] stable exit at step', sweepStep, '— buffer:', this.buffer.size);

    // Return to bottom
    scrollTo(scroller.scrollHeight);
    await new Promise(r => setTimeout(r, 250));
    this.captureAllVisible();
    if (this._sweepAbort === abort) this._sweepAbort = null;
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
    document.dispatchEvent(new CustomEvent('lisa-conversation-changed', {
      detail: { oldId: this.conversationId, newId }
    }));
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

  // ── File injection into platform chat input ──
  async injectFiles(msg) {
    const files = msg.files || [{ filename: msg.filename, content: msg.content }];
    const mimeType = msg.mimeType || 'text/markdown';

    // Create File objects
    const fileObjects = files.map(f => {
      const blob = new Blob([f.content], { type: mimeType });
      return new File([blob], f.filename, { type: mimeType, lastModified: Date.now() });
    });

    // Strategy 1: Find the platform's file input and set files
    const fileInput = document.querySelector('input[type="file"]');
    if (fileInput) {
      const dt = new DataTransfer();
      fileObjects.forEach(f => dt.items.add(f));
      fileInput.files = dt.files;
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      return { success: true, method: 'fileInput', count: fileObjects.length };
    }

    // Strategy 2: Simulate drag-and-drop on the chat input area
    // Skip on platforms that drop synthetic events (isTrusted guard)
    const noSyntheticDrop = /gemini\.google/.test(window.location.hostname);
    const dropTargets = [
      'div[contenteditable="true"]',
      'textarea',
      '#prompt-textarea',
      '[class*="input"]',
      '[class*="composer"]',
      '[class*="chat-input"]',
      'main',
    ];

    let target = null;
    for (const selector of dropTargets) {
      target = document.querySelector(selector);
      if (target) break;
    }

    if (target && !noSyntheticDrop) {
      const dt = new DataTransfer();
      fileObjects.forEach(f => dt.items.add(f));

      const dragOver = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt });
      const drop = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt });

      target.dispatchEvent(dragOver);
      target.dispatchEvent(drop);
      return { success: true, method: 'dragDrop', count: fileObjects.length };
    }

    // Strategy 3: Clipboard pipeline (Gemini and other isTrusted-guarded platforms)
    // Synthetic DOM events are dropped by defensive frontends. Instead,
    // write the handoff to clipboard and prompt user to paste.
    const textContent = msg.content || (msg.files && msg.files[0] && msg.files[0].content) || (files[0] && files[0].text);
    if (textContent) {
      try {
        // Use textarea trick — navigator.clipboard needs document focus
        // which the popup may steal
        const ta = document.createElement('textarea');
        ta.value = textContent;
        ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px;';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        // Focus the composer so user can paste immediately
        const editor = document.querySelector('div[contenteditable="true"]');
        if (editor) editor.focus();
        // Show paste prompt
        const toast = document.createElement('div');
        toast.id = 'lisa-paste-prompt';
        Object.assign(toast.style, {
          position: 'fixed', top: '20px', left: '50%', transform: 'translateX(-50%)',
          zIndex: '100001', background: 'rgba(15,15,20,0.95)', color: '#fbbf24',
          padding: '14px 24px', borderRadius: '10px',
          fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
          fontSize: '14px', fontWeight: '500',
          boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          border: '1px solid rgba(251,191,36,0.3)'
        });
        toast.textContent = '\u{1F4CB} Handoff copied — press Ctrl+V (Cmd+V) to paste into composer';
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 8000);
        return { success: true, method: 'clipboard', count: 1 };
      } catch (e) {
        console.warn('[LISA] Clipboard write failed:', e);
      }
    }

    return { success: false, error: 'No file input, drop target, or composer found on this platform' };
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
