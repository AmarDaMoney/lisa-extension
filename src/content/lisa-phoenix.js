/**
 * LISA Phoenix — Context Pressure Estimator (CPE)
 * Phase 1: standalone gauge — no orchestration, no rebirth yet.
 *
 * Listens for 'lisa-message-captured' events from lisa-progressive.js,
 * maintains a running token estimate, and displays a pressure gauge.
 * States (GREEN → AMBER → RED) never downgrade within a session.
 *
 * v0.51.2 — LISA Core / SAT-CHAIN LLC
 */
(function () {
  'use strict';

  // ── Per-language chars-per-token ratios ──
  const TOKEN_RATIOS = { en: 4.0, fr: 3.6, ar: 2.8, default: 3.5 };

  // ── Per-platform threshold table (conservative — see spec §3.2) ──
  const THRESHOLDS = {
    'claude':      { nominal: 200000, amber:  80000, red: 120000 },
    'claude-code': { nominal: 200000, amber:  80000, red: 120000 },
    'chatgpt':     { nominal: 128000, amber:  50000, red:  80000 },
    'gemini':      { nominal: 1000000, amber: 300000, red: 500000 },
    'grok':        { nominal: 128000, amber:  50000, red:  80000 },
    'deepseek':    { nominal:  64000, amber:  25000, red:  40000 },
    'mistral':     { nominal: 128000, amber:  50000, red:  80000 },
    'copilot':     { nominal: 128000, amber:  40000, red:  64000 },
    'perplexity':  { nominal: 128000, amber:  40000, red:  64000 }
  };

  const STATES = { GREEN: 'green', AMBER: 'amber', RED: 'red' };

  class ContextPressureEstimator {
    constructor() {
      this.platform = this._detectPlatform();
      this.thresholds = THRESHOLDS[this.platform] || THRESHOLDS['chatgpt'];
      this.estimatedTokens = 0;
      this.messageCount = 0;
      this.state = STATES.GREEN;
      this.language = 'default';       // TODO: wire to LISA language detection
      this.gauge = null;
      this.platformWarningFired = false;
      this._saveTimer = null;

      this._init();
    }

    // ── Platform detection (mirrors lisa-progressive.js) ──
    _detectPlatform() {
      const h = window.location.hostname;
      const p = window.location.pathname;
      if (h.includes('claude.ai') && p.startsWith('/code/')) return 'claude-code';
      if (h.includes('claude.ai'))              return 'claude';
      if (h.includes('chatgpt.com'))            return 'chatgpt';
      if (h.includes('gemini.google'))           return 'gemini';
      if (h.includes('grok.com'))                return 'grok';
      if (h.includes('deepseek.com'))            return 'deepseek';
      if (h.includes('mistral.ai'))              return 'mistral';
      if (h.includes('copilot.microsoft.com'))   return 'copilot';
      if (h.includes('perplexity.ai'))           return 'perplexity';
      return 'unknown';
    }

    _getTokenRatio() {
      return TOKEN_RATIOS[this.language] || TOKEN_RATIOS.default;
    }

    // ── Core: called on every progressive capture event ──
    onMessageCaptured(detail) {
      const tokens = Math.ceil(detail.textLength / this._getTokenRatio());
      this.estimatedTokens += tokens;
      this.messageCount++;
      this._evaluatePressure();
      this._updateGauge();
      this._persistState();
      // Re-show modal after snooze threshold passed
      if (this.state === STATES.RED && this.snoozeUntil && this.estimatedTokens >= this.snoozeUntil) {
        this.snoozeUntil = null;
        this._showRebirthModal();
      }
    }

    _evaluatePressure() {
      let pressure = this.estimatedTokens;

      // Secondary signal: high message count
      if (this.messageCount > 150) {
        pressure += this.thresholds.nominal * 0.10;
      }

      // State transitions — one-way, never downgrade
      if (this.state === STATES.GREEN && pressure >= this.thresholds.amber) {
        this.state = STATES.AMBER;
        this._onStateChange();
      }
      if (this.state === STATES.AMBER && pressure >= this.thresholds.red) {
        this.state = STATES.RED;
        this._onStateChange();
      }
    }

    _onStateChange() {
      document.dispatchEvent(new CustomEvent('lisa-pressure-change', {
        detail: {
          state: this.state,
          estimatedTokens: this.estimatedTokens,
          threshold: this.thresholds,
          messageCount: this.messageCount,
          platform: this.platform
        }
      }));
      console.log(`[LISA Phoenix] State → ${this.state.toUpperCase()} (~${Math.round(this.estimatedTokens / 1000)}K tokens, ${this.messageCount} msgs)`);
      if (this.state === STATES.RED) this._showRebirthModal();
    }

    // ── Rebirth Modal (spec §7.2 — non-blocking) ──
    _showRebirthModal() {
      if (document.getElementById('lisa-phoenix-modal')) return; // already showing
      const tokK = Math.round(this.estimatedTokens / 1000);
      const redK = Math.round(this.thresholds.red / 1000);
      const isWarning = this.state === STATES.RED;
      const title = isWarning ? 'Context Capacity Warning' : 'Session Rebirth';
      const icon = isWarning ? '⚠️' : '🔥';
      const titleColor = isWarning ? '#f87171' : '#fbbf24';
      const description = isWarning
        ? 'Responses may degrade. LISA can reincarnate this session — distilled context, fresh window, zero re-explaining.'
        : 'Start a fresh session with full context carried over — distilled, clean, and ready to continue.';

      const overlay = document.createElement('div');
      overlay.id = 'lisa-phoenix-modal';
      Object.assign(overlay.style, {
        position: 'fixed', bottom: '124px', right: '20px', zIndex: '100000',
        width: '320px', background: 'rgba(15,15,20,0.96)', color: '#e2e8f0',
        borderRadius: '12px', padding: '20px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        border: '1px solid rgba(248,113,113,0.4)',
        fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
        fontSize: '13px', lineHeight: '1.5'
      });

      overlay.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
          <span style="font-size:20px;">${icon}</span>
          <span style="font-weight:600;font-size:14px;color:${titleColor};">${title}</span>
        </div>
        <p style="margin:0 0 16px;color:rgba(226,232,240,0.8);">
          ~${tokK}K of ~${redK}K estimated tokens used.
          ${description}
        </p>
        <div style="display:flex;gap:6px;margin-bottom:12px;">
          <button id="lisa-phoenix-mode-distilled" class="lisa-phoenix-mode active" style="
            flex:1;padding:6px 8px;border:1px solid rgba(74,222,128,0.4);border-radius:6px;
            cursor:pointer;background:rgba(74,222,128,0.15);color:#4ade80;
            font-size:11px;font-weight:600;transition:all 0.2s;
          ">✨ Distilled</button>
          <button id="lisa-phoenix-mode-full" class="lisa-phoenix-mode" style="
            flex:1;padding:6px 8px;border:1px solid rgba(255,255,255,0.15);border-radius:6px;
            cursor:pointer;background:transparent;color:rgba(226,232,240,0.6);
            font-size:11px;font-weight:500;transition:all 0.2s;
          ">📜 Full fidelity</button>
        </div>
        <div id="lisa-phoenix-mode-desc" style="margin-bottom:12px;font-size:11px;color:rgba(226,232,240,0.5);line-height:1.4;">
          Summarized context + last 10 messages verbatim. Lighter, faster.
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;">
          <button id="lisa-phoenix-rebirth-btn" style="
            padding:10px 16px;border:none;border-radius:8px;cursor:pointer;
            background:linear-gradient(135deg,#dc2626,#b91c1c);color:white;
            font-weight:600;font-size:13px;transition:opacity 0.2s;
          ">🔥 Rebirth now</button>
          <div id="lisa-phoenix-xplat" style="position:relative;">
            <button id="lisa-phoenix-xplat-btn" style="
              padding:8px 16px;border:1px solid rgba(251,191,36,0.3);border-radius:8px;
              cursor:pointer;background:transparent;color:#fbbf24;
              font-size:12px;width:100%;text-align:left;
            ">🌐 Rebirth on another platform ▾</button>
            <div id="lisa-phoenix-xplat-list" style="
              display:none;margin-top:4px;background:rgba(20,20,30,0.98);
              border:1px solid rgba(251,191,36,0.2);border-radius:8px;
              overflow:hidden;
            "></div>
          </div>

          <button id="lisa-phoenix-snooze-btn" style="
            padding:8px 16px;border:none;border-radius:8px;cursor:pointer;
            background:transparent;color:rgba(226,232,240,0.5);
            font-size:11px;
          ">Remind me later</button>
        </div>
      `;

      document.body.appendChild(overlay);

      // ── Mode toggle ──
      let rebirthMode = 'distilled';
      const modeDistilled = document.getElementById('lisa-phoenix-mode-distilled');
      const modeFull = document.getElementById('lisa-phoenix-mode-full');
      const modeDesc = document.getElementById('lisa-phoenix-mode-desc');

      modeDistilled.addEventListener('click', () => {
        rebirthMode = 'distilled';
        modeDistilled.style.background = 'rgba(74,222,128,0.15)';
        modeDistilled.style.borderColor = 'rgba(74,222,128,0.4)';
        modeDistilled.style.color = '#4ade80';
        modeFull.style.background = 'transparent';
        modeFull.style.borderColor = 'rgba(255,255,255,0.15)';
        modeFull.style.color = 'rgba(226,232,240,0.6)';
        modeDesc.textContent = 'Summarized context + last 10 messages verbatim. Lighter, faster.';
      });

      modeFull.addEventListener('click', () => {
        rebirthMode = 'full';
        modeFull.style.background = 'rgba(251,191,36,0.15)';
        modeFull.style.borderColor = 'rgba(251,191,36,0.4)';
        modeFull.style.color = '#fbbf24';
        modeDistilled.style.background = 'transparent';
        modeDistilled.style.borderColor = 'rgba(255,255,255,0.15)';
        modeDistilled.style.color = 'rgba(226,232,240,0.6)';
        modeDesc.textContent = 'Every message verbatim. Best for debugging or review by another model.';
      });

      // ── Button handlers ──
      document.getElementById('lisa-phoenix-rebirth-btn').addEventListener('click', async () => {
        const storage = await chrome.storage.sync.get(['userTier', 'rebirthCount', 'rebirthDate']);
        const tier = storage.userTier || 'free';
        const today = new Date().toISOString().slice(0, 10);
        let count = (storage.rebirthDate === today) ? (storage.rebirthCount || 0) : 0;

        if (tier === 'premium' || count < 5) {
          // Increment daily count for free users
          if (tier !== 'premium') {
            await chrome.storage.sync.set({ rebirthCount: count + 1, rebirthDate: today });
          }
          chrome.runtime.sendMessage({ type: 'PHOENIX_REBIRTH', platform: this.platform, mode: rebirthMode });
          overlay.remove();
        } else {
          // Free tier limit reached
          const btn = document.getElementById('lisa-phoenix-rebirth-btn');
          btn.style.background = 'rgba(100,100,100,0.3)';
          btn.style.cursor = 'default';
          btn.innerHTML = '\u{1F512} Daily limit reached (5/5)';
          const note = document.createElement('p');
          note.style.cssText = 'margin:8px 0 0;color:#fbbf24;font-size:12px;line-height:1.4;';
          note.innerHTML = 'Free tier allows 5 rebirths per day. '
            + '<a href="https://sat-chain.com" target="_blank" style="color:#fbbf24;text-decoration:underline;">Upgrade to Premium</a>'
            + ' for unlimited rebirths, or use the manual export below.';
          btn.parentNode.insertBefore(note, btn.nextSibling);
        }
      });

      // Cross-platform picker
      const xplatBtn = document.getElementById('lisa-phoenix-xplat-btn');
      const xplatList = document.getElementById('lisa-phoenix-xplat-list');
      const platforms = [
        ['claude', 'Claude'], ['chatgpt', 'ChatGPT'], ['gemini', 'Gemini'],
        ['grok', 'Grok'], ['mistral', 'Mistral'], ['deepseek', 'DeepSeek'],
        ['copilot', 'Copilot'], ['perplexity', 'Perplexity']
      ].filter(([id]) => id !== this.platform);

      xplatBtn.addEventListener('click', () => {
        const showing = xplatList.style.display !== 'none';
        if (showing) { xplatList.style.display = 'none'; return; }
        xplatList.innerHTML = platforms.map(([id, name]) =>
          '<div class="lisa-xplat-opt" data-platform="' + id + '" style="' +
          'padding:8px 16px;cursor:pointer;color:#e2e8f0;font-size:12px;' +
          'border-bottom:1px solid rgba(255,255,255,0.05);' +
          'transition:background 0.15s;"' +
          ' onmouseover="this.style.background=\'rgba(251,191,36,0.1)\'" ' +
          ' onmouseout="this.style.background=\'transparent\'">' + name + '</div>'
        ).join('');
        xplatList.style.display = 'block';
        xplatList.querySelectorAll('.lisa-xplat-opt').forEach(opt => {
          opt.addEventListener('click', async () => {
            const target = opt.dataset.platform;
            const storage = await chrome.storage.sync.get(['userTier', 'rebirthCount', 'rebirthDate']);
            const tier = storage.userTier || 'free';
            const today = new Date().toISOString().slice(0, 10);
            let count = (storage.rebirthDate === today) ? (storage.rebirthCount || 0) : 0;
            if (tier === 'premium' || count < 5) {
              if (tier !== 'premium') {
                await chrome.storage.sync.set({ rebirthCount: count + 1, rebirthDate: today });
              }
              chrome.runtime.sendMessage({ type: 'PHOENIX_REBIRTH', platform: target, mode: rebirthMode });
              overlay.remove();
            } else {
              alert('Daily rebirth limit reached (5/5). Upgrade to Premium for unlimited.');
            }
          });
        });
      });

      document.getElementById('lisa-phoenix-snooze-btn').addEventListener('click', () => {
        overlay.remove();
        // Snooze: re-show after ~10K more tokens
        this.snoozeUntil = this.estimatedTokens + 10000;
      });
    }

    // ── Gauge UI ──
    _createGauge() {
      const g = document.createElement('div');
      g.id = 'lisa-phoenix-gauge';
      Object.assign(g.style, {
        position: 'fixed', bottom: '80px', right: '20px', zIndex: '99999',
        width: '36px', height: '36px', borderRadius: '50%',
        background: 'rgba(0,0,0,0.7)', border: '2px solid #4ade80',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', transition: 'border-color 0.5s, box-shadow 0.5s',
        fontSize: '10px', color: 'white', fontFamily: 'monospace',
        boxShadow: '0 2px 8px rgba(0,0,0,0.3)'
      });
      g.title = 'LISA Phoenix — Context Pressure';
      g.textContent = '0%';

      // Long-press → debug readout (spec §3: hidden debug, gauge long-press)
      let timer;
      // Short click → rebirth modal; long-press (800ms) → debug readout
      let longPressed = false;
      g.addEventListener('mousedown', () => {
        longPressed = false;
        timer = setTimeout(() => { longPressed = true; this._showDebug(); }, 800);
      });
      g.addEventListener('mouseup', () => {
        clearTimeout(timer);
        if (!longPressed) this._showRebirthModal();
      });
      g.addEventListener('mouseleave', () => clearTimeout(timer));

      document.body.appendChild(g);
      this.gauge = g;
    }

    _updateGauge() {
      if (!this.gauge) return;
      const pct = Math.min(100, Math.round((this.estimatedTokens / this.thresholds.red) * 100));
      this.gauge.textContent = pct + '%';

      const colors = {
        green: { border: '#4ade80', shadow: 'rgba(74,222,128,0.3)' },
        amber: { border: '#fbbf24', shadow: 'rgba(251,191,36,0.4)' },
        red:   { border: '#f87171', shadow: 'rgba(248,113,113,0.5)' }
      };
      const c = colors[this.state];
      this.gauge.style.borderColor = c.border;
      this.gauge.style.boxShadow = '0 2px 8px ' + c.shadow;
      this.gauge.title = `LISA Phoenix — ~${Math.round(this.estimatedTokens / 1000)}K / ${Math.round(this.thresholds.red / 1000)}K est. tokens (${this.state.toUpperCase()})`;
    }

    _showDebug() {
      const lines = [
        'Platform: ' + this.platform,
        'State: ' + this.state.toUpperCase(),
        'Est. tokens: ~' + Math.round(this.estimatedTokens / 1000) + 'K',
        'Messages: ' + this.messageCount,
        'Amber: ' + Math.round(this.thresholds.amber / 1000) + 'K',
        'Red: ' + Math.round(this.thresholds.red / 1000) + 'K',
        'Nominal: ' + Math.round(this.thresholds.nominal / 1000) + 'K',
        'Lang ratio: ' + this._getTokenRatio() + ' chars/tok',
        'Fill: ' + Math.round(this.estimatedTokens / this.thresholds.nominal * 100) + '% of nominal'
      ].join('\n');
      console.log('[LISA Phoenix CPE]\n' + lines);

      // Temporary tooltip above gauge
      const old = document.getElementById('lisa-phoenix-debug');
      if (old) old.remove();
      const tip = document.createElement('div');
      tip.id = 'lisa-phoenix-debug';
      Object.assign(tip.style, {
        position: 'fixed', bottom: '124px', right: '20px', zIndex: '100000',
        background: 'rgba(0,0,0,0.92)', color: '#e2e8f0',
        padding: '12px 16px', borderRadius: '8px',
        fontFamily: 'monospace', fontSize: '11px', lineHeight: '1.6',
        whiteSpace: 'pre', boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
        border: '1px solid rgba(255,255,255,0.1)'
      });
      tip.textContent = lines;
      document.body.appendChild(tip);
      setTimeout(() => tip.remove(), 5000);
    }

    // ── Platform warning watcher (spec §3.3) ──
    _watchPlatformWarning() {
      // Known selectors for platform-native long-conversation warnings
      const selectors = {
        'claude': '[data-testid*="long-conversation"], [class*="conversation-limit"]'
        // Other platforms: add as discovered during testing
      };
      const sel = selectors[this.platform];
      if (!sel) return;

      const obs = new MutationObserver(() => {
        if (this.platformWarningFired) return;
        if (document.querySelector(sel)) {
          this.platformWarningFired = true;
          // Force AMBER minimum + 20% bump (spec §3.3)
          this.estimatedTokens = Math.max(this.estimatedTokens, this.thresholds.amber);
          this.estimatedTokens += this.thresholds.nominal * 0.20;
          this._evaluatePressure();
          this._updateGauge();
          obs.disconnect();
        }
      });
      obs.observe(document.body, { childList: true, subtree: true });
    }

    // ── Initial scan: catch up with progressive buffer ──
    _scanExistingBuffer() {
      const prog = window.__lisaProgressive;
      if (!prog || !prog.buffer || prog.buffer.size === 0) return;
      let totalChars = 0;
      prog.buffer.forEach((entry) => {
        if (entry.v) totalChars += entry.v.length;
      });
      if (totalChars > 0) {
        this.estimatedTokens = Math.ceil(totalChars / this._getTokenRatio());
        this.messageCount = prog.buffer.size;
        this._evaluatePressure();
        this._updateGauge();
        console.log('[LISA Phoenix] Scanned existing buffer — ' + this.messageCount + ' msgs, ~' + Math.round(this.estimatedTokens / 1000) + 'K tokens');
      }
    }

    // ── Persistence: remember CPE state across page reloads ──
    _getStorageKey() {
      return 'phoenix:' + location.hostname + location.pathname;
    }

    async _loadPersistedState() {
      try {
        const key = this._getStorageKey();
        const data = await chrome.storage.local.get(key);
        const saved = data[key];
        if (saved && saved.estimatedTokens > this.estimatedTokens) {
          this.estimatedTokens = saved.estimatedTokens;
          this.messageCount = saved.messageCount || 0;
          this.state = saved.state || STATES.GREEN;
          this._updateGauge();
          console.log('[LISA Phoenix] Restored — ~' + Math.round(this.estimatedTokens / 1000) + 'K tokens, ' + this.state.toUpperCase());
        }
      } catch (e) { /* storage unavailable — fall through to buffer scan */ }
    }

    _persistState() {
      clearTimeout(this._saveTimer);
      this._saveTimer = setTimeout(() => {
        try {
          chrome.storage.local.set({ [this._getStorageKey()]: {
            estimatedTokens: this.estimatedTokens,
            messageCount: this.messageCount,
            state: this.state,
            updatedAt: new Date().toISOString()
          }});
        } catch (e) { /* ignore */ }
      }, 2000);
    }

    // ── Boot ──
    async _init() {
      if (this.platform === 'unknown') return;

      document.addEventListener('lisa-message-captured', (e) => {
        this.onMessageCaptured(e.detail);
      });

      if (document.body) {
        this._createGauge();
      } else {
        document.addEventListener('DOMContentLoaded', () => this._createGauge());
      }

      this._watchPlatformWarning();

      // Load persisted state first (survives page reloads)
      await this._loadPersistedState();

      // Catch up with messages already captured before phoenix loaded
      // Try immediately (in case progressive already finished)
      this._scanExistingBuffer();
      // Also listen for progressive ready signal (handles async race)
      document.addEventListener('lisa-progressive-ready', () => {
        if (this.messageCount === 0) this._scanExistingBuffer();
      });

      console.log('[LISA Phoenix] CPE ready — ' + this.platform + ' — amber=' + Math.round(this.thresholds.amber / 1000) + 'K, red=' + Math.round(this.thresholds.red / 1000) + 'K');

      // Signal readiness for rebirth injection + listen for completion
      this._signalTabReady();
      this._listenForRebirthComplete();
    }

    // ── New-tab ready signal for rebirth handshake (spec §4.3) ──
    _signalTabReady() {
      const composerSelectors = [
        'div[contenteditable="true"]',
        'textarea',
        '#prompt-textarea',
        '[class*="composer"]',
        'input[type="file"]'
      ];
      const findComposer = () => composerSelectors.some(s => document.querySelector(s));

      // If composer already exists, signal immediately
      if (findComposer()) {
        chrome.runtime.sendMessage({ type: 'PHOENIX_TAB_READY' });
        return;
      }

      // Otherwise watch for it (max 15s timeout per spec §4.3)
      const obs = new MutationObserver(() => {
        if (findComposer()) {
          obs.disconnect();
          clearTimeout(timeout);
          chrome.runtime.sendMessage({ type: 'PHOENIX_TAB_READY' });
        }
      });
      obs.observe(document.body, { childList: true, subtree: true });
      const timeout = setTimeout(() => obs.disconnect(), 15000);
    }

    // ── Rebirth complete toast on source tab ──
    _listenForRebirthComplete() {
      chrome.runtime.onMessage.addListener((msg) => {
        if (msg.type === 'PHOENIX_REBIRTH_COMPLETE') {
          const toast = document.createElement('div');
          toast.id = 'lisa-phoenix-toast';
          Object.assign(toast.style, {
            position: 'fixed', top: '20px', right: '20px', zIndex: '100001',
            background: 'rgba(15,15,20,0.95)', color: '#4ade80',
            padding: '14px 20px', borderRadius: '10px',
            fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
            fontSize: '13px', fontWeight: '500',
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
            border: '1px solid rgba(74,222,128,0.3)'
          });
          toast.textContent = '\u2705 Session reborn \u2014 parent preserved in library.';
          document.body.appendChild(toast);
          setTimeout(() => toast.remove(), 6000);
        }
      });
    }
  }

  // ── Instantiate ──
  new ContextPressureEstimator();
})();
