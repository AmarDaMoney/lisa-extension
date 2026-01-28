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
      
      if (this.isPremium) {
        this.createButton();
        this.setupBeforeUnload();
      }
    } catch (error) {
      console.log('[LISA] Could not check premium status');
    }
  }

  createButton() {
    if (document.getElementById('lisa-floating-btn')) return;

    const button = document.createElement('div');
    button.id = 'lisa-floating-btn';
    button.innerHTML = `
      <button class="lisa-fab" title="Save to LISA Library">
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
      .lisa-save-modal {
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
        margin-bottom: 20px;
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

    button.querySelector('.lisa-fab').addEventListener('click', () => this.saveConversation());
    this.button = button;
    console.log('[LISA] Floating button ready');
  }

  async saveConversation() {
    try {
      this.showToast('Saving...');
      
      const response = await chrome.runtime.sendMessage({ action: 'extractAndSave' });
      
      if (response && response.success) {
        this.showToast('✅ Saved to LISA library!');
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

  setupBeforeUnload() {
    let hasUnsaved = true;
    
    window.addEventListener('beforeunload', (e) => {
      if (hasUnsaved && this.isPremium) {
        // Show custom modal instead of browser default
        this.showSaveModal();
        // Note: Modern browsers limit beforeunload, so we also track via background
        chrome.runtime.sendMessage({ 
          action: 'tabClosing',
          url: window.location.href
        });
      }
    });
  }

  showSaveModal() {
    if (document.querySelector('.lisa-save-modal')) return;

    const modal = document.createElement('div');
    modal.className = 'lisa-save-modal';
    modal.innerHTML = `
      <div class="lisa-modal-content">
        <div class="lisa-modal-title">💾 Save before leaving?</div>
        <div class="lisa-modal-text">This conversation hasn't been saved to your LISA library.</div>
        <div class="lisa-modal-buttons">
          <button class="lisa-modal-btn secondary" id="lisa-skip">Just Leave</button>
          <button class="lisa-modal-btn primary" id="lisa-save">Save & Leave</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('#lisa-skip').addEventListener('click', () => {
      modal.remove();
    });

    modal.querySelector('#lisa-save').addEventListener('click', async () => {
      await this.saveConversation();
      modal.remove();
    });
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new LISAFloatingButton());
} else {
  new LISAFloatingButton();
}