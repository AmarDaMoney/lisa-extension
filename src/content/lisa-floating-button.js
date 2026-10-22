// LISA Floating Save Button
// Shared across all AI platform parsers (Premium Feature)

// Same addresses as src/stripe/stripe-config.js (content scripts can't load it).
const LISA_FAB_API_ORIGIN = 'https://api.sat-chain.com';
const LISA_FAB_APP_ORIGIN = 'https://nexus.sat-chain.com';

// Advanced options, for this page only: they reset to the defaults on reload, so
// nobody saves a partial export days later by surprise. `include` filters what
// Markdown, LISA-V and Inference Shield export; Handoff always sends both sides
// (a one-sided handoff gives the new AI a broken context) and only takes
// `handoffFormat`.
const LISA_FAB_OPTION_DEFAULTS = { include: 'all', handoffFormat: 'lisa' };
const LISA_FAB_INCLUDE_LABELS = { all: 'Whole conversation', user: 'My messages only', assistant: 'AI replies only' };

class LISAFloatingButton {
  constructor() {
    this.button = null;
    this.isPremium = false;
    this.init();
    // Toggle from the popup — registered once here: init() re-runs on every
    // tier/settings change, and a listener added there stacked up, so one
    // toggle ran several times (hide, then show again) and could save
    // hideFloatingButton the wrong way round.
    try {
      chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action !== 'toggleFloatingButton') return false;
        if (this.button) {
          this.removeButton();
          chrome.storage.sync.set({ hideFloatingButton: true });
        } else {
          this.createButton();
          chrome.storage.sync.set({ hideFloatingButton: false });
        }
        sendResponse({ success: true, visible: !!this.button });
        return false;
      });
    } catch (_) { /* extension context gone */ }
    // Listen for storage changes to re-init after popup sets premium
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "sync" && (changes.userTier || changes.askOnChatSwitch)) {
        this.init();
      }
    });
  }

  async init() {
    try {
      const result = await chrome.storage.sync.get(['userTier', 'hideFloatingButton']);
      this.isPremium = result.userTier === 'premium';
      
      // Show by default unless user explicitly hid it
      if (!result.hideFloatingButton) {
        this.createButton();
      }

    } catch (error) {
      console.debug('[LISA] Could not check premium status');
    }
  }
  
  // Google access token via the service worker: content scripts don't get
  // chrome.identity. Null if the user hasn't signed in with Google in the
  // popup (never prompts) or the extension is reloading.
  async _getGoogleToken() {
    try {
      const resp = await chrome.runtime.sendMessage({ action: 'getGoogleAuthToken' });
      return (resp && resp.token) || null;
    } catch (_) {
      return null;
    }
  }

  async checkFloatingLimit(type) {
    // Read fresh: the popup may have validated/changed the license since
    // this page loaded.
    let tierInfo = {};
    try { tierInfo = await chrome.storage.sync.get(['userTier', 'isPayg', 'licenseKey']); } catch (_) {}
    this.isPremium = tierInfo.userTier === 'premium';

    // PAYG key: Premium features while credits last, 1 credit per action —
    // checked before the premium shortcut, which used to let PAYG keys
    // through uncharged. Out of credits → normal free rules below.
    if (tierInfo.isPayg === true && tierInfo.licenseKey) {
      try {
        const resp = await fetch(`${LISA_FAB_API_ORIGIN}/api/credits/deduct`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-License-Key': tierInfo.licenseKey },
          body: JSON.stringify({ source: 'extension' })
        });
        const data = resp.ok ? await resp.json() : null;
        if (data && data.success === true) return { allowed: true, credits: true };
      } catch (e) {
        console.debug('[LISA] PAYG credit charge failed:', e);
      }
    } else if (this.isPremium) {
      // Premium users have no limits
      return { allowed: true };
    }
    // Welcome pool: 100 free operations before daily limits kick in
    try {
      const poolResult = await chrome.storage.sync.get(['usageStats']);
      const pool = poolResult.usageStats?.lifetimeFreePool ?? 0;
      if (pool > 0) return { allowed: true, remaining: pool, pool: true };
    } catch (e) { /* fall through to daily limits */ }
    // PAYG credit check. /api/credits/balance is GET-only and reads the
    // identity from a header, not a POST body with the raw OAuth token —
    // this used to send a POST with { token } in the body, which the
    // backend rejects outright, so this block always silently no-op'd and
    // Handoff/md/lisav never actually checked or spent PAYG credits. Fixed
    // to resolve an identifier the same way popup.js's
    // compressConversation()/loadCreditBalance() do: Google identity first,
    // then (since this block previously only ever tried Google) a stored
    // creditIdentifier/licenseKey fallback — without that fallback, a PAYG
    // user whose credits are tied to a license key, not Google, would never
    // have them checked here at all and would always just hit the free
    // daily-5 cap instead.
    // PAYG keys were already charged (or found empty) above.
    // The server only accepts verified credentials for credits (a Google
    // access token it checks with Google, or a license key) — never a
    // self-declared X-Google-Id / X-Identifier. The token comes from the
    // service worker (content scripts don't get chrome.identity).
    if (tierInfo.isPayg !== true) try {
      const headers = { 'Content-Type': 'application/json' };
      const token = await this._getGoogleToken();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      } else {
        const stored = await chrome.storage.sync.get(['licenseKey']);
        if (stored.licenseKey) headers['X-License-Key'] = stored.licenseKey;
      }

      if (headers['Authorization'] || headers['X-License-Key']) {
        // One atomic call: the server debits only if the balance covers it.
        const dedResp = await fetch(`${LISA_FAB_API_ORIGIN}/api/credits/deduct`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ source: 'extension' })
        });
        const ded = dedResp.ok ? await dedResp.json() : null;
        if (ded && ded.success === true) return { allowed: true, credits: true };
      }
    } catch (e) {
      console.debug('[LISA] PAYG credit check failed:', e);
    }

    // Try backend identity check first (survives reinstalls)
    try {
      const token = await this._getGoogleToken();
      if (token) {
        const resp = await fetch(`${LISA_FAB_API_ORIGIN}/api/limits/check`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, action: type })
        });
        if (resp.ok) {
          const data = await resp.json();
          if (!data.allowed && data.reason !== 'backend_error') {
            return {
              allowed: false,
              message: `Free tier: 5 ${type} saves per day. Upgrade for unlimited!`
            };
          }
          if (data.allowed) return { allowed: true, remaining: data.remaining };
        }
      }
    } catch (e) {
      console.debug('[LISA] Backend limit check failed, falling back to local:', e);
    }

    // Fallback: local limit check (no Google auth or backend unreachable)
    const storageKey = `floating_${type}_today`;
    const dateKey = 'floating_limit_date';
    
    try {
      const result = await chrome.storage.sync.get([storageKey, dateKey]);
      const today = new Date().toISOString().slice(0, 10);
      
      if (result[dateKey] !== today) {
        await chrome.storage.sync.set({
          [dateKey]: today,
          floating_lisav_today: 0,
          floating_rawjson_today: 0,
          floating_md_today: 0,
          floating_handoff_today: 0
        });
        return { allowed: true, remaining: 5 };
      }
      
      const count = result[storageKey] || 0;
      if (count >= 5) {
        return { 
          allowed: false, 
          message: `Free tier: 5 ${type} saves per day. Upgrade for unlimited!`
        };
      }
      
      return { allowed: true, remaining: 5 - count };
    } catch (error) {
      console.debug('[LISA] Limit check error:', error);
      return { allowed: true };
    }
  }

  async incrementFloatingLimit(type) {
    if (this.isPremium) return;

    try {
      const result = await chrome.storage.sync.get(['usageStats']);
      const stats = result.usageStats || { exportsToday: 0, importsToday: 0, lifetimeFreePool: 100 };
      if (stats.lifetimeFreePool > 0) {
        stats.lifetimeFreePool--;
        await chrome.storage.sync.set({ usageStats: stats });
        return stats.lifetimeFreePool;
      }
      // Pool exhausted — bump this action's own daily counter (the same
      // floating_{type}_today / floating_limit_date keys checkFloatingLimit's
      // local fallback reads), not the shared usageStats.exportsToday. That
      // used to be a bug: md/lisav all funneled into exportsToday regardless
      // of type, so checkFloatingLimit's per-type read never actually saw an
      // increment and the local fallback never blocked anything. Re-checks
      // the date here too in case today's rollover reset hasn't run yet for
      // this specific type.
      const storageKey = `floating_${type}_today`;
      const dateKey = 'floating_limit_date';
      const dateResult = await chrome.storage.sync.get([storageKey, dateKey]);
      const today = new Date().toISOString().slice(0, 10);
      const count = dateResult[dateKey] === today ? (dateResult[storageKey] || 0) : 0;
      const newCount = count + 1;
      await chrome.storage.sync.set({ [dateKey]: today, [storageKey]: newCount });
      return 5 - newCount;
    } catch (error) {
      console.debug('[LISA] Limit increment error:', error);
    }
  }
  createButton() {
    if (document.getElementById('lisa-floating-btn')) return;

    const button = document.createElement('div');
    button.id = 'lisa-floating-btn';
    button.innerHTML = `
      <button class="lisa-fab" title="Export to LISA">
        <span class="lisa-acm-dot" title="Context health"></span>
        <span class="lisa-fab-icon">💾</span>
        <span class="lisa-fab-text">Export to LISA</span>
      </button>
    `;

    const styles = document.createElement('style');
    styles.textContent = `
      #lisa-floating-btn {
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 99999;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .lisa-fab {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 10px 16px;
        background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
        color: white;
        border: none;
        border-radius: 50px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 600;
        box-shadow: 0 4px 12px rgba(37, 99, 235, 0.4);
        transition: all 0.2s ease;
      }
      .lisa-fab:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 20px rgba(37, 99, 235, 0.5);
      }
      .lisa-fab-icon { font-size: 16px; }
      .lisa-fab-text { font-size: 13px; }
      .lisa-acm-dot {
        display: none;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #4ade80;
        flex-shrink: 0;
        transition: background 0.3s ease;
      }
      @keyframes lisa-acm-pulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.6; transform: scale(1.3); }
      }
      /* A compact bubble above the floating button: long messages wrap onto
         several lines instead of stretching across the page. */
      .lisa-toast {
        --lisa-toast-bg: #10b981;
        position: fixed;
        bottom: 92px;
        right: 24px;
        max-width: min(300px, calc(100vw - 48px));
        padding: 11px 15px;
        background: var(--lisa-toast-bg);
        color: white;
        border-radius: 12px;
        font: 500 13px/1.45 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        text-align: left;
        white-space: normal;
        overflow-wrap: anywhere;
        box-shadow: 0 6px 18px rgba(0,0,0,0.25);
        z-index: 100000;
        animation: lisa-slide-up 0.3s ease;
      }
      .lisa-toast::after {
        content: "";
        position: absolute;
        bottom: -6px;
        right: 34px;
        border: 6px solid transparent;
        border-bottom: 0;
        border-top-color: var(--lisa-toast-bg);
      }
      .lisa-toast.error { --lisa-toast-bg: #ef4444; }
      @keyframes lisa-slide-up {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .lisa-menu-item {
        padding: 8px 16px;
        color: #fafafa;
        font-size: 14px;
        cursor: pointer;
        transition: background 0.2s;
      }
      .lisa-menu-item:hover {
        background: #3b82f6;
      }
      .lisa-scope-note {
        padding: 5px 16px;
        font-size: 11px;
        color: #fbbf24;
        border-bottom: 1px solid #333;
      }
      .lisa-panel-title {
        padding: 8px 16px;
        border-bottom: 1px solid #333;
        color: #9ca3af;
        font-size: 12px;
      }
      .lisa-opt-group { padding: 2px 16px 8px; }
      .lisa-opt {
        display: flex; align-items: center; gap: 8px;
        color: #e5e7eb; font-size: 13px; padding: 4px 0; cursor: pointer;
      }
      .lisa-opt input { accent-color: #3b82f6; margin: 0; }
      .lisa-opt-hint { color: #6b7280; font-size: 11px; padding: 0 16px 8px; }
      .lisa-pick-list { max-height: 320px; overflow-y: auto; border-top: 1px solid #333; border-bottom: 1px solid #333; }
      .lisa-pick-row {
        display: flex; gap: 8px; align-items: flex-start;
        padding: 6px 16px; color: #e5e7eb; font-size: 12px; cursor: pointer;
      }
      .lisa-pick-row:hover { background: #2a2a30; }
      .lisa-pick-row input { accent-color: #3b82f6; margin: 2px 0 0; flex: none; }
      .lisa-pick-row .lisa-pick-who { flex: none; width: 18px; }
      .lisa-pick-row .lisa-pick-text {
        overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
      }
      .lisa-pick-bar { display: flex; gap: 6px; padding: 6px 16px; flex-wrap: wrap; align-items: center; }
      .lisa-pick-count { color: #9ca3af; font-size: 11px; margin-left: auto; }
      .lisa-chip-btn {
        background: #2a2a30; border: 1px solid #3f3f46; color: #e5e7eb;
        border-radius: 6px; font-size: 11px; padding: 3px 8px; cursor: pointer;
      }
      .lisa-chip-btn:hover { border-color: #3b82f6; }
      .lisa-pick-actions { display: flex; gap: 6px; padding: 8px 16px; }
      .lisa-pick-actions button {
        flex: 1; background: #3b82f6; border: none; color: #fff;
        border-radius: 6px; padding: 7px 6px; font-size: 12px; cursor: pointer;
      }
      .lisa-pick-actions button:disabled { opacity: 0.4; cursor: default; }
      .lisa-menu-section-label {
        padding: 6px 16px 2px;
        font-size: 10px;
        letter-spacing: 0.05em;
        color: #6b7280;
        text-transform: uppercase;
      }
      /* Protect and Advanced fold away until clicked */
      .lisa-menu-group { margin: 0; padding: 0; border: 0; }
      .lisa-menu-summary { list-style: none; cursor: pointer; user-select: none; padding-bottom: 6px; }
      .lisa-menu-summary::-webkit-details-marker { display: none; }
      .lisa-menu-summary::after { content: "▸"; float: right; font-size: 11px; transition: transform 0.15s; }
      .lisa-menu-group[open] > .lisa-menu-summary::after { transform: rotate(90deg); }
      .lisa-menu-summary:hover { color: #9ca3af; }
      @keyframes lisa-menu-unfold {
        from { opacity: 0; transform: scale(0.95) translateY(-6px); }
        to { opacity: 1; transform: scale(1) translateY(0); }
      }
      .lisa-switch-modal {
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 100001;
        animation: lisa-fade-in 0.2s ease;
      }
        .lisa-upgrade-modal {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 100001;
          animation: lisa-fade-in 0.2s ease;
        }
      @keyframes lisa-fade-in {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      .lisa-modal-content {
        background: white;
        padding: 24px;
        border-radius: 12px;
        max-width: 360px;
        text-align: center;
        box-shadow: 0 20px 40px rgba(0,0,0,0.2);
      }
      .lisa-modal-title {
        font-size: 18px;
        font-weight: 600;
        margin-bottom: 8px;
        color: #1f2937;
      }
      .lisa-modal-text {
        font-size: 14px;
        color: #6b7280;
        margin-bottom: 16px;
      }
      .lisa-checkbox {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        font-size: 13px;
        color: #6b7280;
        margin-bottom: 16px;
        cursor: pointer;
      }
      .lisa-checkbox input {
        width: 16px;
        height: 16px;
        cursor: pointer;
      }
      .lisa-modal-buttons {
        display: flex;
        gap: 12px;
        justify-content: center;
      }
      .lisa-modal-btn {
        padding: 10px 20px;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s;
      }
      .lisa-modal-btn.primary {
        background: #2563eb;
        color: white;
        border: none;
      }
      .lisa-modal-btn.primary:hover { background: #1d4ed8; }
      .lisa-modal-btn.secondary {
        background: white;
        color: #6b7280;
        border: 1px solid #e5e7eb;
      }
      .lisa-modal-btn.secondary:hover { background: #f9fafb; }
    `;

    document.head.appendChild(styles);
    document.body.appendChild(button);

    button.querySelector(".lisa-fab").addEventListener("click", () => this.showActionMenu());
    this.button = button;

    // Listen for ACM checkpoint suggestions
    document.addEventListener('lisa-acm-suggest', (e) => {
      const { level, message, hasCheckpoint } = e.detail;
      const action = hasCheckpoint && level === 'critical'
        ? 'Consider a handoff — click LISA → Handoff to carry your context to a fresh session.'
        : 'Click LISA → Context Checkpoint to keep things sharp.';
      this.showToast(`${message} ${action}`);
    });

    // First-time ACM guide — show once when ACM is active
    chrome.storage.sync.get(['acmGuideSeen']).then(result => {
      if (!result.acmGuideSeen && window.__lisaACM) {
        setTimeout(() => this.showAcmGuide(), 2000);
      }
    }).catch(() => {});

    console.debug('[LISA] Floating button ready');
  }
  removeButton() {
    const el = document.getElementById('lisa-floating-btn');
    if (el) el.remove();
    this.button = null;
    const menu = document.querySelector('.lisa-action-menu');
    if (menu) menu.remove();
    console.debug('[LISA] Floating button removed');
  }

  // This element stays open across Handoff — picking Handoff opens a
  // genuinely separate panel on top of this one (see
  // _showHandoffDestinations()) rather than replacing this menu's content,
  // so it stays visible underneath/beside it.
  async showActionMenu() {
    // Remove existing menu if any
    const existing = document.querySelector(".lisa-action-menu");
    if (existing) { existing.remove(); return; }

    const menu = document.createElement("div");
    menu.className = "lisa-action-menu";
    await this._renderMainMenuInto(menu);

    // Position near the button
    const btn = this.button.getBoundingClientRect();
    menu.style.cssText = `
      position: fixed;
      bottom: ${window.innerHeight - btn.top + 10}px;
      right: ${window.innerWidth - btn.right}px;
      background: #1f1f23;
      border: 1px solid #3b82f6;
      border-radius: 8px;
      padding: 6px 0;
      z-index: 2147483647;
      box-shadow: 0 4px 20px rgba(0,0,0,0.4);
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    `;

    document.body.appendChild(menu);

    // Handle clicks
    menu.addEventListener("click", async (e) => {
      const action = e.target.dataset?.action;
      if (action === "handoff") {
        // Opens a separate, independent panel overlapping this one — see
        // _showHandoffDestinations(). menu stays open underneath/beside it.
        await this._showHandoffDestinations(menu);
        return;
      }
      if (!action) return;
      menu.remove();
      if (action === "save-md") this.saveAsMarkdown();
      else if (action === "save-lisav") this.saveLisaV();
      else if (action === "checkpoint") await this.contextCheckpoint();
      else if (action === "inference-shield") await this.checkWithInferenceShield();
      else if (action === "options") await this.showOptionsPanel();
      else if (action === "pick") await this.showMessagePicker();
    });

    // Close on outside click
    setTimeout(() => {
      document.addEventListener("click", function closeMenu(e) {
        if (!menu.contains(e.target)) {
          menu.remove();
          document.removeEventListener("click", closeMenu);
        }
      });
    }, 100);
  }

  async _renderMainMenuInto(menu) {
    const acm = window.__lisaACM;
    const acmStatus = acm ? acm.getStatus() : null;
    const options = await this._getOptions();
    // A filter that's on is always visible, so nobody gets a partial export by surprise.
    const scopeNote = options.include !== 'all'
      ? `<div class="lisa-scope-note" data-action="options" style="cursor:pointer" title="Change in Options">Saving: ${LISA_FAB_INCLUDE_LABELS[options.include]}</div>`
      : '';
    menu.innerHTML = this._buildMenuHeader(acmStatus) + scopeNote + this._buildMenuItems(acmStatus);
  }

  async _getOptions() {
    return { ...LISA_FAB_OPTION_DEFAULTS, ...(this._pageOptions || {}) };
  }

  async _setOptions(patch) {
    this._pageOptions = { ...(await this._getOptions()), ...patch };
    return this._pageOptions;
  }

  // A panel anchored to the floating button, replacing the menu (Options, Choose messages).
  _openPanel(className, html) {
    document.querySelectorAll('.lisa-action-menu, .lisa-fab-panel').forEach(el => el.remove());
    const panel = document.createElement('div');
    panel.className = `lisa-fab-panel ${className}`;
    panel.innerHTML = html;
    const btn = this.button.getBoundingClientRect();
    panel.style.cssText = `
      position: fixed;
      bottom: ${window.innerHeight - btn.top + 10}px;
      right: ${window.innerWidth - btn.right}px;
      width: 340px;
      max-width: calc(100vw - 24px);
      background: #1f1f23;
      border: 1px solid #3b82f6;
      border-radius: 8px;
      z-index: 2147483647;
      box-shadow: 0 4px 20px rgba(0,0,0,0.4);
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      animation: lisa-menu-unfold 0.2s ease;
    `;
    document.body.appendChild(panel);
    setTimeout(() => {
      document.addEventListener('click', function closePanel(e) {
        if (!panel.contains(e.target)) {
          panel.remove();
          document.removeEventListener('click', closePanel);
        }
      });
    }, 100);
    return panel;
  }

  async showOptionsPanel() {
    const options = await this._getOptions();
    const radio = (name, value, label, current) => `
      <label class="lisa-opt"><input type="radio" name="${name}" value="${value}" ${current === value ? 'checked' : ''}> ${label}</label>`;
    const panel = this._openPanel('lisa-options-panel', `
      <div class="lisa-panel-title">⚙ Options (this page, until you reload)</div>
      <div class="lisa-menu-section-label">Include in Markdown, LISA-V and Inference Shield</div>
      <div class="lisa-opt-group">
        ${radio('include', 'all', 'Whole conversation', options.include)}
        ${radio('include', 'user', 'My messages only', options.include)}
        ${radio('include', 'assistant', 'AI replies only', options.include)}
      </div>
      <div class="lisa-menu-section-label">Handoff format</div>
      <div class="lisa-opt-group">
        ${radio('handoffFormat', 'lisa', 'LISA (compact: start and end word for word, middle compressed)', options.handoffFormat)}
        ${radio('handoffFormat', 'markdown', 'Markdown (the full conversation, word for word)', options.handoffFormat)}
      </div>
      <div class="lisa-opt-hint">Handoff always includes both sides. Partial exports are labelled as partial.</div>
    `);
    panel.addEventListener('change', async (e) => {
      if (e.target.name === 'include' || e.target.name === 'handoffFormat') {
        await this._setOptions({ [e.target.name]: e.target.value });
        this.showToast(e.target.name === 'include'
          ? `Saving: ${LISA_FAB_INCLUDE_LABELS[e.target.value]}`
          : `Handoff format: ${e.target.value === 'markdown' ? 'Markdown' : 'LISA'}`);
      }
    });
  }

  // Tick individual messages, then save or check just those. The selection is
  // for this conversation only; it starts from the Include option.
  async showMessagePicker() {
    const panel = this._openPanel('lisa-pick-panel', `
      <div class="lisa-panel-title">☑ Choose messages</div>
      <div class="lisa-pick-bar"><span class="lisa-pick-count">Loading messages…</span></div>`);
    const conversation = await this._captureConversation();
    if (!document.body.contains(panel)) return;
    if (!conversation) {
      panel.querySelector('.lisa-pick-count').textContent = 'No messages found';
      return;
    }
    const options = await this._getOptions();
    const msgs = conversation.messages;
    const matches = (m, include) => include === 'all' || (include === 'user' ? m.role === 'user' : m.role !== 'user');
    const selected = new Set(msgs.map((m, i) => (matches(m, options.include) ? i : -1)).filter(i => i >= 0));

    panel.innerHTML = `
      <div class="lisa-panel-title">☑ Choose messages</div>
      <div class="lisa-pick-bar">
        <button class="lisa-chip-btn" data-pick="all">All</button>
        <button class="lisa-chip-btn" data-pick="user">Mine</button>
        <button class="lisa-chip-btn" data-pick="assistant">AI</button>
        <button class="lisa-chip-btn" data-pick="none">None</button>
        <span class="lisa-pick-count"></span>
      </div>
      <div class="lisa-pick-list"></div>
      <div class="lisa-pick-actions">
        <button data-do="md">📋 Markdown</button>
        <button data-do="lisav">📝 LISA-V</button>
        <button data-do="shield">🛡 Shield</button>
      </div>`;
    const list = panel.querySelector('.lisa-pick-list');
    msgs.forEach((m, i) => {
      // Page text goes in as text, never as HTML.
      const row = document.createElement('label');
      row.className = 'lisa-pick-row';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.dataset.index = String(i);
      box.checked = selected.has(i);
      const who = document.createElement('span');
      who.className = 'lisa-pick-who';
      who.textContent = m.role === 'user' ? '👤' : '🤖';
      const text = document.createElement('span');
      text.className = 'lisa-pick-text';
      const content = typeof m.content === 'string' ? m.content : '';
      text.textContent = content.replace(/\s+/g, ' ').trim().slice(0, 160) || '(no text)';
      row.append(box, who, text);
      list.appendChild(row);
    });
    const refresh = () => {
      panel.querySelector('.lisa-pick-count').textContent = `${selected.size} of ${msgs.length} selected`;
      panel.querySelectorAll('[data-do]').forEach(b => { b.disabled = selected.size === 0; });
      list.querySelectorAll('input').forEach(box => { box.checked = selected.has(Number(box.dataset.index)); });
    };
    refresh();
    list.addEventListener('change', (e) => {
      const i = Number(e.target.dataset.index);
      if (e.target.checked) selected.add(i); else selected.delete(i);
      refresh();
    });
    panel.addEventListener('click', async (e) => {
      const pick = e.target.dataset?.pick;
      if (pick) {
        selected.clear();
        if (pick !== 'none') msgs.forEach((m, i) => { if (matches(m, pick)) selected.add(i); });
        refresh();
        return;
      }
      const todo = e.target.dataset?.do;
      if (!todo || selected.size === 0) return;
      panel.remove();
      const override = { conversation, keep: new Set(selected) };
      if (todo === 'md') await this.saveAsMarkdown(override);
      else if (todo === 'lisav') await this.saveLisaV(override);
      else if (todo === 'shield') await this.checkWithInferenceShield(override);
    });
  }

  // Applies the Include option, or a message picker selection, to a captured
  // conversation. `filter` is null when every message is kept.
  async _scopeConversation(conversation, override) {
    const msgs = conversation.messages;
    let kept, label, include;
    if (override && override.keep) {
      kept = msgs.filter((m, i) => override.keep.has(i));
      include = 'picked';
      label = `${kept.length} selected message${kept.length === 1 ? '' : 's'}`;
    } else {
      include = (await this._getOptions()).include;
      kept = include === 'all' ? msgs : msgs.filter(m => (include === 'user' ? m.role === 'user' : m.role !== 'user'));
      label = LISA_FAB_INCLUDE_LABELS[include] || include;
    }
    const partial = kept.length < msgs.length;
    return {
      conversation: { ...conversation, messages: kept },
      filter: partial ? { include, label, kept: kept.length, total: msgs.length } : null,
    };
  }

  _buildMenuHeader(acmStatus) {
    const levelColors = { green: '#4ade80', yellow: '#facc15', red: '#f87171', critical: '#ef4444' };
    const dotColor = levelColors[acmStatus?.healthLevel] || '#4ade80';
    if (!acmStatus) return '';
    return `
      <div style="display:flex;align-items:center;padding:5px 16px;border-bottom:1px solid #333;">
        <span style="color:#9ca3af;font-size:11px;display:flex;align-items:center;gap:4px;">
          <span style="width:7px;height:7px;border-radius:50%;background:${dotColor};display:inline-block;"></span>
          ${acmStatus.messageCount} msgs · ~${acmStatus.tokenEstimate.toLocaleString()}t
        </span>
      </div>
    `;
  }

  // Grouped into Save / Context sections.
  _buildMenuItems(acmStatus) {
    const gated = acmStatus && acmStatus.conversationId;
    return `
      <div class="lisa-menu-section-label">Save</div>
      <div class="lisa-menu-item" data-action="save-md" title="Human-readable markdown — full conversation as formatted text">📋 Markdown</div>
      <div class="lisa-menu-item" data-action="save-lisav" title="Structured JSONL with integrity hashes — best for AI handoff and continuation">📝 LISA-Verbatim</div>
      ${gated ? `
      <div class="lisa-menu-section-label">Context</div>
      <div class="lisa-menu-item" data-action="checkpoint" title="Ask the AI to summarize where things stand — keeps context sharp, improves export quality">🧠 Checkpoint</div>
      <div class="lisa-menu-item" data-action="handoff" title="Pick a destination and hand off your context">🔄 Handoff</div>
      ` : ''}
      <details class="lisa-menu-group">
        <summary class="lisa-menu-section-label lisa-menu-summary">Protect</summary>
        <div class="lisa-menu-item" data-action="inference-shield" title="Open this conversation in Inference Shield to see what it reveals about your technology before you share it">🛡 Inference Shield</div>
      </details>
      <details class="lisa-menu-group">
        <summary class="lisa-menu-section-label lisa-menu-summary">Advanced</summary>
        <div class="lisa-menu-item" data-action="pick" title="Tick the messages you want, then save them or check them with Inference Shield">☑ Choose messages…</div>
        <div class="lisa-menu-item" data-action="options" title="Save only your messages or only the AI's replies; choose the Handoff format">⚙ Options</div>
      </details>
    `;
  }

  // One retry before giving up on the API — see the matching helper in
  // lisa-v-parser.js for why (a transient failure shouldn't silently
  // downgrade to an undercounted DOM capture).
  async _captureViaApiWithRetry(captureModule, isShared) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = isShared
          ? await captureModule.extractSharedViaAPI()
          : await captureModule.extractViaAPI();
        if (result && result.messages && result.messages.length > 0) return result;
      } catch (_) { /* retry below, or fall through after the last attempt */ }
      if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 500));
    }
    return null;
  }

  // Markdown for a captured conversation; shared by Save as Markdown and
  // Inference Shield so both show the same text.
  _conversationToMarkdown(messages, filter = null) {
    const title = messages.title || document.title || 'Conversation';
    const platform = messages.platform || 'AI';
    const date = new Date().toISOString().split('T')[0];
    let md = `# ${title}\n`;
    md += `> ${platform} conversation — exported ${date}\n`;
    if (filter) md += `> Partial export: ${filter.label} (${filter.kept} of ${filter.total} messages). Not the whole conversation.\n`;
    md += `\n---\n\n`;

    for (const msg of messages.messages) {
      const role = msg.role === 'user' ? 'User' : 'Assistant';
      let text = typeof msg.content === 'string' ? msg.content : (msg.content ? JSON.stringify(msg.content) : '');
      // Tool calls/results live in msg.artifacts, not msg.content (see
      // claude-api-capture.js's processContentBlocks) — without this, a
      // message that's purely a tool call renders as an empty section
      // with its actual content silently lost.
      if (Array.isArray(msg.artifacts) && msg.artifacts.length > 0) {
        const artifactText = msg.artifacts.map(a => {
          if (a.type === 'tool_use') return `Tool call: ${a.name}\nInput: ${JSON.stringify(a.input)}`;
          if (a.type === 'tool_result') {
            const resultText = typeof a.content === 'string' ? a.content : JSON.stringify(a.content);
            return `Tool result:\n${resultText}`;
          }
          return null;
        }).filter(Boolean).join('\n\n');
        text = text ? `${text}\n\n${artifactText}` : artifactText;
      }
      md += `### ${role}\n\n${text}\n\n`;
    }
    return md;
  }

  // The live conversation: the platform's own API where LISA has one (via
  // ACM's map, else Claude/ChatGPT capture modules), then the LisaVParser
  // page capture. Same chain Handoff uses.
  async _captureConversation() {
    let conversation = null;
    const acm = window.__lisaACM;
    const apiCapture = acm && typeof acm._getApiCapture === 'function'
      ? acm._getApiCapture()
      : (window.__LISA_CLAUDE_API_CAPTURE || window.__LISA_CHATGPT_API_CAPTURE || null);
    if (apiCapture) {
      const isShared = window.location.pathname.startsWith('/share/');
      conversation = await this._captureViaApiWithRetry(apiCapture, isShared);
    }
    if (!conversation || !conversation.messages || conversation.messages.length === 0) {
      try {
        const parser = new LisaVParser();
        await parser.extractConversation();
        await parser.finalize();
        conversation = parser.toMessages();
      } catch (e) {
        console.warn('[LISA] Page capture failed:', e);
      }
    }
    return conversation && conversation.messages && conversation.messages.length ? conversation : null;
  }

  // Open the conversation in Inference Shield (a new tab next to this one).
  // Free: it's only a hand-off; Shield charges when the user presses Run.
  async checkWithInferenceShield(override = null) {
    try {
      this.showToast("Opening Inference Shield...");
      const captured = override?.conversation || await this._captureConversation();
      if (!captured) {
        this.showToast("❌ No messages found", true);
        return;
      }
      const { conversation, filter } = await this._scopeConversation(captured, override);
      if (!conversation.messages.length) {
        this.showToast(`❌ No messages to check (${filter?.label || 'empty'})`, true);
        return;
      }
      const title = conversation.title || document.title || 'Conversation';
      const scope = filter ? ` (${filter.label})` : '';
      const response = await chrome.runtime.sendMessage({
        action: 'openInferenceShield',
        text: this._conversationToMarkdown(conversation, filter),
        source: `${conversation.platform || 'AI'} conversation "${title}"${scope}`.slice(0, 80),
      });
      if (!response || !response.ok) this.showToast("❌ Couldn't open Inference Shield", true);
    } catch (e) {
      console.warn('[LISA] Inference Shield hand-off failed:', e);
      this.showToast("❌ Couldn't open Inference Shield", true);
    }
  }

  async saveAsMarkdown(override = null) {
    try {
      const limitCheck = await this.checkFloatingLimit('md');
      if (!limitCheck.allowed) {
        this.showToast(limitCheck.message, true);
        this.showUpgradePrompt();
        return;
      }
      this.showToast("Exporting as Markdown...");

      // Use API capture if available, else fall back to LisaVParser
      let messages = override?.conversation || null;
      let usedFallbackCapture = false;

      if (!messages && window.__LISA_CLAUDE_API_CAPTURE) {
        const isShared = window.location.pathname.startsWith('/share/');
        messages = await this._captureViaApiWithRetry(window.__LISA_CLAUDE_API_CAPTURE, isShared);
      }

      if (!messages && window.__LISA_CHATGPT_API_CAPTURE) {
        const isShared = window.location.pathname.startsWith('/share/');
        messages = await this._captureViaApiWithRetry(window.__LISA_CHATGPT_API_CAPTURE, isShared);
      }

      if (!messages) {
        const parser = new LisaVParser();
        await parser.extractConversation();
        await parser.finalize();
        messages = parser.toMessages();
        usedFallbackCapture = parser.usedFallbackCapture;
      }

      if (!messages || !messages.messages || messages.messages.length === 0) {
        this.showToast("❌ No messages found", true);
        return;
      }

      const scoped = await this._scopeConversation(messages, override);
      if (!scoped.conversation.messages.length) {
        this.showToast(`❌ No messages to save (${scoped.filter?.label || 'empty'})`, true);
        return;
      }
      messages = scoped.conversation;

      // Build clean markdown
      const baseTitle = messages.title || document.title || 'Conversation';
      const title = scoped.filter ? `${baseTitle} (${scoped.filter.label})` : baseTitle;
      const platform = messages.platform || 'AI';
      const md = this._conversationToMarkdown(messages, scoped.filter);

      // Save formatted markdown to library
      const response = await chrome.runtime.sendMessage({
        action: 'extractAndSave',
        source: 'floating-button',
        format: 'markdown',
        data: {
          platform: platform,
          conversationId: messages.conversationId || '',
          url: messages.url || window.location.href,
          title: title,
          extractedAt: new Date().toISOString(),
          messageCount: messages.messages.length,
          messages: [],
          markdownContent: md
        }
      });

      if (response && response.success) {
        this.showToast("✅ Markdown saved to library!");
        if (usedFallbackCapture) {
          setTimeout(() => this.showToast("⚠️ Used fallback capture — message count may be incomplete", true), 2000);
        }
      } else {
        this.showToast('❌ ' + (response?.error || 'Save failed'), true);
        return;
      }
      const remaining = limitCheck.credits ? undefined : await this.incrementFloatingLimit('md'); // paid with a credit → don't also use a free save
      if (remaining !== undefined && remaining <= 5) {
        const label = remaining > 2 ? `${remaining} welcome credits remaining` : `${remaining} saves remaining today`;
        setTimeout(() => this.showToast(label), 2000);
      }
    } catch (error) {
      console.error('[LISA] Markdown save error:', error);
      this.showToast('❌ Could not save', true);
    }
  }
  async saveLisaV(override = null) {
    try {
      // Check free tier limit
        const limitCheck = await this.checkFloatingLimit('lisav');
        if (!limitCheck.allowed) {
          this.showToast(limitCheck.message, true);
          this.showUpgradePrompt();
          return;
        }
      this.showToast("Extracting LISA-V...");
      
      // Use LISA-V parser for verbatim extraction. With a filter (Options) or a
      // picked selection, LISA-V is built from just those messages; finalize()
      // hashes exactly them and marks the file as partial.
      const parser = new LisaVParser();
      const options = await this._getOptions();
      let title = null;
      if (override || options.include !== 'all') {
        const captured = override?.conversation || await this._captureConversation();
        if (!captured) {
          this.showToast("❌ No messages found", true);
          return;
        }
        const scoped = await this._scopeConversation(captured, override);
        if (!scoped.conversation.messages.length) {
          this.showToast(`❌ No messages to save (${scoped.filter?.label || 'empty'})`, true);
          return;
        }
        await parser.loadMessages(scoped.conversation.messages, scoped.filter);
        if (scoped.filter) title = `${parser.getSmartTitle()} (${scoped.filter.label})`;
      } else {
        await parser.extractConversation();
      }
      await parser.finalize();
      const lisaV = parser.toArray();
      const stats = parser.getStats();
      
      // Save via service worker
      const response = await chrome.runtime.sendMessage({
        action: "saveLisaV",
        data: {
          content: lisaV,
          stats: stats,
          platform: parser.detectPlatform(),
          url: window.location.href,
          title: title || parser.getSmartTitle()
        }
      });
      
      if (response?.success) {
        const countLabel = stats.apiMessageCount != null
          ? stats.apiMessageCount + " messages, " + stats.totalBlocks + " blocks"
          : stats.totalBlocks + " blocks";
        this.showToast("✅ LISA-V saved! " + countLabel);
        if (parser.usedFallbackCapture) {
          setTimeout(() => this.showToast("⚠️ Used fallback capture — message count may be incomplete", true), 2000);
        }
        const remaining = limitCheck.credits ? undefined : await this.incrementFloatingLimit('lisav'); // paid with a credit → don't also use a free save
          if (remaining !== undefined && remaining <= 5) {
            const label = remaining > 2 ? `${remaining} welcome credits remaining` : `${remaining} saves remaining today`;
            setTimeout(() => this.showToast(label), 2000);
          }
      } else {
        this.showToast("❌ " + (response?.error || "Save failed"), true);
      }
    } catch (error) {
      console.error("[LISA] LISA-V save error:", error);
      this.showToast("❌ Could not save LISA-V", true);
    }
  }

  async contextCheckpoint() {
    const checkpointPrompt = `Quick context checkpoint — I need you to summarize where we are right now. Cover the entire conversation if no previous checkpoints were asked for. Reply in this thread — don't re-summarize what any previous checkpoint already covered. Use this exact format:

CURRENT STATE: [1-2 lines on what's true right now — what's been built/decided/tried]
OBJECTIVE: [1 line — the overall goal we're working toward]
DECISIONS: [list each active decision we've made, one per line]
OPEN: [list unresolved topics or questions, one per line]
RESOLVED: [list completed/closed items, one line each]
CONSTRAINTS: [list rules, requirements, or things to remember]
KEY CONTEXT: [the 3-5 most important points from our conversation]
NEXT: [1-3 lines — the concrete next step(s) to pick up with]

Keep it tight — this is for continuity, not a report. Only include what matters for picking up where we left off.`;

    try {
      await navigator.clipboard.writeText(checkpointPrompt);

      const editor = document.querySelector(
        'div[contenteditable="true"].ProseMirror, ' +
        '#prompt-textarea, ' +
        'div[contenteditable="true"], ' +
        'textarea'
      );
      if (editor) editor.focus();

      this.showToast("Checkpoint prompt copied — paste it (Ctrl+V) and send. LISA will capture the AI's response automatically.");
    } catch (error) {
      console.error("[LISA] Checkpoint error:", error);
      this.showToast("Could not copy checkpoint prompt", true);
    }
  }

  // ============================================
  // HANDOFF — checkpoint + compressed conversation,
  // injected as a file into a fresh tab on the target platform
  // ============================================

  // Goes straight to destination-picking — Checkpoint is its own standalone
  // FAB menu item now, so the old two-step wizard (create checkpoint, then
  // pick a target) was pure redundancy. Builds a genuinely separate panel
  // (own element, own position, own close listener) that overlaps `menu`
  // without touching it — `menu` is never removed or altered here, so it
  // stays visible exactly as it was. The two panels close independently:
  // picking a destination removes both; clicking outside just this panel
  // (including back onto `menu` itself) closes only this one, leaving
  // `menu`'s own click/outside-click handling to do its normal thing.
  async _showHandoffDestinations(menu) {
    const existing = document.querySelector('.lisa-handoff-dest-panel');
    if (existing) { existing.remove(); return; }

    const acm = window.__lisaACM;
    if (!acm) { this.showToast("ACM not available", true); return; }

    const currentPlatform = acm._detectPlatform();
    const targets = await acm.getHandoffTargets();
    const platformNames = {
      claude: 'Claude', chatgpt: 'ChatGPT', gemini: 'Gemini', grok: 'Grok',
      deepseek: 'DeepSeek', mistral: 'Mistral', copilot: 'Copilot', perplexity: 'Perplexity',
      huggingchat: 'HuggingChat', metaai: 'Meta AI', poe: 'Poe', claudecode: 'Claude Code'
    };

    const allTargets = [
      { platform: currentPlatform, url: acm.NEW_CHAT_URLS[currentPlatform], label: `${platformNames[currentPlatform] || currentPlatform} (fresh session)` },
      ...targets.map(t => ({ ...t, label: (platformNames[t.platform] || t.platform) +
        (t.status === 'untested' ? ' (untested)' : t.status === 'failing' ? ' (known issue)' : '') }))
    ];

    const destPanel = document.createElement('div');
    destPanel.className = 'lisa-handoff-dest-panel';
    destPanel.innerHTML = `
      <div style="padding:8px 16px;border-bottom:1px solid #333;color:#9ca3af;font-size:12px;">Hand off to:</div>
      <div style="padding:6px 16px;font-size:11px;color:rgba(255,255,255,0.5);border-bottom:1px solid #333;">
        💡 Tip: checkpointing first makes this handoff richer.<br>
        Format: ${(await this._getOptions()).handoffFormat === 'markdown' ? 'Markdown (full text)' : 'LISA (compact)'} · change in ⚙ Options
      </div>
      ${allTargets.map(t => `
        <div class="lisa-menu-item" data-url="${t.url}" data-platform="${t.platform}">
          ${t.label}
        </div>
      `).join('')}
    `;

    // Anchored off the main menu's own box (not the FAB button), offset
    // up-and-left so it visibly overlaps rather than exactly coincides —
    // reads as "a second card over the first," not "the same box."
    const menuRect = menu.getBoundingClientRect();
    destPanel.style.cssText = `
      position: fixed;
      bottom: ${window.innerHeight - menuRect.bottom + 20}px;
      right: ${window.innerWidth - menuRect.right + 16}px;
      background: #1f1f23;
      border: 1px solid #3b82f6;
      border-radius: 8px;
      padding: 0;
      z-index: 2147483647;
      box-shadow: 0 8px 30px rgba(0,0,0,0.5);
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      min-width: 200px;
      animation: lisa-menu-unfold 0.2s ease;
    `;
    document.body.appendChild(destPanel);

    destPanel.addEventListener('click', async (e) => {
      const targetItem = e.target.closest('[data-url]');
      if (!targetItem) return;
      destPanel.remove();
      menu.remove();
      await this._executeHandoff(targetItem.dataset.platform, targetItem.dataset.url);
    });

    setTimeout(() => {
      document.addEventListener('click', function closeDestPanel(e) {
        if (!destPanel.contains(e.target)) {
          destPanel.remove();
          document.removeEventListener('click', closeDestPanel);
        }
      });
    }, 100);
  }

  async _executeHandoff(targetPlatform, targetUrl) {
    try {
      // Same free-tier metering as Save as Markdown / Save LISA-Verbatim —
      // its own 5/day bucket once the shared lifetime pool is spent. Checked
      // before any work starts so a blocked attempt doesn't waste a capture
      // + compression pass.
      const limitCheck = await this.checkFloatingLimit('handoff');
      if (!limitCheck.allowed) {
        this.showToast(limitCheck.message, true);
        this.showUpgradePrompt();
        return;
      }

      this.showToast("Preparing handoff...");
      const acm = window.__lisaACM;
      const checkpointHistory = await acm.getCheckpointHistory(); // full chain, oldest first — [] if none exist

      // Extract the live conversation: the platform's own API where LISA has
      // one (Claude, Claude Code, ChatGPT, Perplexity — acm._getApiCapture()
      // maps them), else the same LisaVParser capture Markdown export uses.
      // Without that fallback every other source platform (Gemini, Grok,
      // DeepSeek, Mistral, …) got "No messages to hand off".
      const conversation = await this._captureConversation();
      if (!conversation) {
        this.showToast("No messages to hand off", true);
        return;
      }

      const handoffFormat = (await this._getOptions()).handoffFormat;
      const safeName = (ext) => {
        const t = (conversation.title || document.title || 'handoff').normalize('NFC').replace(/[^\p{L}\p{M}\p{N} -]/gu, '').trim();
        const cut = Array.from(t).slice(0, 50).join('').trim().replace(/\s+/g, '_') || 'handoff';
        const plat = String(conversation.platform || acm._detectPlatform()).replace(/[^\p{L}\p{M}\p{N}]+/gu, '_');
        return `${cut}-lisa-${plat}.${ext}`;
      };
      if (handoffFormat === 'markdown') {
        // Options → Handoff format: Markdown. The whole conversation word for
        // word, both sides, no compression.
        const md = '> LISA context handoff: the full conversation below, word for word. Read it, then continue from where it ends.\n\n'
          + this._conversationToMarkdown(conversation);
        this.showToast("Opening new tab and transferring context...");
        const mdResult = await chrome.runtime.sendMessage({
          action: 'acmHandoffToNewTab', url: targetUrl, fileContent: md, filename: safeName('md'), mimeType: 'text/markdown'
        });
        if (mdResult && mdResult.success) {
          if (!limitCheck.credits) await this.incrementFloatingLimit('handoff');
          const waits = mdResult.method === 'clipboard' || mdResult.method === 'pasteIntercept';
          this.showToast(`Handoff ${waits ? 'ready — press Ctrl+V' : 'injected'} into the new tab.`);
        } else {
          this.showToast("Could not auto-transfer — " + (mdResult?.error || "open the new tab and paste manually"), true);
        }
        return;
      }

      const allMessages = conversation.messages;
      const n = allMessages.length;

      const openingCount = Math.min(2, n);
      const closingCount = Math.min(4, n - openingCount);
      const opening = allMessages.slice(0, openingCount);
      const closing = closingCount > 0 ? allMessages.slice(n - closingCount) : [];
      const middleRange = allMessages.slice(openingCount, n - closingCount);

      const verbatim = m => ({ role: m.role, index: m.index, content: m.content });

      // Split the middle range around however many checkpoint messages
      // actually land inside it (zero, one, or several — the chain can be
      // any length): compress the conversation between them as usual, but
      // splice each checkpoint back in verbatim, in its real position,
      // instead of pulling it out into a side list. A message not in the
      // stored chain (e.g. the extension was uninstalled/reinstalled since
      // it was captured, wiping chrome.storage.local) is re-tested against
      // the same checkpoint-format heuristic live detection uses — the
      // checkpoint's own text is still self-identifying even when LISA's
      // memory of it isn't. A recovered checkpoint is backfilled into
      // storage so future handoffs on this conversation don't need to
      // re-detect it.
      const checkpointRawSet = new Set(checkpointHistory.map(cp => cp.raw));
      const segments = [];
      let segmentStart = 0;
      for (let i = 0; i < middleRange.length; i++) {
        const msg = middleRange[i];
        let isCheckpoint = checkpointRawSet.has(msg.content);
        if (!isCheckpoint) {
          const recovered = acm.detectCheckpointInMessage(msg);
          if (recovered) {
            // Awaited deliberately: _storeCheckpoint does an unsynchronized
            // read-modify-write on chrome.storage.local (get history, push,
            // set). Firing multiple calls without awaiting each one would
            // let their get/set cycles interleave — a conversation with
            // several recovered checkpoints in one handoff run would race,
            // and a later write can silently clobber an earlier one before
            // it's persisted.
            await acm._storeCheckpoint(recovered);
            checkpointRawSet.add(recovered.raw);
            isCheckpoint = true;
          }
        }
        if (isCheckpoint) {
          const segment = middleRange.slice(segmentStart, i);
          if (segment.length > 0) segments.push({ type: 'compressed', segment });
          segments.push({ type: 'checkpoint', message: msg });
          segmentStart = i + 1;
        }
      }
      const tail = middleRange.slice(segmentStart);
      if (tail.length > 0) segments.push({ type: 'compressed', segment: tail });

      // Compression metadata (anchor/semantic_anchors/session_metadata) is
      // analysis *about* a segment, not part of the conversation itself —
      // collected separately here so it can go at the very end of the
      // payload, after every real message, instead of being sandwiched
      // between the compressed messages and the verbatim closing.
      const middle = [];
      const anchors = [];
      let sessionMetadata = null;
      for (const block of segments) {
        if (block.type === 'checkpoint') {
          middle.push({ type: 'checkpoint', ...verbatim(block.message) });
          continue;
        }
        const segmentConversation = { ...conversation, messages: block.segment };
        const response = await chrome.runtime.sendMessage({
          action: 'compressForHandoff',
          data: segmentConversation
        });
        if (!response || !response.success) {
          this.showToast("Compression failed: " + (response?.error || "unknown error"), true);
          return;
        }
        const lean = response.lean;
        middle.push({ type: 'compressed', format: lean.format, messages: lean.messages });
        if (lean.anchor || lean.semantic_anchors) {
          anchors.push({ anchor: lean.anchor || undefined, semantic_anchors: lean.semantic_anchors || undefined });
        }
        if (!sessionMetadata && lean.session_metadata) sessionMetadata = lean.session_metadata;
      }

      const instructions = 'LISA context handoff. "opening", "middle", and "closing" are the conversation itself, in order — read them first: "opening"/"closing" are verbatim (how it started, how it ended); "middle" is an ordered array where entries with type "checkpoint" are the AI\'s own verbatim checkpoint replies from earlier in this conversation and entries with type "compressed" are LISA-compressed conversation in between. Continue from the last checkpoint entry\'s "NEXT" section if one exists, otherwise from where "closing" leaves off. "anchors" and "session_metadata" at the end are supplementary analysis (key entities/topics), not part of the conversation flow.';

      const payload = {
        _instructions: instructions,
        platform: conversation.platform,
        title: conversation.title,
        messageCount: n,
        opening: opening.map(verbatim),
        middle,
        closing: closing.map(verbatim),
        anchors: anchors.length > 0 ? anchors : undefined,
        session_metadata: sessionMetadata || undefined
      };

      // Same pattern as files saved from the library: <Title>-lisa-<platform>
      // (source conversation's title and platform). Unlike the library's
      // sanitizer, letters with accents are kept (\p{L}), so a French or
      // Spanish title stays readable.
      const safeTitle = (conversation.title || document.title || 'handoff')
        .normalize('NFC').replace(/[^\p{L}\p{M}\p{N} -]/gu, '').trim();
      // Same rule as lisaSafeTitle() in shared/export-builders.js (not loaded
      // in content scripts): every script's letters + combining marks, cut at
      // whole characters.
      const safeTitleCut = Array.from(safeTitle).slice(0, 50).join('').trim().replace(/\s+/g, '_') || 'handoff';
      const safePlatform = String(conversation.platform || acm._detectPlatform()).replace(/[^\p{L}\p{M}\p{N}]+/gu, '_');
      const filename = `${safeTitleCut}-lisa-${safePlatform}.json`;
      this.showToast("Opening new tab and transferring context...");

      const injectResult = await chrome.runtime.sendMessage({
        action: 'acmHandoffToNewTab',
        url: targetUrl,
        fileContent: JSON.stringify(payload, null, 2),
        filename,
        mimeType: 'application/json'
      });

      if (injectResult && injectResult.success) {
        if (!limitCheck.credits) await this.incrementFloatingLimit('handoff'); // paid with a credit → don't also use a free save
        const waitsForPaste = injectResult.method === 'clipboard' || injectResult.method === 'pasteIntercept';
        const methodLabel = waitsForPaste ? 'ready — press Ctrl+V' : 'injected';
        this.showToast(`Handoff ${methodLabel} into the new tab.`);
      } else {
        this.showToast("Could not auto-transfer — " + (injectResult?.error || "open the new tab and paste manually") , true);
      }
    } catch (error) {
      console.error("[LISA] Handoff error:", error);
      this.showToast("Could not prepare handoff", true);
    }
  }

  // ============================================
  // GUIDED MODAL — reused for first-time onboarding
  // ============================================

  _showGuidedModal(content, onClose) {
    const existing = document.querySelector('.lisa-guided-modal');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'lisa-guided-modal';
    overlay.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,0.6);
      display:flex;align-items:center;justify-content:center;
      z-index:2147483647;animation:lisa-fade-in 0.2s ease;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
    `;

    const modal = document.createElement('div');
    modal.style.cssText = `
      background:#1f1f23;border:1px solid #3b82f6;border-radius:12px;
      padding:24px;max-width:400px;width:90%;color:#fafafa;
      box-shadow:0 20px 40px rgba(0,0,0,0.4);
    `;
    modal.innerHTML = content;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.remove();
        if (onClose) onClose();
      }
    });

    return { overlay, modal };
  }

  // First-time user guide — same stepper pattern, educational focus
  showAcmGuide() {
    const { overlay, modal } = this._showGuidedModal(`
      <div style="font-size:20px;margin-bottom:8px;">🧠 Meet LISA ACM</div>
      <div style="font-size:13px;color:#9ca3af;margin-bottom:16px;line-height:1.5;">
        <strong>Active Context Management</strong> keeps your AI conversations sharp as they grow long.
      </div>
      <div style="font-size:13px;color:#d1d5db;line-height:1.8;">
        <div style="margin-bottom:8px;">
          <span style="color:#4ade80;">●</span> <strong>Health dot</strong> — shows context pressure (green → yellow → red)
        </div>
        <div style="margin-bottom:8px;">
          <span style="color:#facc15;">●</span> <strong>Checkpoint</strong> — ask the AI to summarize key decisions. Refreshes its focus for 30-40 more exchanges.
        </div>
        <div style="margin-bottom:8px;">
          <span style="color:#f87171;">●</span> <strong>Handoff</strong> — when context is strained, transfer to a fresh session with full continuity.
        </div>
      </div>
      <div style="font-size:12px;color:#6b7280;margin-top:12px;padding-top:12px;border-top:1px solid #333;">
        LISA suggests checkpoints as context grows. Set your preferred AI platforms in Settings for quick handoffs.
      </div>
      <div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end;">
        <button class="lisa-guided-next" style="padding:8px 16px;border-radius:6px;background:#2563eb;color:white;border:none;cursor:pointer;font-size:13px;font-weight:600;">Got it</button>
      </div>
    `);

    modal.querySelector('.lisa-guided-next').onclick = async () => {
      overlay.remove();
      try { await chrome.storage.sync.set({ acmGuideSeen: true }); } catch (_) {}
    };
  }

  showToast(message, isError = false, duration = 0) {
    const existing = document.querySelector('.lisa-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'lisa-toast' + (isError ? ' error' : '');
    toast.textContent = message;
    document.body.appendChild(toast);

    // Progress toasts ("Exporting as Markdown...", "Extracting LISA-V...")
    // stay up until the result toast replaces them — a long capture can
    // outlast a 3s timeout, and a vanished progress toast reads as failure.
    // Capped so one can never get stuck on screen.
    const isProgress = message.includes('Saving') || /(\.\.\.|…)$/.test(message.trim());
    const ms = isProgress ? 180000 : (duration || (message.length > 80 ? 5000 : 3000));
    setTimeout(() => toast.remove(), ms);
  }
  showUpgradePrompt(reason = 'limit') {
    const existing = document.querySelector('.lisa-upgrade-modal');
    if (existing) existing.remove();

    const isCredits = reason === 'no_credits';
    const title = isCredits ? '💳 Out of Credits' : '⚡ Upgrade to Pro';
    const text = isCredits
      ? 'You have no credits left. Top up to keep saving, or upgrade to Pro for unlimited saves.'
      : "You\'ve reached your free daily limit. Upgrade to Pro for unlimited saves — or start with a credit bundle from just $1.";

    const modal = document.createElement('div');
    modal.className = 'lisa-upgrade-modal';
    modal.innerHTML = `
      <div class="lisa-modal-content">
        <div class="lisa-modal-title">${title}</div>
        <div class="lisa-modal-text">${text}</div>
        <div class="lisa-modal-buttons">
          <button class="lisa-modal-btn lisa-maybe-later">Maybe Later</button>
          <button class="lisa-modal-btn lisa-buy-credits">Buy Credits from $1</button>
          <button class="lisa-modal-btn primary lisa-upgrade-now">Upgrade to Pro — $9.99/mo</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('.lisa-maybe-later').addEventListener('click', () => modal.remove());

    modal.querySelector('.lisa-upgrade-now').addEventListener('click', () => {
      window.open(`${LISA_FAB_APP_ORIGIN}/pricing`, '_blank');
      modal.remove();
    });

    modal.querySelector('.lisa-buy-credits').addEventListener('click', () => {
      window.open(`${LISA_FAB_APP_ORIGIN}/pricing#credits`, '_blank');
      modal.remove();
    });
  }
}

// ============================================
// Initialize when DOM is ready
let floatingButton;
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    floatingButton = new LISAFloatingButton();
  });
} else {
  floatingButton = new LISAFloatingButton();
}

// Pre-cache conversation when page is hidden (tab close / navigation away)
// Ensures the service worker auto-save has data even without an explicit save.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    try {
      chrome.runtime.sendMessage({ action: 'preCacheConversation' });
    } catch (_) { /* extension context may already be gone */ }
  }
});
