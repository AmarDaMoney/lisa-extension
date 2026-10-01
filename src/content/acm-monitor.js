// LISA ACM — Active Context Management: Monitor Layer
// Phase 1: Message counting, token estimation, context health indicator
//
// On claude.ai and chatgpt.com, message count/tokens come from the
// platform's own REST API (via claude-api-capture.js / chatgpt-api-capture.js,
// which already exist for export) instead of DOM scraping — exact message
// boundaries, no selector guessing, immune to streaming re-renders.
// Falls back to the DOM rescan below if the API call fails.
//
// Everywhere else, counts by content hash (via periodic rescan), not DOM
// node identity or incremental mutation deltas — several platforms (e.g.
// Gemini's Angular rendering) replace already-counted nodes while
// streaming, which made a per-node-identity/incremental design overcount.
// A rescan-and-diff design is self-healing: it can never drift, and it
// needs no second MutationObserver running alongside lisa-progressive.js's
// — it instead listens for the 'lisa-dom-activity' event that observer
// already fires.
// Zero new dependencies.

const ACMMonitor = {
  // State
  messageCount: 0,
  tokenEstimate: 0,
  conversationId: null,
  seenHashes: null, // Map<hash, charLength> for the current conversation
  _lastUrl: null,
  _pollTimer: null,
  _domActivityTimer: null,
  _lastCheckpointAt: 0,
  _apiRescanInFlight: false,
  _lastDetectedCheckpointHash: null,
  _lastSuggestedLevel: null, // track which threshold we last suggested at

  // Thresholds (configurable via chrome.storage.sync)
  thresholds: {
    green: 40,   // 0 to green: healthy
    yellow: 80,  // green to yellow: building context pressure
    red: 120,    // yellow to red: recommend refresh; red+: critical
  },

  // Platform compatibility matrix for handoff — which targets receive well
  // from which source. Built from testing; will grow as we verify more pairs.
  // true = tested and works, false = tested and problematic, absent = untested
  // Untested entries (anything beyond claude<->chatgpt/gemini/grok) are
  // best-guess, same as the pre-existing deepseek/mistral/copilot/perplexity
  // rows — verify with real file auto-inject before trusting, see CLAUDE.md.
  HANDOFF_COMPAT: {
    claude:    { claude: true, chatgpt: true, gemini: true, grok: true, deepseek: true, mistral: true, huggingchat: true, metaai: true, poe: true, claudecode: true },
    chatgpt:   { claude: true, chatgpt: true, gemini: true, grok: true, deepseek: true, mistral: true, huggingchat: true, metaai: true, poe: true, claudecode: true },
    gemini:    { claude: true, chatgpt: true, gemini: true },
    grok:      { claude: true, chatgpt: true, grok: true },
    deepseek:  { claude: true, chatgpt: true, deepseek: true },
    mistral:   { claude: true, chatgpt: true, mistral: true },
    copilot:   { claude: true, chatgpt: true },
    perplexity:{ claude: true, chatgpt: true },
  },

  // New chat URLs per platform
  NEW_CHAT_URLS: {
    claude:      'https://claude.ai/new',
    chatgpt:     'https://chatgpt.com/',
    gemini:      'https://gemini.google.com/app',
    grok:        'https://grok.com/',
    deepseek:    'https://chat.deepseek.com/',
    mistral:     'https://chat.mistral.ai/chat',
    copilot:     'https://copilot.microsoft.com/',
    perplexity:  'https://www.perplexity.ai/',
    huggingchat: 'https://huggingface.co/chat/',
    metaai:      'https://www.meta.ai/',
    poe:         'https://poe.com/',
    // Can only ever be a handoff TARGET, never a source: acm-monitor's own
    // init() bails out on claude.ai/code/* (no API capture, virtualized DOM
    // generic selector-counting can't handle — see init() below), so this
    // platform never shows the Handoff menu itself.
    claudecode:  'https://claude.ai/code/',
  },

  async getHandoffTargets() {
    const currentPlatform = this._detectPlatform();
    const compat = this.HANDOFF_COMPAT[currentPlatform] || {};

    try {
      const result = await chrome.storage.sync.get(['acmPlatforms']);
      const userPrefs = result.acmPlatforms || [];
      if (userPrefs.length === 0) return [];

      return userPrefs
        .filter(p => p !== currentPlatform && compat[p] === true)
        .map(p => ({ platform: p, url: this.NEW_CHAT_URLS[p] }));
    } catch (_) {
      return [];
    }
  },

  _detectPlatform() {
    const host = window.location.hostname;
    if (host.includes('claude.ai')) return 'claude';
    if (host.includes('chatgpt.com')) return 'chatgpt';
    if (host.includes('gemini.google')) return 'gemini';
    if (host.includes('grok.com')) return 'grok';
    if (host.includes('deepseek.com')) return 'deepseek';
    if (host.includes('mistral.ai')) return 'mistral';
    if (host.includes('copilot.microsoft')) return 'copilot';
    if (host.includes('perplexity.ai')) return 'perplexity';
    return 'unknown';
  },

  async init() {
    // https://claude.ai/code/* also matches the broader https://claude.ai/*
    // manifest pattern, so this script gets injected there too via that
    // second block even though it's deliberately left out of the
    // claude.ai/code/* one (no API capture exists for Claude Code, and its
    // DOM is virtualized in a way generic selector-counting can't handle).
    if (window.location.hostname.includes('claude.ai') && window.location.pathname.startsWith('/code/')) {
      return;
    }

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
    this.seenHashes = new Map();

    // Load persisted display state so the dot isn't blank on first paint —
    // the rescan below is the authoritative source and will correct it.
    await this._loadState();
    this._updateDot();

    this._pruneStaleState();

    if (this._isApiCapturePlatform()) {
      // API path: event-triggered, not timed — a real network call (two
      // requests on Claude), so it only fires once DOM activity settles
      // (a longer debounce than the DOM path's, since a streaming reply
      // fires many events in a row and we only need the final state, not
      // every intermediate one) rather than on a fixed interval.
      this._rescanViaApi();
      document.addEventListener('lisa-dom-activity', () => {
        clearTimeout(this._domActivityTimer);
        this._domActivityTimer = setTimeout(() => this._rescanViaApi(), 3000);
      });
    } else {
      this._rescan();
      // Primary trigger: lisa-progressive.js's existing MutationObserver
      // dispatches this on every batch of DOM activity, so we react within
      // a few hundred ms of a new message instead of waiting for the poll.
      // Debounced because a streaming reply fires many mutations in a row.
      document.addEventListener('lisa-dom-activity', () => {
        clearTimeout(this._domActivityTimer);
        this._domActivityTimer = setTimeout(() => this._rescan(), 500);
      });
      // Fallback poll for platforms/moments the event doesn't cover (e.g.
      // progressive capture is off, or a mutation landed outside `main`).
      this._pollTimer = setInterval(() => this._rescan(), 4000);
    }

    this._watchNavigation();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      if (this._isApiCapturePlatform()) this._rescanViaApi();
      else this._rescan();
    });

    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg.action === 'acm_getMonitorStatus') {
        sendResponse(this.getStatus());
        return false;
      }
      if (msg.action === 'acm_getCheckpoint') {
        this.getCheckpoint().then(cp => sendResponse({ checkpoint: cp }));
        return true; // async sendResponse
      }
      if (msg.action === 'acm_resetMonitor') {
        this.seenHashes = new Map();
        this.messageCount = 0;
        this.tokenEstimate = 0;
        this._lastCheckpointAt = 0;
        this._lastDetectedCheckpointHash = null;
        this._lastSuggestedLevel = null;
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
    // Fallback — extract from URL. Pattern table lives in the shared,
    // DOM-free src/shared/conversation-id.js so popup.js can derive the
    // same id retroactively from a saved snapshot's stored URL (which has
    // no window.location to read).
    const result = getConversationIdFromUrl(window.location.href);
    if (result?.id) return result.id;
    return `${result?.platform || 'unknown'}-${Date.now()}`;
  },

  _isApiCapturePlatform() {
    const host = window.location.hostname;
    if (host.includes('claude.ai') && !window.location.pathname.startsWith('/code/')) return true;
    if (host.includes('chatgpt.com')) return true;
    return false;
  },

  _getApiCapture() {
    const host = window.location.hostname;
    if (host.includes('claude.ai')) return window.__LISA_CLAUDE_API_CAPTURE || null;
    if (host.includes('chatgpt.com')) return window.__LISA_CHATGPT_API_CAPTURE || null;
    return null;
  },

  // Exact count/token source for claude.ai and chatgpt.com — the platform's
  // own REST API instead of DOM guessing. Falls back to the DOM rescan on
  // any failure (module not loaded yet, transient API error, shared/
  // read-only view the API doesn't cover) so the dot never goes stale.
  async _rescanViaApi() {
    // Guard against overlapping calls — a conversation switch, a
    // visibility change, and a settled debounce can all fire close
    // together, and each one is a real network request.
    if (this._apiRescanInFlight) return;
    this._apiRescanInFlight = true;
    try {
      const api = this._getApiCapture();
      if (!api || typeof api.extractViaAPI !== 'function') {
        console.debug('[LISA ACM] API capture module not available, skipping this rescan');
        return;
      }
      const result = await api.extractViaAPI();
      if (!result || !Array.isArray(result.messages)) {
        // Don't fall back to the DOM/buffer heuristic here — it disagrees
        // with the API by a lot on Claude (stale progressive-buffer hashes
        // from before edits/regenerations get unioned in), which defeats
        // the point of using the API as the source of truth. Keep the last
        // known-good count and let the next trigger retry instead.
        console.debug('[LISA ACM] API rescan returned no result, keeping last known count');
        return;
      }
      let charTotal = 0;
      for (const m of result.messages) charTotal += (m.content || '').length;
      const newCount = result.messageCount != null ? result.messageCount : result.messages.length;
      const changed = newCount !== this.messageCount;

      this.messageCount = newCount;
      this.tokenEstimate = Math.round(charTotal / 3.5);

      if (changed) {
        this._updateDot();
        this._saveState();
        this._maybeCheckpoint();
        this._detectCheckpointResponse(result.messages);
      }
    } catch (err) {
      console.debug('[LISA ACM] API rescan failed, keeping last known count:', err);
    } finally {
      this._apiRescanInFlight = false;
    }
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

  // Same hashing approach as lisa-progressive.js's simpleHash — hashing by
  // content (not DOM node identity) means a node a platform re-renders
  // with identical text is recognized as the same message, not a new one.
  _hashText(text) {
    const s = text.substring(0, 100);
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  },

  // Rescans the DOM from scratch and rebuilds seenHashes. Authoritative —
  // never drifts, since it doesn't depend on which mutation events fired.
  // Merges in lisa-progressive.js's buffer (same content-hash scheme) so
  // that on virtualised platforms, messages the DOM has already unmounted
  // still count toward the conversation's true total.
  _rescan() {
    const selector = this._getMessageSelector();
    const elements = document.querySelectorAll(selector);
    const freshHashes = new Map();

    for (const el of elements) {
      const text = (el.textContent || '').trim();
      if (text.length < 5) continue; // skip loading skeletons / empty containers
      if (text.includes('[object Object]')) continue;
      const hash = this._hashText(text);
      if (freshHashes.has(hash)) continue; // same message rendered twice in DOM
      freshHashes.set(hash, text.length);
    }

    const buffer = window.lisaProgressive?.buffer;
    if (buffer) {
      for (const [hash, block] of buffer) {
        if (!freshHashes.has(hash)) freshHashes.set(hash, (block.v || '').length);
      }
    }

    const changed = freshHashes.size !== this.seenHashes.size;
    this.seenHashes = freshHashes;

    let charTotal = 0;
    for (const len of freshHashes.values()) charTotal += len;

    this.messageCount = freshHashes.size;
    this.tokenEstimate = Math.round(charTotal / 3.5);

    if (changed) {
      this._updateDot();
      this._saveState();
      this._maybeCheckpoint();
      // On DOM platforms, check the last element for checkpoint format
      if (elements.length > 0) {
        const lastText = (elements[elements.length - 1].textContent || '').trim();
        this._detectCheckpointResponse([{ role: 'assistant', content: lastText }]);
      }
    }
  },

  _maybeCheckpoint() {
    const level = this.getHealthLevel();

    // Suggest checkpoint at each health transition (yellow, red, critical)
    // but only once per level per conversation — not every rescan
    if (level !== 'green' && level !== this._lastSuggestedLevel) {
      this._lastSuggestedLevel = level;

      const suggestions = {
        yellow: 'Context building up — good time for a checkpoint to keep things sharp.',
        red: 'Context pressure is high — a checkpoint now will help maintain quality.',
        critical: 'Context is strained — checkpoint strongly recommended, or consider a handoff.'
      };

      document.dispatchEvent(new CustomEvent('lisa-acm-suggest', {
        detail: {
          level,
          message: suggestions[level],
          hasCheckpoint: this._lastDetectedCheckpointHash !== null,
          messageCount: this.messageCount
        }
      }));
    }

    // Also notify service worker at regular intervals for internal tracking
    if (this.messageCount >= 20 && this.messageCount - this._lastCheckpointAt >= 10) {
      this._lastCheckpointAt = this.messageCount;
      chrome.runtime.sendMessage({
        action: 'acm_checkpoint',
        conversationId: this.conversationId,
        messageCount: this.messageCount,
        tokenEstimate: this.tokenEstimate,
        healthLevel: level
      }).catch(() => {});
    }
  },

  // Checkpoint response detection — looks for the structured format LISA's
  // checkpoint prompt asks for (CURRENT STATE, OBJECTIVE, DECISIONS, OPEN,
  // RESOLVED, CONSTRAINTS, KEY CONTEXT, NEXT). The detection logic itself
  // lives in the shared, DOM-free src/shared/checkpoint-detect.js so
  // buildLeanExport (background/popup) can reuse the exact same heuristic
  // — these are thin delegations, kept as methods so existing call sites
  // here and in lisa-floating-button.js don't need to change.
  // Runs on every API rescan; only fires once per unique response.
  _CHECKPOINT_SECTIONS: CHECKPOINT_SECTIONS,

  _detectCheckpointResponse(messages) {
    if (!messages || messages.length === 0) return;

    // Walk backwards to find the most recent assistant message
    let assistantMsg = null;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') {
        assistantMsg = messages[i];
        break;
      }
    }
    if (!assistantMsg || !assistantMsg.content) return;

    const text = assistantMsg.content;
    // Quick check: must contain at least 6 of the 8 section headers.
    const matchCount = this._countCheckpointHeaders(text);
    if (matchCount < 6) {
      console.debug('[LISA ACM] Checkpoint format check failed —', matchCount, 'of', this._CHECKPOINT_SECTIONS.length, 'sections matched');
      return;
    }

    // Deduplicate — don't re-process the same response twice
    const hash = this._hashText(text);
    if (hash === this._lastDetectedCheckpointHash) return;

    // Parse sections
    const checkpoint = this._parseCheckpointResponse(text);
    if (!checkpoint) {
      console.debug('[LISA ACM] Checkpoint header count matched but section parsing failed');
      return;
    }

    // Only mark as handled once it's actually stored — a parse failure
    // shouldn't permanently block retrying (e.g. once formatting quirks
    // are fixed) on the same response text.
    this._lastDetectedCheckpointHash = hash;

    this._storeCheckpoint(checkpoint);
    console.debug('[LISA ACM] Checkpoint response detected and stored');
  },

  _stripCheckpointMarkdown(line) {
    return stripCheckpointMarkdown(line);
  },

  _countCheckpointHeaders(text) {
    return countCheckpointHeaders(text);
  },

  // Retroactively detects whether a single message (not necessarily the
  // most recent one) is a checkpoint reply, by the same format heuristic
  // _detectCheckpointResponse uses live. Used by Handoff to recover
  // checkpoints whose stored history was lost (e.g. an extension
  // uninstall/reinstall wipes chrome.storage.local) — the checkpoint's own
  // text is still self-identifying even when LISA's memory of it isn't.
  // Pure detector: doesn't touch _lastDetectedCheckpointHash or storage,
  // the caller decides whether to store what it finds.
  detectCheckpointInMessage(message) {
    return detectCheckpointInMessage(message);
  },

  _parseCheckpointResponse(text, messageCount = this.messageCount) {
    return parseCheckpointResponse(text, messageCount);
  },

  // Handoff finds and splices every mid-conversation checkpoint verbatim
  // by matching against the full stored chain, so history always appends
  // rather than ever resetting. MAX_HISTORY is a pure safety ceiling
  // against pathological unbounded growth, not a correctness cap.
  MAX_CHECKPOINT_HISTORY: 20,

  async _storeCheckpoint(checkpoint) {
    if (!this.conversationId) return;
    try {
      const key = `lisa-acm-checkpoint-${this.conversationId}`;
      const result = await chrome.storage.local.get(key);
      const existing = result[key] || { history: [] };
      existing.history.push(checkpoint);
      if (existing.history.length > this.MAX_CHECKPOINT_HISTORY) {
        existing.history = existing.history.slice(-this.MAX_CHECKPOINT_HISTORY);
      }
      existing.latest = checkpoint;
      existing.updatedAt = Date.now();
      await chrome.storage.local.set({ [key]: existing });
    } catch (_) {}
  },

  // this.conversationId is only refreshed by the lisa-conversation-changed
  // event or the 2s URL-poll fallback in _watchNavigation(), so right after
  // a page load/refresh or an SPA route change it can lag the real URL by
  // up to one tick. A Handoff-panel open that lands in that window would
  // read a stale/null id and wrongly conclude no checkpoint exists (or read
  // the wrong conversation's). Recomputing fresh here — and opportunistically
  // healing the cached value — keeps checkpoint lookups correct regardless
  // of whether the poll has caught up yet.
  _currentConversationId() {
    const fresh = this._getConversationId();
    if (fresh && fresh !== this.conversationId) this.conversationId = fresh;
    return this.conversationId;
  },

  async getCheckpoint() {
    const id = this._currentConversationId();
    if (!id) return null;
    try {
      const key = `lisa-acm-checkpoint-${id}`;
      const result = await chrome.storage.local.get(key);
      return result[key]?.latest || null;
    } catch (_) {
      return null;
    }
  },

  // Full chain (oldest first), not just the latest — a "since last
  // checkpoint" checkpoint only covers the delta, so anything that needs
  // the complete picture (e.g. Handoff) has to read all of them in order,
  // not just the most recent one.
  async getCheckpointHistory() {
    const id = this._currentConversationId();
    if (!id) return [];
    try {
      const key = `lisa-acm-checkpoint-${id}`;
      const result = await chrome.storage.local.get(key);
      return result[key]?.history || [];
    } catch (_) {
      return [];
    }
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
    this.seenHashes = new Map();
    this.messageCount = 0;
    this.tokenEstimate = 0;
    this._lastCheckpointAt = 0;
    this._lastDetectedCheckpointHash = null;
    this._lastSuggestedLevel = null;

    // Load any existing persisted state for this conversation, then
    // rescan the now-current conversation immediately — a switch is
    // usually an SPA nav, not a reload, so the new conversation's messages
    // are already available and won't fire fresh mutation/rescan events
    // on their own.
    await this._loadState();
    if (this._isApiCapturePlatform()) await this._rescanViaApi();
    else this._rescan();
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

  // Sweep ACM state for conversations that haven't been touched in 30 days,
  // mirroring lisa-progressive.js's pruneStaleBuffers pattern.
  async _pruneStaleState() {
    try {
      const all = await chrome.storage.local.get(null);
      const staleKeys = Object.keys(all).filter(key =>
        (key.startsWith('lisa-acm-') || key.startsWith('lisa-acm-checkpoint-')) &&
        Date.now() - (all[key]?.updatedAt || 0) > 30 * 24 * 60 * 60 * 1000
      );
      if (staleKeys.length > 0) await chrome.storage.local.remove(staleKeys);
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
    // 0-100 score: 100 = fresh, 0 = severely degraded.
    // Decays to ~10 by the red threshold, then keeps falling slowly.
    const mc = this.messageCount;
    const { red } = this.thresholds;
    if (mc <= 0) return 100;
    if (mc >= red) return Math.max(0, 10 - (mc - red) / 20);
    const ratio = mc / red;
    return Math.round(100 - (ratio * 90));
  },

  getStatus() {
    return {
      messageCount: this.messageCount,
      tokenEstimate: this.tokenEstimate,
      healthLevel: this.getHealthLevel(),
      healthScore: this.getHealthScore(),
      conversationId: this.conversationId,
      thresholds: this.thresholds,
      hasCheckpoint: this._lastDetectedCheckpointHash !== null
    };
  },

  // DOM update — sets the color dot on the floating button
  _updateDot() {
    const dot = document.querySelector('.lisa-acm-dot');
    if (!dot) return;
    dot.style.display = 'inline-block'; // hidden by default; only ACM-active platforms reveal it

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
