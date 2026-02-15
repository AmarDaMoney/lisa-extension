// LISA Core - Semantic Compression Engine
// Background Service Worker (Manifest V3)
// v0.45 - Version update

class LISACompressor {
  constructor() {
    this.compressionRatio = null;
  }

  // Semantic tokenization - identifies key concepts and structures
  tokenize(text) {
    const tokens = {
      entities: this.extractEntities(text),
      concepts: this.extractConcepts(text),
      relationships: this.extractRelationships(text),
      intent: this.extractIntent(text),
      context: this.extractContext(text)
    };
    return tokens;
  }

  extractEntities(text) {
    const entities = [];
    
    const patterns = {
      urls: /https?:\/\/[^\s]+/g,
      emails: /[\w.-]+@[\w.-]+\.\w+/g,
      mentions: /@\w+/g,
      hashtags: /#\w+/g,
      technicalTerms: /\b[A-Z][A-Za-z0-9]+(?:[A-Z][a-z]+)+\b/g,
      acronyms: /\b[A-Z]{2,}\b/g
    };

    for (const [type, pattern] of Object.entries(patterns)) {
      const matches = text.match(pattern) || [];
      if (matches.length > 0) {
        entities.push({ type, values: [...new Set(matches)] });
      }
    }

    return entities;
  }

  extractConcepts(text) {
    const words = text.toLowerCase().split(/\s+/);
    const stopWords = new Set(['the', 'is', 'at', 'which', 'on', 'a', 'an', 'and', 'or', 'but', 'in', 'with', 'to', 'for', 'of', 'as', 'by', 'from']);
    
    const wordFreq = {};
    words.forEach(word => {
      word = word.replace(/[^\w]/g, '');
      if (word.length > 3 && !stopWords.has(word)) {
        wordFreq[word] = (wordFreq[word] || 0) + 1;
      }
    });

    const sorted = Object.entries(wordFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    return sorted.map(([word, freq]) => ({ term: word, weight: freq }));
  }

  extractRelationships(text) {
    const relationships = [];
    
    const relationPatterns = [
      { pattern: /(\w+)\s+is\s+(\w+)/gi, type: 'is-a' },
      { pattern: /(\w+)\s+(?:relates? to|connected to)\s+(\w+)/gi, type: 'relates-to' },
      { pattern: /(\w+)\s+(?:causes?|leads? to)\s+(\w+)/gi, type: 'causes' }
    ];

    relationPatterns.forEach(({ pattern, type }) => {
      const matches = [...text.matchAll(pattern)];
      matches.forEach(match => {
        relationships.push({
          type,
          subject: match[1],
          object: match[2]
        });
      });
    });

    return relationships;
  }

  extractIntent(text) {
    const intents = {
      question: /\?|^(?:what|how|why|when|where|who|can|could|would|should)/i.test(text),
      instruction: /^(?:please|could you|can you|would you|let's|make|create|build)/i.test(text),
      statement: true,
      agreement: /^(?:yes|sure|okay|agreed|right|correct)/i.test(text),
      disagreement: /^(?:no|not|incorrect|wrong|disagree)/i.test(text)
    };

    return Object.entries(intents)
      .filter(([, value]) => value)
      .map(([key]) => key)[0] || 'statement';
  }

  extractContext(text) {
    return {
      hasCode: /```|`\w+`/.test(text),
      hasUrls: /https?:\/\//.test(text),
      hasNumbers: /\d+/.test(text),
      length: text.length,
      sentences: text.split(/[.!?]+/).length
    };
  }

  compress(conversation) {
    const compressed = {
      metadata: {
        lisaVersion: '0.45',
        platform: conversation.platform,
        conversationId: conversation.conversationId,
        originalUrl: conversation.url,
        compressedAt: new Date().toISOString(),
        messageCount: conversation.messageCount
      },
      semanticTokens: []
    };

    conversation.messages.forEach(message => {
      const tokens = this.tokenize(message.content);
      
      compressed.semanticTokens.push({
        role: message.role,
        index: message.index,
        tokens: tokens,
        summary: this.summarize(message.content),
        originalLength: message.content.length
      });
    });

    const originalSize = JSON.stringify(conversation).length;
    const compressedSize = JSON.stringify(compressed).length;
    compressed.metadata.compressionRatio = (originalSize / compressedSize).toFixed(2);

    return compressed;
  }

  summarize(text) {
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    
    if (sentences.length <= 2) {
      return text;
    }

    return `${sentences[0]}... ${sentences[sentences.length - 1]}`;
  }

  reconstruct(compressed) {
    const messages = compressed.semanticTokens.map(token => {
      let content = token.summary;
      
      if (token.tokens.entities) {
        token.tokens.entities.forEach(entity => {
          content += `\n[${entity.type}: ${entity.values.join(', ')}]`;
        });
      }

      return {
        role: token.role,
        content: content,
        reconstructed: true
      };
    });

    return {
      platform: compressed.metadata.platform,
      conversationId: compressed.metadata.conversationId,
      messages: messages,
      metadata: {
        originalUrl: compressed.metadata.originalUrl,
        reconstructedAt: new Date().toISOString(),
        compressionRatio: compressed.metadata.compressionRatio
      }
    };
  }
}

class LISAHasher {
  constructor() {
    this.algorithm = 'SHA-256';
  }

  async generateHash(compressedData) {
    const dataString = JSON.stringify(compressedData);
    const encoder = new TextEncoder();
    const data = encoder.encode(dataString);

    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    return {
      hash: hashHex,
      algorithm: this.algorithm,
      generatedAt: new Date().toISOString(),
      dataSize: dataString.length
    };
  }

  async verify(compressedData, expectedHash) {
    const generated = await this.generateHash(compressedData);
    return generated.hash === expectedHash;
  }
}

// Initialize engines
const compressor = new LISACompressor();
const hasher = new LISAHasher();

// ============================================
// AUTO-SNAPSHOT MANAGER
// ============================================

class SnapshotManager {
  constructor() {
    this.MAX_SNAPSHOTS = 20;
    this.STORAGE_KEY = 'lisaSnapshots';
    this.SETTINGS_KEY = 'lisaAutoSaveSettings';
  }

  async isAutoSaveEnabled() {
    const data = await chrome.storage.sync.get(this.SETTINGS_KEY);
    const settings = data[this.SETTINGS_KEY] || { enabled: true };
    return settings.enabled;
  }

  async setAutoSaveEnabled(enabled) {
    await chrome.storage.sync.set({ [this.SETTINGS_KEY]: { enabled } });
  }

  async saveSnapshot(conversation, source = 'auto') {
    try {
      const data = await chrome.storage.local.get(this.STORAGE_KEY);
      const snapshots = data[this.STORAGE_KEY] || [];

      // Phase 6: Check if this is an update to existing conversation (same URL)
      const existing = snapshots.find(s => s.url === conversation.url);

      // Store RAW conversation (not compressed) so App can compress with user's settings
      const snapshot = {
        id: 'snap-' + Date.now(),
        platform: conversation.platform,
        url: conversation.url,
        title: conversation.title || 'Untitled',
        messageCount: conversation.messageCount,
        savedAt: new Date().toISOString(),
        source: source,
        raw: conversation // Store full raw conversation
      };

      // Phase 6: Add versioning fields
      if (existing) {
        snapshot.version = (existing.version || 1) + 1;
        snapshot.parentId = existing.id;
        snapshot.rootId = existing.rootId || existing.id;
      } else {
        snapshot.version = 1;
        snapshot.parentId = null;
        snapshot.rootId = snapshot.id;
      }

      // Phase 6: Generate content hash
      snapshot.hash = await this.hashContent(JSON.stringify(conversation));

      snapshots.unshift(snapshot);

      if (snapshots.length > this.MAX_SNAPSHOTS) {
        snapshots.length = this.MAX_SNAPSHOTS;
      }

      await chrome.storage.local.set({ [this.STORAGE_KEY]: snapshots });

      console.log(`[LISA] Snapshot saved: ${snapshot.platform} - ${snapshot.title} (v${snapshot.version})`);
      return snapshot;
    } catch (error) {
      console.error('[LISA] Failed to save snapshot:', error);
      throw error;
    }
  }

  async getSnapshots() {
    const data = await chrome.storage.local.get(this.STORAGE_KEY);
    return data[this.STORAGE_KEY] || [];
  }

  async getSnapshot(id) {
    const snapshots = await this.getSnapshots();
    return snapshots.find(s => s.id === id);
  }

  async deleteSnapshot(id) {
    const data = await chrome.storage.local.get(this.STORAGE_KEY);
    const snapshots = data[this.STORAGE_KEY] || [];
    const filtered = snapshots.filter(s => s.id !== id);
    await chrome.storage.local.set({ [this.STORAGE_KEY]: filtered });
  }

  async clearAllSnapshots() {
    await chrome.storage.local.remove(this.STORAGE_KEY);
  }

  // Phase 6: Generate content hash for version integrity
  async hashContent(content) {
    const encoder = new TextEncoder();
    const data = encoder.encode(content);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
  }

  // Phase 6: Get version history for a conversation
  async getVersionHistory(rootId) {
    const snapshots = await this.getSnapshots();
    return snapshots
      .filter(s => s.rootId === rootId || s.id === rootId)
      .sort((a, b) => (a.version || 1) - (b.version || 1));
  }
}

const snapshotManager = new SnapshotManager();

// Track ready content scripts
const readyTabs = new Map();

// ============================================
// MESSAGE HANDLERS
// ============================================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Handle parser ready signals
  if (request.action === 'parserReady') {
    if (sender.tab) {
      readyTabs.set(sender.tab.id, {
        platform: request.platform,
        timestamp: Date.now()
      });
      console.log(`[LISA] Parser ready on tab ${sender.tab.id}: ${request.platform}`);
    }
    sendResponse({ success: true });
    return false;
  }

  // Handle compression
  if (request.action === 'compress') {
    try {
      const compressed = compressor.compress(request.data);
      sendResponse({ success: true, compressed });
    } catch (error) {
      console.error('[LISA] Compression error:', error);
      sendResponse({ success: false, error: error.message });
    }
    return false;
  }
  
  // Handle reconstruction
  if (request.action === 'reconstruct') {
    try {
      const reconstructed = compressor.reconstruct(request.data);
      sendResponse({ success: true, reconstructed });
    } catch (error) {
      console.error('[LISA] Reconstruction error:', error);
      sendResponse({ success: false, error: error.message });
    }
    return false;
  }
  
  // Handle hash generation (async)
  if (request.action === 'generateHash') {
    hasher.generateHash(request.data).then(hashData => {
      sendResponse({ success: true, hashData });
    }).catch(error => {
      console.error('[LISA] Hash generation error:', error);
      sendResponse({ success: false, error: error.message });
    });
    return true; // Keep channel open for async
  }
  
  // Handle hash verification (async)
  if (request.action === 'verifyHash') {
    hasher.verify(request.data, request.hash).then(isValid => {
      sendResponse({ success: true, isValid });
    }).catch(error => {
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }
  
  // Handle selected text compression
  if (request.action === 'compressSelectedText') {
    try {
      const snippet = {
        platform: 'text-selection',
        conversationId: 'snippet-' + Date.now(),
        url: request.url,
        title: request.title,
        extractedAt: new Date().toISOString(),
        messageCount: 1,
        messages: [{
          role: 'text-snippet',
          content: request.text,
          index: 0,
          timestamp: new Date().toISOString()
        }]
      };
      
      const compressed = compressor.compress(snippet);
      sendResponse({ success: true, compressed });
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
    return false;
  }

  // Handle floating button save
  if (request.action === 'extractAndSave') {
    (async () => {
      try {
        // Get the active tab
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) {
          sendResponse({ success: false, error: 'No active tab' });
          return;
        }

        // Extract conversation from the tab
        let extractResponse;
        try {
          extractResponse = await chrome.tabs.sendMessage(tab.id, { action: 'extractConversation' });
        } catch (err) {
          sendResponse({ success: false, error: 'Could not connect to page. Try refreshing.' });
          return;
        }
        
        if (!extractResponse || !extractResponse.success) {
          sendResponse({ success: false, error: extractResponse?.error || 'Extraction failed' });
          return;
        }

        // Ensure required fields exist
        const data = extractResponse.data || {};
        data.platform = data.platform || new URL(tab.url).hostname;
        data.url = data.url || tab.url;
        data.title = data.title || tab.title || 'Untitled';
        data.messageCount = data.messageCount || (data.messages?.length || 0);
        // Cache for auto-save on tab close
        conversationCache.set(tab.id, JSON.parse(JSON.stringify(data)));

        // Save snapshot
        const snapshot = await snapshotManager.saveSnapshot(data, 'floating-button');
        sendResponse({ success: true, snapshot });
        
      } catch (error) {
        console.error('[LISA] Extract and save error:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true; // Keep channel open for async
  }
  

  // Handle LISA-V save
  if (request.action === "saveLisaV") {
    (async () => {
      try {
        const data = request.data;
        const snapshot = {
          id: "lisav-" + Date.now(),
          syncId: "sync-" + Date.now(),
          format: "lisa-v",
          content: data.content,
          stats: data.stats,
          platform: data.platform,
          url: data.url,
          title: data.title || "LISA-V Capture",
          timestamp: new Date().toISOString(),
          source: "floating-button"
        };
        await snapshotManager.saveSnapshot(snapshot, "floating-button-lisav");
        sendResponse({ success: true, snapshot });
      } catch (error) {
        console.error("[LISA] LISA-V save error:", error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }
  // Handle snapshot operations
  if (request.action === 'getSnapshots') {
    snapshotManager.getSnapshots().then(snapshots => {
      sendResponse({ success: true, snapshots });
    }).catch(error => {
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }

  // Phase 6: Get version history for a conversation
  if (request.action === 'getVersionHistory') {
    snapshotManager.getVersionHistory(request.rootId).then(history => {
      sendResponse({ success: true, history });
    }).catch(error => {
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }

  if (request.action === 'deleteSnapshot') {
    snapshotManager.deleteSnapshot(request.id).then(() => {
      sendResponse({ success: true });
    }).catch(error => {
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }

  if (request.action === 'clearSnapshots') {
    snapshotManager.clearAllSnapshots().then(() => {
      sendResponse({ success: true });
    }).catch(error => {
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }

  if (request.action === 'getAutoSaveEnabled') {
    snapshotManager.isAutoSaveEnabled().then(enabled => {
      sendResponse({ success: true, enabled });
    }).catch(error => {
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }

  if (request.action === 'setAutoSaveEnabled') {
    snapshotManager.setAutoSaveEnabled(request.enabled).then(() => {
      sendResponse({ success: true });
    }).catch(error => {
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }
  
  // Handle analytics tracking
  if (request.action === 'trackEvent') {
    console.log('[LISA] Event:', request.event, request.data);
    // Future: send to analytics backend
    sendResponse({ success: true });
    return false;
  }
  
  return false;
});

// ============================================
// CONTEXT MENU SETUP
// ============================================

function createContextMenus() {
  // Remove existing menus first to avoid duplicates
  chrome.contextMenus.removeAll(() => {
    // Export selected text to LISA Core
    chrome.contextMenus.create({
      id: 'export-selection',
      title: '📤 Export Selection to LISA Core',
      contexts: ['selection']
    }, () => {
      if (chrome.runtime.lastError) {
        console.error('[LISA] Failed to create export-selection menu:', chrome.runtime.lastError);
      }
    });
    
    console.log('[LISA] Context menus created');
  });
}

// Create menus on install/update
chrome.runtime.onInstalled.addListener((details) => {
  console.log('[LISA] Extension installed/updated:', details.reason);
  createContextMenus();
});

// Also create menus on service worker startup (in case of restart)
chrome.runtime.onStartup.addListener(() => {
  console.log('[LISA] Service worker started');
  createContextMenus();
});

// ============================================
// CONTEXT MENU CLICK HANDLERS
// ============================================

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab || !tab.id) {
    console.error('[LISA] No valid tab for context menu action');
    showNotification('Error', '❌ No active tab found');
    return;
  }

  if (info.menuItemId === 'export-selection') {
    await handleExportSelection(info, tab);
  }
});

async function handleExportSelection(info, tab) {
  try {
    const selectedText = info.selectionText;
    
    if (!selectedText || selectedText.trim().length === 0) {
      showNotification('LISA Core', '❌ No text selected');
      return;
    }
    
    // Create snippet data
    const snippet = {
      platform: 'text-selection',
      conversationId: 'snippet-' + Date.now(),
      url: info.pageUrl,
      title: tab.title || 'Selected Text',
      extractedAt: new Date().toISOString(),
      messageCount: 1,
      messages: [{
        role: 'text-snippet',
        content: selectedText,
        index: 0,
        timestamp: new Date().toISOString()
      }]
    };
    
    const compressed = compressor.compress(snippet);
    
    // Download with Save As dialog
    await downloadCompressedData(compressed, 'snippet');
    
    // Show notification
    showNotification('LISA Core', `✅ Selection saved! ${selectedText.length} chars → ${compressed.metadata.compressionRatio}:1 ratio`);
    
  } catch (error) {
    console.error('[LISA] Export selection error:', error);
    showNotification('LISA Core', `❌ Failed: ${error.message}`);
  }
}

// ============================================
// HELPER FUNCTIONS
// ============================================

async function ensureContentScriptLoaded(tab) {
  // Check if parser is already ready for this tab
  const tabInfo = readyTabs.get(tab.id);
  if (tabInfo && (Date.now() - tabInfo.timestamp) < 300000) { // 5 min cache
    return true;
  }
  
  // Try to inject the appropriate content script
  try {
    // First try sending a ping
    const pingResponse = await sendMessageWithTimeout(tab.id, { action: 'ping' }, 1000).catch(() => null);
    if (pingResponse) {
      return true;
    }
    
    // Determine which script to inject based on URL
    const url = tab.url || '';
    let scriptFile = 'src/content/universal-parser.js';
    
    if (url.includes('claude.ai')) scriptFile = 'src/content/claude-parser.js';
    else if (url.includes('chatgpt.com')) scriptFile = 'src/content/chatgpt-parser.js';
    else if (url.includes('gemini.google.com')) scriptFile = 'src/content/gemini-parser.js';
    else if (url.includes('grok.com')) scriptFile = 'src/content/grok-parser.js';
    else if (url.includes('chat.mistral.ai')) scriptFile = 'src/content/mistral-parser.js';
    else if (url.includes('chat.deepseek.com')) scriptFile = 'src/content/deepseek-parser.js';
    else if (url.includes('copilot.microsoft.com')) scriptFile = 'src/content/copilot-parser.js';
    else if (url.includes('perplexity.ai')) scriptFile = 'src/content/perplexity-parser.js';
    
    // Inject the script
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: [scriptFile]
    });
    
    // Wait a moment for script to initialize
    await new Promise(resolve => setTimeout(resolve, 500));
    
    return true;
  } catch (error) {
    console.error('[LISA] Failed to inject content script:', error);
    throw new Error('Cannot access this page. Try refreshing.');
  }
}

function sendMessageWithTimeout(tabId, message, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Request timed out'));
    }, timeout);
    
    chrome.tabs.sendMessage(tabId, message, (response) => {
      clearTimeout(timer);
      
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

async function downloadCompressedData(compressed, prefix = null) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const platform = (compressed.metadata.platform || 'unknown').replace(/[.\s()]/g, '-');
  const filePrefix = prefix || platform;
  const filename = `lisa-${filePrefix}-${timestamp}.json`;
  
  const dataStr = JSON.stringify(compressed, null, 2);
  
  // Try blob URL first, fall back to data URL if needed
  let downloadUrl;
  let needsRevoke = false;
  
  try {
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    downloadUrl = URL.createObjectURL(dataBlob);
    needsRevoke = true;
  } catch (blobError) {
    console.warn('[LISA] Blob URL failed, using data URL:', blobError);
    // Fallback to data URL
    downloadUrl = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
  }
  
  return new Promise((resolve, reject) => {
    chrome.downloads.download({
      url: downloadUrl,
      filename: filename,
      saveAs: true
    }, (downloadId) => {
      if (needsRevoke) {
        try { URL.revokeObjectURL(downloadUrl); } catch (e) { /* ignore */ }
      }
      
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (downloadId) {
        resolve(downloadId);
      } else {
        reject(new Error('Download failed'));
      }
    });
  });
}

function showNotification(title, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: '/public/icon48.png',
    title: title,
    message: message
  });
}

// Clean up old tab entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [tabId, info] of readyTabs.entries()) {
    if (now - info.timestamp > 600000) { // 10 minutes
      readyTabs.delete(tabId);
    }
  }
}, 60000);

// ============================================
// AUTO-SNAPSHOT ON TAB CLOSE
// ============================================

// Track tabs with AI platforms for auto-save
const aiPlatformTabs = new Map();
const conversationCache = new Map(); // Cache last extraction per tab

// Detect when user navigates to AI platform
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    const aiPlatforms = [
      'claude.ai',
      'chatgpt.com',
      'gemini.google.com',
      'grok.com',
      'chat.mistral.ai',
      'chat.deepseek.com',
      'copilot.microsoft.com',
      'perplexity.ai'
    ];
    
    const isAIPlatform = aiPlatforms.some(p => tab.url.includes(p));
    
    if (isAIPlatform) {
      aiPlatformTabs.set(tabId, {
        url: tab.url,
        title: tab.title,
        platform: aiPlatforms.find(p => tab.url.includes(p)),
        lastSeen: Date.now()
      });
    }
  }
});

// Auto-save when AI platform tab is closed
chrome.tabs.onRemoved.addListener(async (tabId) => {
  readyTabs.delete(tabId);
  
  const tabInfo = aiPlatformTabs.get(tabId);
  if (!tabInfo) return;
  
  aiPlatformTabs.delete(tabId);
  
  // Check if auto-save is enabled
  const autoSaveEnabled = await snapshotManager.isAutoSaveEnabled();
  if (!autoSaveEnabled) {
    console.log('[LISA] Auto-save disabled, skipping snapshot');
    return;
  }
  
  try {
    // Try to get conversation from the tab before it fully closes
    // Note: This may not always work if tab is already gone
    console.log(`[LISA] Tab closed: ${tabInfo.platform} - attempting auto-save`);
    
    // Check cache for last extracted conversation
    const cachedData = conversationCache.get(tabId);
    conversationCache.delete(tabId); // Clean up
    
    let snapshot;
    if (cachedData && cachedData.messages && cachedData.messages.length > 0) {
      snapshot = {
        ...cachedData,
        extractedAt: new Date().toISOString(),
        note: "Tab closed - restored from cache"
      };
    } else {
      snapshot = {
        platform: tabInfo.platform,
        url: tabInfo.url,
        title: tabInfo.title,
        messageCount: 0,
        messages: [],
        extractedAt: new Date().toISOString(),
        note: "Tab closed - metadata only. Use manual export for full conversation."
      };
    }
    
    await snapshotManager.saveSnapshot(snapshot, 'auto-close');
    showNotification('LISA Auto-Save', `📸 Saved: ${tabInfo.title || tabInfo.platform}`);
    
  } catch (error) {
    console.error('[LISA] Auto-save failed:', error);
  }
});

console.log('[LISA] Core compression engine initialized v0.45');