// LISA Floating Save Button
// Shared across all AI platform parsers (Premium Feature)

class LISAFloatingButton {
  constructor() {
    this.button = null;
    this.isPremium = false;
    this.init();
  }

  async init() {
    try {
      const result = await chrome.storage.sync.get(['userTier']);
      this.isPremium = result.userTier === 'premium';
      
        // Floating button for all users (free gets 5/day limits)
      this.createButton();  
      
    } catch (error) {
      console.log('[LISA] Could not check premium status');
    }
  }
  
  async checkFloatingLimit(type) {
    // Premium users have no limits
    if (this.isPremium) return { allowed: true };
    
    const storageKey = `floating_${type}_today`;
    const dateKey = 'floating_limit_date';
    
    try {
      const result = await chrome.storage.sync.get([storageKey, dateKey]);
      const today = new Date().toDateString();
      
      // Reset if new day
      if (result[dateKey] !== today) {
        await chrome.storage.sync.set({ 
          [dateKey]: today,
          floating_lisav_today: 0,
          floating_rawjson_today: 0
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
      console.log('[LISA] Limit check error:', error);
      return { allowed: true };
    }
  }

  async incrementFloatingLimit(type) {
    if (this.isPremium) return;
    
    const storageKey = `floating_${type}_today`;
    try {
      const result = await chrome.storage.sync.get([storageKey]);
      const count = (result[storageKey] || 0) + 1;
      await chrome.storage.sync.set({ [storageKey]: count });
      return 5 - count;
    } catch (error) {
      console.log('[LISA] Limit increment error:', error);
    }
  }
  createButton() {
    if (document.getElementById('lisa-floating-btn')) return;

    const button = document.createElement('div');
    button.id = 'lisa-floating-btn';
    button.innerHTML = `
      <button class="lisa-fab" title="LISA - AI Memory Library">
        <span class="lisa-fab-icon">💾</span>
        <span class="lisa-fab-text">LISA</span>
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
        padding: 10px 16px;
        color: #fafafa;
        font-size: 14px;
        cursor: pointer;
        transition: background 0.2s;
      }
      .lisa-menu-item:hover {
        background: #3b82f6;
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
    console.log('[LISA] Floating button ready');
  }


  showActionMenu() {
    // Remove existing menu if any
    const existing = document.querySelector(".lisa-action-menu");
    if (existing) { existing.remove(); return; }
    
    const menu = document.createElement("div");
    menu.className = "lisa-action-menu";
    menu.innerHTML = `
      <div class="lisa-menu-item" data-action="save-json">📄 Save Raw JSON</div>
      <div class="lisa-menu-item" data-action="save-lisav">📝 Save LISA-V</div>
      
    `;
    
    // Position near the button
    const btn = this.button.getBoundingClientRect();
    menu.style.cssText = `
      position: fixed;
      bottom: ${window.innerHeight - btn.top + 10}px;
      right: ${window.innerWidth - btn.right}px;
      background: #1f1f23;
      border: 1px solid #3b82f6;
      border-radius: 8px;
      padding: 8px 0;
      z-index: 2147483647;
      box-shadow: 0 4px 20px rgba(0,0,0,0.4);
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    `;
    
    document.body.appendChild(menu);
    
    // Handle clicks
    menu.addEventListener("click", async (e) => {
      const action = e.target.dataset?.action;
      menu.remove();
      if (action === "save-json") this.saveConversation();
      else if (action === "save-lisav") this.saveLisaV();
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
          title: document.title
        }
      });
      
      if (response?.success) {
        this.showToast("✅ LISA-V saved! " + stats.totalBlocks + " blocks");
        const remaining = await this.incrementFloatingLimit('lisav');
          if (remaining !== undefined && remaining <= 2) {
            setTimeout(() => this.showToast(`${remaining} LISA-V saves remaining today`), 2000);
          }
      } else {
        this.showToast("❌ " + (response?.error || "Save failed"), true);
      }
    } catch (error) {
      console.error("[LISA] LISA-V save error:", error);
      this.showToast("❌ Could not save LISA-V", true);
    }
  }


































  async saveConversation() {
    try {
      // Check free tier limit
        const limitCheck = await this.checkFloatingLimit('rawjson');
        if (!limitCheck.allowed) {
          this.showToast(limitCheck.message, true);
          this.showUpgradePrompt();
          return;
        }
      this.showToast('Saving...');
      
      const response = await chrome.runtime.sendMessage({ action: 'extractAndSave' });
      
      if (response && response.success) {
        this.showToast('✅ Saved to LISA library!');
        const remaining = await this.incrementFloatingLimit('rawjson');
          if (remaining !== undefined && remaining <= 2) {
            setTimeout(() => this.showToast(`${remaining} Raw JSON saves remaining today`), 2000);
          }
      } else {
        this.showToast('❌ ' + (response?.error || 'Save failed'), true);
      }
    } catch (error) {
      console.error('[LISA] Save error:', error);
      this.showToast('❌ Could not save', true);
    }
  }

  showToast(message, isError = false) {
    const existing = document.querySelector('.lisa-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'lisa-toast' + (isError ? ' error' : '');
    toast.textContent = message;
    document.body.appendChild(toast);

    if (!message.includes('Saving')) {
      setTimeout(() => toast.remove(), 3000);
    }
  }
  showUpgradePrompt() {
    const existing = document.querySelector('.lisa-upgrade-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.className = 'lisa-upgrade-modal';
    modal.innerHTML = `
      <div class="lisa-modal-content">
        <div class="lisa-modal-title">⚡ Upgrade to Premium</div>
        <div class="lisa-modal-text">
          Get unlimited LISA-V and Raw JSON saves, plus all premium features!
        </div>
        <div class="lisa-modal-buttons">
          <button class="lisa-modal-btn" onclick="this.closest('.lisa-upgrade-modal').remove()">Maybe Later</button>
          <button class="lisa-modal-btn primary" onclick="window.open('https://lisa-web-backend-production.up.railway.app/pricing', '_blank'); this.closest('.lisa-upgrade-modal').remove()">Upgrade Now</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }
}

// ============================================
// CHAT CHANGE DETECTION
// ============================================

class LISAChatMonitor {
  constructor(floatingButton) {
    this.fab = floatingButton;
    this.lastUrl = window.location.href;
    this.lastPath = new URL(window.location.href).pathname;
    this.dontAskThisSession = false;
    this.init();
  }

  async init() {
    const result = await chrome.storage.sync.get(['askOnChatSwitch', 'userTier']);
    this.enabled = result.askOnChatSwitch !== false;
    const isPremium = result.userTier === 'premium';
    
    if (this.enabled && isPremium) {
      this.startMonitoring();
    }
  }

  startMonitoring() {
    setInterval(() => this.checkUrlChange(), 500);
    console.log('[LISA] Chat monitor started');
  }

  checkUrlChange() {
    const currentUrl = window.location.href;
    const currentPath = new URL(currentUrl).pathname;
    
    // Skip if same URL
    if (currentUrl === this.lastUrl) return;
    
    // Skip if same path (refresh, hash change, query change)
    if (currentPath === this.lastPath) {
      this.lastUrl = currentUrl;
      return;
    }
    
    // Update tracking
    const wasChat = this.isChatUrl(this.lastUrl);
    this.lastUrl = currentUrl;
    this.lastPath = currentPath;
    
    // Skip if wasn't in a chat before
    if (!wasChat) return;
    
    // Skip if disabled
    if (this.dontAskThisSession) return;
    
    // Show prompt after page loads
    setTimeout(() => this.promptSave(), 2000);
  }

  isChatUrl(url) {
    const chatPatterns = [
      /claude\.ai\/chat\//,
      /chatgpt\.com\/c\//,
      /gemini\.google\.com\/app\//,
      /grok\.com\/c\//,
      /chat\.mistral\.ai\/chat\//,
      /chat\.deepseek\.com\/chat\//,
      /copilot\.microsoft\.com\/chats\//,
      /perplexity\.ai\/search\//
    ];
    return chatPatterns.some(pattern => pattern.test(url));
  }

  promptSave() {
    if (document.querySelector('.lisa-switch-modal')) return;

    const modal = document.createElement('div');
    modal.className = 'lisa-switch-modal';
    modal.innerHTML = `
      <div class="lisa-modal-content">
        <div class="lisa-modal-title">💾 Save this conversation?</div>
        <div class="lisa-modal-text">Save the current conversation to your LISA library?</div>
        <label class="lisa-checkbox">
          <input type="checkbox" id="lisa-dont-ask">
          <span>Don't ask again this session</span>
        </label>
        <div class="lisa-modal-buttons">
          <button class="lisa-modal-btn secondary" id="lisa-skip-switch">Skip</button>
          <button class="lisa-modal-btn primary" id="lisa-save-switch">Save</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('#lisa-skip-switch').addEventListener('click', () => {
      if (modal.querySelector('#lisa-dont-ask').checked) {
        this.dontAskThisSession = true;
      }
      modal.remove();
    });

    modal.querySelector('#lisa-save-switch').addEventListener('click', async () => {
      if (modal.querySelector('#lisa-dont-ask').checked) {
        this.dontAskThisSession = true;
      }
      modal.remove();
      if (this.fab) {
        await this.fab.saveConversation();
      }
    });
  }
}

// Initialize when DOM is ready
let floatingButton;
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    floatingButton = new LISAFloatingButton();
    new LISAChatMonitor(floatingButton);
  });
} else {
  floatingButton = new LISAFloatingButton();
  new LISAChatMonitor(floatingButton);
}
