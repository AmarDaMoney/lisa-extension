// LISA Core Extension - Popup Logic
// v0.44 - Version update

class LISAPopup {
  constructor() {
    this.currentConversation = null;
    this.compressedData = null;
    this.userTier = 'free';
    this.usageStats = {
      exportsThisWeek: 0,
      importsThisWeek: 0,
      lastResetDate: null
    };
    this.init();
  }

  async init() {
    await this.loadUserTier();
    await this.loadUsageStats();
    this.setupUI();
    this.detectPlatform();
    this.setupEventListeners();
    this.loadSnapshots();
    this.setupAutoSaveToggle();
    this.setupChatSwitchToggle();
  }

  async loadUsageStats() {
    try {
      const result = await chrome.storage.sync.get(['usageStats']);
      if (result.usageStats) {
        this.usageStats = result.usageStats;
        
        const now = new Date();
        const lastReset = this.usageStats.lastResetDate ? new Date(this.usageStats.lastResetDate) : null;
        
        if (!lastReset || this.isNewWeek(lastReset, now)) {
          this.usageStats.exportsThisWeek = 0;
          this.usageStats.importsThisWeek = 0;
          this.usageStats.lastResetDate = now.toISOString();
          await chrome.storage.sync.set({ usageStats: this.usageStats });
        }
      } else {
        this.usageStats = {
          exportsThisWeek: 0,
          importsThisWeek: 0,
          lastResetDate: new Date().toISOString()
        };
        await chrome.storage.sync.set({ usageStats: this.usageStats });
      }
    } catch (error) {
      console.error('[LISA] Error loading usage stats:', error);
    }
  }

  isNewWeek(lastDate, currentDate) {
    const daysSinceReset = Math.floor((currentDate - lastDate) / (1000 * 60 * 60 * 24));
    return daysSinceReset >= 7;
  }

  async updateUsageStats(type) {
    if (type === 'export') {
      this.usageStats.exportsThisWeek++;
    } else if (type === 'import') {
      this.usageStats.importsThisWeek++;
    }
    await chrome.storage.sync.set({ usageStats: this.usageStats });
  }

  checkUsageLimits(type) {
    if (this.userTier === 'premium') {
      return { allowed: true };
    }

    const limits = {
      export: { max: 5, current: this.usageStats.exportsThisWeek },
      import: { max: 2, current: this.usageStats.importsThisWeek }
    };

    const limit = limits[type];
    if (limit.current >= limit.max) {
      return {
        allowed: false,
        message: `Free tier limit: ${limit.max} ${type}s per week. Upgrade to Premium for unlimited access!`,
        current: limit.current,
        max: limit.max
      };
    }

    return { allowed: true, remaining: limit.max - limit.current };
  }

  async loadUserTier() {
    try {
      const result = await chrome.storage.sync.get(['userTier']);
      this.userTier = result.userTier || 'free';
      
      const tierBadge = document.getElementById('userTier');
      tierBadge.textContent = this.userTier === 'premium' ? 'Premium' : 'Free';
      if (this.userTier === 'premium') {
        tierBadge.classList.add('premium');
      }
    } catch (error) {
      console.error('[LISA] Error loading user tier:', error);
    }
  }

  setupUI() {
    const upgradeBtn = document.getElementById('upgradeBtn');
    if (this.userTier === 'premium') {
      upgradeBtn.style.display = 'none';
    } else {
      upgradeBtn.style.display = 'inline-block';
    }
  }

  async detectPlatform() {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs[0];
      
      if (!tab || !tab.url) {
        this.updatePlatformStatus('No active tab', false);
        return;
      }

      const url = tab.url;
      let platform = null;
      let isSupported = true;

      if (url.startsWith('chrome://') || url.startsWith('chrome-extension://')) {
        this.updatePlatformStatus('Chrome internal page (not supported)', false);
        return;
      }

      if (url.includes('claude.ai')) {
        platform = 'Claude';
      } else if (url.includes('chatgpt.com')) {
        platform = 'ChatGPT';
      } else if (url.includes('gemini.google.com')) {
        platform = 'Gemini';
      } else if (url.includes('grok.com')) {
        platform = 'Grok';
      } else if (url.includes('chat.mistral.ai')) {
        platform = 'Mistral AI';
      } else if (url.includes('chat.deepseek.com')) {
        platform = 'DeepSeek';
      } else if (url.includes('copilot.microsoft.com')) {
        platform = 'Microsoft Copilot';
      } else if (url.includes('perplexity.ai')) {
        platform = 'Perplexity';
      } else {
        platform = 'Web Page (Universal)';
      }

      this.updatePlatformStatus(`✅ ${platform} detected`, true);
      document.getElementById('extractBtn').disabled = false;
    } catch (error) {
      console.error('[LISA] Platform detection error:', error);
      this.updatePlatformStatus('Error detecting platform', false);
    }
  }

  updatePlatformStatus(message, isActive) {
    const status = document.getElementById('platformStatus');
    status.textContent = message;
    status.className = isActive ? 'status active' : 'status';
  }

  setupEventListeners() {
    // Quick Tips Accordion Toggle
    const quickTipsToggle = document.getElementById('quickTipsToggle');
    const quickTipsContent = document.getElementById('quickTipsContent');
    if (quickTipsToggle && quickTipsContent) {
      quickTipsToggle.addEventListener('click', () => {
        quickTipsToggle.classList.toggle('active');
        quickTipsContent.classList.toggle('expanded');
      });
    }

    // Extract conversation
    document.getElementById('extractBtn').addEventListener('click', () => {
      this.extractConversation();
    });

    // Compress
    document.getElementById('compressBtn').addEventListener('click', () => {
      this.compressConversation();
    });

    // Generate hash (premium)
    document.getElementById('generateHashBtn').addEventListener('click', () => {
      this.generateHash();
    });

    // Copy hash
    document.getElementById('copyHashBtn').addEventListener('click', () => {
      this.copyHash();
    });

    // Download
    document.getElementById('downloadBtn').addEventListener('click', () => {
      this.downloadJSON();
    });

    // Copy suggested prompt
    document.getElementById('copyPromptBtn').addEventListener('click', () => {
      this.copyPrompt();
    });

    // Help modal
    document.getElementById('helpLink').addEventListener('click', (e) => {
      e.preventDefault();
      this.openHelpModal();
    });

    document.getElementById('closeHelpBtn').addEventListener('click', () => {
      this.closeHelpModal();
    });

    document.getElementById('gotItBtn').addEventListener('click', () => {
      this.closeHelpModal();
    });

    // Close modal on overlay click
    document.getElementById('helpModal').addEventListener('click', (e) => {
      if (e.target.id === 'helpModal') {
        this.closeHelpModal();
      }
    });

    // Upgrade Modal
    document.getElementById('upgradeBtn').addEventListener('click', () => {
      this.openUpgradeModal();
    });

    document.getElementById('closeUpgradeBtn').addEventListener('click', () => {
      this.closeUpgradeModal();
    });

    document.getElementById('subscribeBtn').addEventListener('click', () => {
      this.initiateSubscription();
    });

    document.getElementById('learnMoreAppBtn').addEventListener('click', () => {
      this.openAppPage();
    });

    // Close upgrade modal on overlay click
    document.getElementById('upgradeModal').addEventListener('click', (e) => {
      if (e.target.id === 'upgradeModal') {
        this.closeUpgradeModal();
      }
    });

    // Settings Modal
    document.getElementById('settingsLink').addEventListener('click', (e) => {
      e.preventDefault();
      this.openSettingsModal();
    });

    document.getElementById('closeSettingsBtn').addEventListener('click', () => {
      this.closeSettingsModal();
    });

    document.getElementById('validateKeyBtn').addEventListener('click', () => {
      this.validateLicenseKey();
    });

    document.getElementById('settingsSubscribeBtn').addEventListener('click', () => {
      this.initiateSubscription();
    });

    document.getElementById('settingsOpenAppBtn').addEventListener('click', () => {
      this.openAppPage();
    });

    document.getElementById('resetDataBtn').addEventListener('click', () => {
      this.resetExtensionData();
    });

    // Close settings modal on overlay click
    document.getElementById('settingsModal').addEventListener('click', (e) => {
      if (e.target.id === 'settingsModal') {
        this.closeSettingsModal();
      }
    });

    // Enter key to validate license
    document.getElementById('licenseKeyInput').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.validateLicenseKey();
      }
    });

    // Links
    document.getElementById('feedbackLink').addEventListener('click', (e) => {
      e.preventDefault();
      this.openFeedback();
    });
  }

  copyPrompt() {
    const prompt = "Read this LISA JSON and continue our conversation";
    navigator.clipboard.writeText(prompt).then(() => {
      const btn = document.getElementById('copyPromptBtn');
      const originalText = btn.textContent;
      btn.textContent = '✅';
      setTimeout(() => {
        btn.textContent = originalText;
      }, 1500);
    }).catch(err => {
      console.error('[LISA] Copy failed:', err);
      this.showError('Failed to copy prompt');
    });
  }

  openHelpModal() {
    document.getElementById('helpModal').style.display = 'flex';
  }

  closeHelpModal() {
    document.getElementById('helpModal').style.display = 'none';
  }

  showLoading(message = 'Processing...') {
    document.getElementById('loadingText').textContent = message;
    document.getElementById('loadingOverlay').style.display = 'flex';
  }

  hideLoading() {
    document.getElementById('loadingOverlay').style.display = 'none';
  }

  showError(message) {
    this.hideLoading();
    // Update status to show error
    const status = document.getElementById('platformStatus');
    const originalText = status.textContent;
    const originalClass = status.className;
    
    status.textContent = `❌ ${message}`;
    status.className = 'status error';
    
    setTimeout(() => {
      status.textContent = originalText;
      status.className = originalClass;
    }, 3000);
  }

  // Send message with timeout and retry
  async sendMessageToTab(tabId, message, timeout = 10000, retries = 2) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await this.sendMessageWithTimeout(tabId, message, timeout);
        return response;
      } catch (error) {
        console.warn(`[LISA] Attempt ${attempt + 1} failed:`, error.message);
        
        if (attempt < retries) {
          // Try to inject content script and retry
          await this.injectContentScript(tabId);
          await new Promise(resolve => setTimeout(resolve, 500));
        } else {
          throw error;
        }
      }
    }
  }

  sendMessageWithTimeout(tabId, message, timeout) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Request timed out - try refreshing the page'));
      }, timeout);
      
      chrome.tabs.sendMessage(tabId, message, (response) => {
        clearTimeout(timer);
        
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (!response) {
          reject(new Error('No response from page'));
        } else {
          resolve(response);
        }
      });
    });
  }

  async injectContentScript(tabId) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const url = tab.url || '';
      
      let scriptFile = 'src/content/universal-parser.js';
      
      if (url.includes('claude.ai')) scriptFile = 'src/content/claude-parser.js';
      else if (url.includes('chatgpt.com')) scriptFile = 'src/content/chatgpt-parser.js';
      else if (url.includes('gemini.google.com')) scriptFile = 'src/content/gemini-parser.js';
      else if (url.includes('x.com')) scriptFile = 'src/content/grok-parser.js';
      else if (url.includes('chat.mistral.ai')) scriptFile = 'src/content/mistral-parser.js';
      else if (url.includes('chat.deepseek.com')) scriptFile = 'src/content/deepseek-parser.js';
      else if (url.includes('copilot.microsoft.com')) scriptFile = 'src/content/copilot-parser.js';
      else if (url.includes('perplexity.ai')) scriptFile = 'src/content/perplexity-parser.js';
      
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: [scriptFile]
      });
      
      console.log('[LISA] Content script injected:', scriptFile);
    } catch (error) {
      console.error('[LISA] Failed to inject content script:', error);
    }
  }

  async extractConversation() {
    this.showLoading('Extracting conversation...');

    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs[0];

      if (!tab || !tab.id) {
        throw new Error('No active tab found');
      }

      // Check if we can access the tab
      if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('chrome-extension://')) {
        throw new Error('Cannot access Chrome internal pages');
      }

      const response = await this.sendMessageToTab(tab.id, { action: 'extractConversation' });

      if (response.success && response.data) {
        this.currentConversation = response.data;
        
        // Update UI
        document.getElementById('messageCount').textContent = response.data.messageCount || 0;
        document.getElementById('detectedPlatform').textContent = response.data.platform || 'Unknown';
        document.getElementById('extractedInfo').style.display = 'block';
        document.getElementById('compressBtn').style.display = 'block';

        this.hideLoading();
        
        // Show helpful message if provided
        if (response.data.userMessage) {
          setTimeout(() => {
            this.updatePlatformStatus(response.data.userMessage, true);
          }, 500);
        }
      } else {
        throw new Error(response.error || 'No content found on this page');
      }
    } catch (error) {
      console.error('[LISA] Extraction error:', error);
      this.showError(error.message || 'Failed to extract. Try refreshing the page.');
    }
  }

  async compressConversation() {
    if (!this.currentConversation) {
      this.showError('Please extract a conversation first');
      return;
    }

    this.showLoading('Compressing to LISA format...');

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'compress',
        data: this.currentConversation
      });

      if (response.success) {
        this.compressedData = response.compressed;
        
        const originalSize = this.formatBytes(JSON.stringify(this.currentConversation).length);
        const compressedSize = this.formatBytes(JSON.stringify(this.compressedData).length);
        
        document.getElementById('compressionRatio').textContent = this.compressedData.metadata.compressionRatio;
        document.getElementById('originalSize').textContent = originalSize;
        document.getElementById('compressedSize').textContent = compressedSize;
        document.getElementById('compressionInfo').style.display = 'block';
        document.getElementById('downloadSection').style.display = 'block';

        // Show hashing section (visible for all, but only works for premium)
        document.getElementById('hashingSection').style.display = 'block';

        this.hideLoading();
      } else {
        throw new Error(response.error || 'Compression failed');
      }
    } catch (error) {
      console.error('[LISA] Compression error:', error);
      this.showError('Compression failed: ' + error.message);
    }
  }

  async generateHash() {
    if (!this.compressedData) {
      this.showError('Please compress a conversation first');
      return;
    }

    if (this.userTier !== 'premium') {
      this.showError('LISA Hash is a premium feature');
      return;
    }

    this.showLoading('Generating LISA Hash...');

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'generateHash',
        data: this.compressedData
      });

      if (response.success) {
        document.getElementById('hashValue').textContent = response.hashData.hash;
        document.getElementById('hashInfo').style.display = 'block';
        this.compressedData.lisaHash = response.hashData;
        this.hideLoading();
      } else {
        throw new Error(response.error || 'Hash generation failed');
      }
    } catch (error) {
      console.error('[LISA] Hash generation error:', error);
      this.showError('Hash generation failed');
    }
  }

  copyHash() {
    const hashValue = document.getElementById('hashValue').textContent;
    navigator.clipboard.writeText(hashValue).then(() => {
      const btn = document.getElementById('copyHashBtn');
      const originalText = btn.textContent;
      btn.textContent = '✓ Copied!';
      setTimeout(() => {
        btn.textContent = originalText;
      }, 2000);
    }).catch(err => {
      console.error('[LISA] Copy hash failed:', err);
    });
  }

  downloadJSON() {
    if (!this.compressedData) {
      this.showError('No compressed data to download');
      return;
    }

    const limitCheck = this.checkUsageLimits('export');
    if (!limitCheck.allowed) {
      this.showError(limitCheck.message);
      return;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const platform = (this.compressedData.metadata.platform || 'unknown').replace(/[.\s()]/g, '-');
    const filename = `lisa-${platform}-${timestamp}.json`;

    const dataStr = JSON.stringify(this.compressedData, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);

    chrome.downloads.download({
      url: url,
      filename: filename,
      saveAs: true
    }, (downloadId) => {
      URL.revokeObjectURL(url);
      
      if (chrome.runtime.lastError) {
        console.error('[LISA] Download error:', chrome.runtime.lastError);
        this.showError('Download failed');
        return;
      }
      
      if (downloadId) {
        this.updateUsageStats('export');
        
        this.trackEvent('download', { 
          platform: platform, 
          hasHash: !!this.compressedData.lisaHash 
        });
        
        // Show remaining exports for free users
        if (this.userTier === 'free') {
          const remaining = 5 - this.usageStats.exportsThisWeek;
          if (remaining <= 2) {
            this.updatePlatformStatus(`${remaining} free exports remaining this week`, true);
          }
        }
      }
    });
  }

  openUpgradeModal() {
    document.getElementById('upgradeModal').style.display = 'flex';
    this.trackEvent('upgrade_modal_opened');
  }

  closeUpgradeModal() {
    document.getElementById('upgradeModal').style.display = 'none';
  }

  initiateSubscription() {
    this.trackEvent('subscription_initiated');
    
    // Open the upgrade modal to let user choose plan, then redirect to Stripe Checkout
    this.openStripeCheckout('month');
  }

  async openStripeCheckout(plan = 'month') {
    try {
      const priceId = plan === 'month' 
        ? STRIPE_CONFIG.products.premium_monthly.priceId 
        : STRIPE_CONFIG.products.premium_annual.priceId;

      const client = new StripeClient(STRIPE_CONFIG.publishableKey, STRIPE_CONFIG.apiBaseUrl);
      await client.openCheckout(priceId, plan);
      
      // Close modals after redirect initiated
      this.closeUpgradeModal();
    } catch (error) {
      console.error('[LISA] Checkout error:', error);
      this.showError('Failed to open checkout. Please try again.');
    }
  }

  openAppPage() {
    const appUrl = 'https://lisa-web-backend-production.up.railway.app/landing';
    this.trackEvent('app_page_clicked');
    chrome.tabs.create({ url: appUrl });
  }

  // ============================================
  // SETTINGS MODAL METHODS
  // ============================================

  openSettingsModal() {
    // Load current license key if exists
    this.loadLicenseKey();
    this.updateTierDisplay();
    document.getElementById('settingsModal').style.display = 'flex';
    this.trackEvent('settings_modal_opened');
  }

  closeSettingsModal() {
    document.getElementById('settingsModal').style.display = 'none';
  }

  async loadLicenseKey() {
    try {
      const result = await chrome.storage.sync.get(['licenseKey']);
      if (result.licenseKey) {
        document.getElementById('licenseKeyInput').value = result.licenseKey;
      }
    } catch (error) {
      console.error('[LISA] Failed to load license key:', error);
    }
  }

  updateTierDisplay() {
    const tierDisplay = document.getElementById('currentTierDisplay');
    tierDisplay.textContent = this.userTier === 'premium' ? 'Premium' : 'Free';
    tierDisplay.className = this.userTier === 'premium' ? 'premium' : '';
  }

  async validateLicenseKey() {
    const licenseKey = document.getElementById('licenseKeyInput').value.trim();
    const statusDiv = document.getElementById('licenseStatus');
    const statusIcon = document.getElementById('licenseStatusIcon');
    const statusText = document.getElementById('licenseStatusText');
    const validateBtn = document.getElementById('validateKeyBtn');
    
    if (!licenseKey) {
      this.showLicenseStatus('invalid', '❌', 'Please enter a license key');
      return;
    }

    // Show validating state
    validateBtn.disabled = true;
    validateBtn.textContent = 'Validating...';
    this.showLicenseStatus('validating', '🔄', 'Validating license key...');

    try {
      // Call the app API to validate the license
      const response = await fetch('https://lisa-web-backend-production.up.railway.app/api/validate-license', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-License-Key': licenseKey
        },
        body: JSON.stringify({ license_key: licenseKey })
      });

      if (response.ok) {
        const data = await response.json();
        
        // Store the validated license
        await chrome.storage.sync.set({ 
          licenseKey: licenseKey,
          userTier: 'premium',
          licenseValidatedAt: new Date().toISOString()
        });
        
        this.userTier = 'premium';
        this.updateTierDisplay();
        this.updateTierBadge();
        
        this.showLicenseStatus('valid', '✅', `License valid! Tier: ${data.tier || 'Pro'}`);
        this.trackEvent('license_validated', { tier: data.tier });
        
      } else if (response.status === 401 || response.status === 403) {
        this.showLicenseStatus('invalid', '❌', 'Invalid license key');
      } else {
        throw new Error('Validation failed');
      }
      
    } catch (error) {
      console.error('[LISA] License validation error:', error);
      
      // Fallback: local validation for offline/API-down scenarios
      if (this.localValidateLicense(licenseKey)) {
        await chrome.storage.sync.set({ 
          licenseKey: licenseKey,
          userTier: 'premium',
          licenseValidatedAt: new Date().toISOString()
        });
        
        this.userTier = 'premium';
        this.updateTierDisplay();
        this.updateTierBadge();
        
        this.showLicenseStatus('valid', '✅', 'License accepted (offline mode)');
      } else {
        this.showLicenseStatus('invalid', '❌', 'Could not validate license. Check your key and try again.');
      }
    } finally {
      validateBtn.disabled = false;
      validateBtn.textContent = 'Validate';
    }
  }

  localValidateLicense(key) {
    // Basic format validation for offline scenarios
    // Format: LISA-PRO-XXXXXXXX or LISA-TEAM-XXXXXXXX
    const proPattern = /^LISA-PRO-[A-Z0-9]{8}$/;
    const teamPattern = /^LISA-TEAM-[A-Z0-9]{8}$/;
    return proPattern.test(key) || teamPattern.test(key);
  }

  showLicenseStatus(type, icon, message) {
    const statusDiv = document.getElementById('licenseStatus');
    const statusIcon = document.getElementById('licenseStatusIcon');
    const statusText = document.getElementById('licenseStatusText');
    
    statusDiv.style.display = 'flex';
    statusDiv.className = `license-status ${type}`;
    statusIcon.textContent = icon;
    statusText.textContent = message;
  }

  updateTierBadge() {
    const tierBadge = document.getElementById('userTier');
    const upgradeBtn = document.getElementById('upgradeBtn');
    
    if (this.userTier === 'premium') {
      tierBadge.textContent = 'Premium';
      tierBadge.classList.add('premium');
      upgradeBtn.style.display = 'none';
    } else {
      tierBadge.textContent = 'Free';
      tierBadge.classList.remove('premium');
      upgradeBtn.style.display = 'inline-block';
    }
  }

  async resetExtensionData() {
    if (!confirm('Are you sure you want to reset all extension data? This will clear your license key and usage history.')) {
      return;
    }

    try {
      await chrome.storage.sync.clear();
      await chrome.storage.local.clear();
      
      this.userTier = 'free';
      this.usageStats = { exportsThisWeek: 0, importsThisWeek: 0 };
      
      // Reset UI
      document.getElementById('licenseKeyInput').value = '';
      document.getElementById('licenseStatus').style.display = 'none';
      this.updateTierDisplay();
      this.updateTierBadge();
      
      this.trackEvent('extension_data_reset');
      alert('Extension data has been reset.');
      
    } catch (error) {
      console.error('[LISA] Reset failed:', error);
      alert('Failed to reset data. Please try again.');
    }
  }

  // ============================================
  // SNAPSHOTS METHODS
  // ============================================

  async loadSnapshots() {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'getSnapshots' });
      if (response.success) {
        this.renderSnapshots(response.snapshots);
      }
    } catch (error) {
      console.error('[LISA] Failed to load snapshots:', error);
    }
  }

  renderSnapshots(snapshots) {
    const container = document.getElementById('snapshotsList');
    
    if (!snapshots || snapshots.length === 0) {
      container.innerHTML = '<p class="empty-state">No snapshots yet. Close an AI chat tab to auto-save.</p>';
      return;
    }

    container.innerHTML = snapshots.map(snap => `
      <div class="snapshot-item" data-id="${snap.id}">
        <div class="snapshot-info">
          <div class="snapshot-title">${this.escapeHtml(snap.title || snap.platform)}</div>
          <div class="snapshot-meta">${snap.platform} • ${this.formatTimeAgo(snap.savedAt)} • v${snap.version || 1}</div>
        </div>
        <div class="snapshot-actions">
          <button class="snapshot-btn history" data-root-id="${snap.rootId || snap.id}" title="Version History">📜</button>
          <button class="snapshot-btn download" data-id="${snap.id}" title="Download JSON">💾</button>
          <button class="snapshot-btn send" data-id="${snap.id}" title="Send to App">📤</button>
          <button class="snapshot-btn delete" data-id="${snap.id}" title="Delete">🗑️</button>
        </div>
      </div>
    `).join('');

    // Add event listeners
    container.querySelectorAll('.snapshot-btn.history').forEach(btn => {
      btn.addEventListener('click', (e) => this.showVersionHistory(e.target.dataset.rootId));
    });

    container.querySelectorAll('.snapshot-btn.download').forEach(btn => {
      btn.addEventListener('click', (e) => this.downloadSnapshot(e.target.dataset.id));
    });

    container.querySelectorAll('.snapshot-btn.send').forEach(btn => {
      btn.addEventListener('click', (e) => this.sendSnapshotToApp(e.target.dataset.id));
    });

    container.querySelectorAll('.snapshot-btn.delete').forEach(btn => {
      btn.addEventListener('click', (e) => this.deleteSnapshot(e.target.dataset.id));
    });
  }

  async setupAutoSaveToggle() {
    const toggle = document.getElementById('autoSaveToggle');
    
    try {
      const response = await chrome.runtime.sendMessage({ action: 'getAutoSaveEnabled' });
      if (response.success) {
        toggle.checked = response.enabled;
      }
    } catch (error) {
      console.error('[LISA] Failed to get auto-save status:', error);
    }

    toggle.addEventListener('change', async () => {
      try {
        await chrome.runtime.sendMessage({ 
          action: 'setAutoSaveEnabled', 
          enabled: toggle.checked 
        });
        this.trackEvent('auto_save_toggled', { enabled: toggle.checked });
      } catch (error) {
        console.error('[LISA] Failed to set auto-save:', error);
      }
    });
  }

  async setupChatSwitchToggle() {
    const toggle = document.getElementById('askOnChatSwitch');
    if (!toggle) return;
    
    try {
      const result = await chrome.storage.sync.get(['askOnChatSwitch']);
      toggle.checked = result.askOnChatSwitch !== false;
    } catch (error) {
      console.error('[LISA] Failed to get chat switch setting:', error);
    }

    toggle.addEventListener('change', async () => {
      try {
        await chrome.storage.sync.set({ askOnChatSwitch: toggle.checked });
        this.trackEvent('chat_switch_toggled', { enabled: toggle.checked });
      } catch (error) {
        console.error('[LISA] Failed to set chat switch setting:', error);
      }
    });
  }

  async downloadSnapshot(id) {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'getSnapshots' });
      const snapshot = response.snapshots.find(s => s.id === id);
      
      if (!snapshot) {
        alert('Snapshot not found');
        return;
      }

      // Create downloadable file
      const isLisaV = snapshot.format === 'lisa-v';
      let fileContent, mimeType, extension;
      
      if (isLisaV) {
        // LISA-V: output the raw JSONL content directly
        fileContent = snapshot.content;
        mimeType = 'application/jsonl';
        extension = 'jsonl';
      } else {
        // Standard format: JSON stringify the data
        const data = snapshot.raw || snapshot;
        fileContent = JSON.stringify(data, null, 2);
        mimeType = 'application/json';
        extension = 'json';
      }
      
      const blob = new Blob([fileContent], { type: mimeType });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = `lisa-${snapshot.platform}-${snapshot.id}.${extension}`;
      a.click();
      
      URL.revokeObjectURL(url);
      this.trackEvent('snapshot_downloaded', { platform: snapshot.platform });
    } catch (error) {
      console.error('[LISA] Failed to download snapshot:', error);
      alert('Failed to download');
    }
  }
  
  async sendSnapshotToApp(id) {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'getSnapshots' });
      const snapshot = response.snapshots.find(s => s.id === id);
      
      if (!snapshot) {
        alert('Snapshot not found');
        return;
      }

      // Get license key
      const storage = await chrome.storage.sync.get(['licenseKey']);
      if (!storage.licenseKey) {
        alert('Please add your license key in Settings first');
        return;
      }

      // Send to App API
      const appUrl = 'https://lisa-web-backend-production.up.railway.app';
      const apiResponse = await fetch(`${appUrl}/api/snapshots`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          license_key: storage.licenseKey,
          snapshot: snapshot.raw || snapshot
        })
      });

      const result = await apiResponse.json();

      if (result.success) {
        alert('✅ Sent to App! You now have ' + result.totalSnapshots + ' snapshots in your library.');
        this.trackEvent('snapshot_sent_to_app', { platform: snapshot.platform });
      } else {
        alert('❌ Failed: ' + (result.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('[LISA] Failed to send snapshot:', error);
      alert('Failed to send to App: ' + error.message);
    }
  }

  async deleteSnapshot(id) {
    if (!confirm('Delete this snapshot?')) return;
    
    try {
      await chrome.runtime.sendMessage({ action: 'deleteSnapshot', id });
      this.loadSnapshots(); // Refresh list
      this.trackEvent('snapshot_deleted');
    } catch (error) {
      console.error('[LISA] Failed to delete snapshot:', error);
    }
  }

  // Phase 6: Show version history for a conversation
  async showVersionHistory(rootId) {
    try {
      const response = await chrome.runtime.sendMessage({ 
        action: 'getVersionHistory', 
        rootId: rootId 
      });
      
      if (response.success && response.history.length > 0) {
        const historyHtml = response.history.map(v => `
          <div class="history-item">
            <span>v${v.version || 1} - ${this.formatTimeAgo(v.savedAt)}</span>
            <span class="hash">${v.hash ? v.hash.slice(0, 8) : 'N/A'}</span>
          </div>
        `).join('');
        
        alert(`Version History (${response.history.length} versions):\n\n` + 
          response.history.map(v => `v${v.version || 1} - ${new Date(v.savedAt).toLocaleString()}`).join('\n'));
      } else {
        alert('No version history found (this is v1)');
      }
    } catch (error) {
      console.error('[LISA] Failed to get version history:', error);
      alert('Failed to load history');
    }
  }

  formatTimeAgo(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const seconds = Math.floor((now - date) / 1000);
    
    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  
  openFeedback() {
    chrome.tabs.create({ url: 'https://sat-chain.com/lisa-feedback' });
  }

  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  }

  trackEvent(eventName, data = {}) {
    console.log('[LISA] Event:', eventName, data);
    chrome.runtime.sendMessage({
      action: 'trackEvent',
      event: eventName,
      data: data
    }).catch(() => {
      // Ignore tracking errors
    });
  }
}

// Initialize popup when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new LISAPopup();
});
