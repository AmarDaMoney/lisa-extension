/**
 * LISA Phoenix — Context Pressure Estimator (CPE)
 * Phase 1: standalone gauge — no orchestration, no rebirth yet.
 *
 * Listens for 'lisa-message-captured' events from lisa-progressive.js,
 * maintains a running token estimate, and displays a pressure gauge.
 * States (GREEN → AMBER → RED) never downgrade within a session.
 *
 * v0.51.0 — LISA Core / SAT-CHAIN LLC
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
      g.addEventListener('mousedown', () => { timer = setTimeout(() => this._showDebug(), 800); });
      g.addEventListener('mouseup',    () => clearTimeout(timer));
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

    // ── Boot ──
    _init() {
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

      // Catch up with messages already captured before phoenix loaded
      this._scanExistingBuffer();

      console.log('[LISA Phoenix] CPE ready — ' + this.platform + ' — amber=' + Math.round(this.thresholds.amber / 1000) + 'K, red=' + Math.round(this.thresholds.red / 1000) + 'K');
    }
  }

  // ── Instantiate ──
  new ContextPressureEstimator();
})();
