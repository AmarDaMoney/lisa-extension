// LISA Floating Save Button
// Shared across all AI platform parsers (Premium Feature)

class LISAFloatingButton {
  constructor() {
    this.button = null;
    this.isPremium = false;
    this.init();
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

      // Listen for toggle messages from popup
      chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'toggleFloatingButton') {
          if (this.button) {
            this.removeButton();
            chrome.storage.sync.set({ hideFloatingButton: true });
          } else {
            this.createButton();
            chrome.storage.sync.set({ hideFloatingButton: false });
          }
          sendResponse({ success: true, visible: !!this.button });
          return true;
        }
      });
      
    } catch (error) {
      console.debug('[LISA] Could not check premium status');
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
        const resp = await fetch('https://lisa-web-backend-production.up.railway.app/api/credits/deduct', {
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
    if (tierInfo.isPayg !== true) try {
      let identifier = '';
      const headers = { 'Content-Type': 'application/json' };

      const token = await new Promise((resolve) => {
        chrome.identity.getAuthToken({ interactive: false }, (t) => resolve(t || null));
      });
      if (token) {
        const idResp = await fetch(`https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${token}`);
        if (idResp.ok) {
          const idData = await idResp.json();
          if (idData.sub) identifier = `goog_${idData.sub}`;
        }
      }
      if (!identifier) {
        const stored = await chrome.storage.sync.get(['creditIdentifier', 'licenseKey']);
        identifier = stored.creditIdentifier || stored.licenseKey || '';
      }

      if (identifier) {
        if (identifier.startsWith('goog_')) headers['X-Google-Id'] = identifier;
        else if (identifier.startsWith('email_')) headers['X-Identifier'] = identifier;
        else headers['X-License-Key'] = identifier;

        const balResp = await fetch('https://lisa-web-backend-production.up.railway.app/api/credits/balance', { headers });
        if (balResp.ok) {
          const balData = await balResp.json();
          if (balData.balance > 0) {
            // Deduct 1 credit — allow only if the server confirms it
            const dedResp = await fetch('https://lisa-web-backend-production.up.railway.app/api/credits/deduct', {
              method: 'POST',
              headers,
              body: JSON.stringify({ source: 'extension' })
            });
            const ded = dedResp.ok ? await dedResp.json() : null;
            if (ded && ded.success === true) return { allowed: true, credits: true };
          }
        }
      }
    } catch (e) {
      console.debug('[LISA] PAYG credit check failed:', e);
    }

    // Try backend identity check first (survives reinstalls)
    try {
      const token = await new Promise((resolve) => {
        chrome.identity.getAuthToken({ interactive: false }, (t) => resolve(t || null));
      });
      if (token) {
        const resp = await fetch('https://lisa-web-backend-production.up.railway.app/api/limits/check', {
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
      .lisa-toast {
        position: fixed;
        bottom: 80px;
        right: 24px;
        padding: 12px 20px;
        background: #10b981;
        color: white;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 500;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 100000;
        animation: lisa-slide-up 0.3s ease;
      }
      .lisa-toast.error { background: #ef4444; }
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
      .lisa-menu-section-label {
        padding: 6px 16px 2px;
        font-size: 10px;
        letter-spacing: 0.05em;
        color: #6b7280;
        text-transform: uppercase;
      }
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
      menu.remove();
      if (action === "save-md") this.saveAsMarkdown();
      else if (action === "save-lisav") this.saveLisaV();
      else if (action === "checkpoint") await this.contextCheckpoint();
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
    menu.innerHTML = this._buildMenuHeader(acmStatus) + this._buildMenuItems(acmStatus);
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

  async saveAsMarkdown() {
    try {
      const limitCheck = await this.checkFloatingLimit('md');
      if (!limitCheck.allowed) {
        this.showToast(limitCheck.message, true);
        this.showUpgradePrompt();
        return;
      }
      this.showToast("Exporting as Markdown...");

      // Use API capture if available, else fall back to LisaVParser
      let messages = null;
      let usedFallbackCapture = false;

      if (window.__LISA_CLAUDE_API_CAPTURE) {
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

      // Build clean markdown
      const title = messages.title || document.title || 'Conversation';
      const platform = messages.platform || 'AI';
      const date = new Date().toISOString().split('T')[0];
      let md = `# ${title}\n`;
      md += `> ${platform} conversation — exported ${date}\n\n---\n\n`;

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
  async saveLisaV() {
    try {
      // Check free tier limit
        const limitCheck = await this.checkFloatingLimit('lisav');
        if (!limitCheck.allowed) {
          this.showToast(limitCheck.message, true);
          this.showUpgradePrompt();
          return;
        }
      this.showToast("Extracting LISA-V...");
      
      // Use LISA-V parser for verbatim extraction
      const parser = new LisaVParser();
      await parser.extractConversation();
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
          title: parser.getSmartTitle()
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
        💡 Tip: checkpointing first makes this handoff richer.
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
      let conversation = null;
      const apiCapture = typeof acm._getApiCapture === 'function' ? acm._getApiCapture() : null;
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
          console.warn('[LISA] Handoff: page capture failed:', e);
        }
      }
      if (!conversation || !conversation.messages || conversation.messages.length === 0) {
        this.showToast("No messages to hand off", true);
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
      window.open('https://lisa-web-backend-production.up.railway.app/pricing', '_blank');
      modal.remove();
    });

    modal.querySelector('.lisa-buy-credits').addEventListener('click', () => {
      window.open('https://lisa-web-backend-production.up.railway.app/pricing#credits', '_blank');
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
