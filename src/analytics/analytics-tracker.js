/**
 * LISA Analytics Tracker
 * Tracks usage patterns, export stats, and compression savings
 * Version: 0.49-beta
 */

class AnalyticsTracker {
  constructor() {
    this.storageKey = 'lisa_analytics';
    this.initialized = false;
  }

  /**
   * Initialize analytics with default values
   */
  async init() {
    const data = await this.getData();
    if (!data.initialized) {
      await this.reset();
    }
    this.initialized = true;
  }

  /**
   * Get current analytics data
   */
  async getData() {
    try {
      const result = await chrome.storage.local.get(this.storageKey);
      return result[this.storageKey] || this.getDefaultData();
    } catch (error) {
      console.error('Analytics getData error:', error);
      return this.getDefaultData();
    }
  }

  /**
   * Default analytics structure
   */
  getDefaultData() {
    return {
      initialized: false,
      firstUsed: null,
      lastUsed: null,
      conversations: {
        total: 0,
        byPlatform: {
          chatgpt: 0,
          claude: 0,
          copilot: 0,
          gemini: 0,
          deepseek: 0,
          grok: 0,
          perplexity: 0,
          mistral: 0
        }
      },
      exports: {
        total: 0,
        byFormat: {
          json: 0,
          markdown: 0,
          text: 0
        }
      },
      compression: {
        totalOriginalSize: 0,
        totalCompressedSize: 0,
        averageRatio: 0
      },
      features: {
        keyboardShortcuts: 0,
        templates: 0,
        floatingButton: 0,
        quickExtract: 0
      },
      timeline: {
        thisWeek: 0,
        thisMonth: 0,
        allTime: 0
      }
    };
  }

  /**
   * Reset all analytics data
   */
  async reset() {
    const data = this.getDefaultData();
    data.initialized = true;
    data.firstUsed = new Date().toISOString();
    data.lastUsed = new Date().toISOString();
    await this.saveData(data);
  }

  /**
   * Save analytics data
   */
  async saveData(data) {
    try {
      await chrome.storage.local.set({ [this.storageKey]: data });
    } catch (error) {
      console.error('Analytics saveData error:', error);
    }
  }

  /**
   * Track conversation capture
   */
  async trackConversation(platform, characterCount = 0) {
    const data = await this.getData();
    
    // Update conversation counts
    data.conversations.total++;
    if (data.conversations.byPlatform[platform] !== undefined) {
      data.conversations.byPlatform[platform]++;
    }
    
    // Update timeline
    data.timeline.allTime++;
    data.timeline.thisWeek++;
    data.timeline.thisMonth++;
    
    // Update last used
    data.lastUsed = new Date().toISOString();
    
    await this.saveData(data);
  }

  /**
   * Track export action
   */
  async trackExport(format, originalSize, compressedSize) {
    const data = await this.getData();
    
    // Update export counts
    data.exports.total++;
    if (data.exports.byFormat[format] !== undefined) {
      data.exports.byFormat[format]++;
    }
    
    // Update compression stats
    if (originalSize && compressedSize) {
      data.compression.totalOriginalSize += originalSize;
      data.compression.totalCompressedSize += compressedSize;
      
      // Calculate average compression ratio
      if (data.compression.totalOriginalSize > 0) {
        data.compression.averageRatio = 
          ((1 - (data.compression.totalCompressedSize / data.compression.totalOriginalSize)) * 100).toFixed(1);
      }
    }
    
    await this.saveData(data);
  }

  /**
   * Track feature usage
   */
  async trackFeature(featureName) {
    const data = await this.getData();
    
    if (data.features[featureName] !== undefined) {
      data.features[featureName]++;
    }
    
    await this.saveData(data);
  }

  /**
   * Get top platforms
   */
  async getTopPlatforms(limit = 3) {
    const data = await this.getData();
    const platforms = Object.entries(data.conversations.byPlatform)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
    
    return platforms;
  }

  /**
   * Get summary statistics
   */
  async getSummary() {
    const data = await this.getData();
    const topPlatforms = await this.getTopPlatforms(3);
    
    return {
      totalConversations: data.conversations.total,
      totalExports: data.exports.total,
      compressionSavings: data.compression.averageRatio,
      topPlatforms: topPlatforms,
      mostUsedFormat: this.getMostUsedFormat(data.exports.byFormat),
      daysSinceFirstUse: this.getDaysSince(data.firstUsed),
      timeline: data.timeline
    };
  }

  /**
   * Get most used export format
   */
  getMostUsedFormat(formats) {
    const entries = Object.entries(formats);
    if (entries.length === 0) return 'json';
    
    const sorted = entries.sort((a, b) => b[1] - a[1]);
    return sorted[0][0];
  }

  /**
   * Calculate days since date
   */
  getDaysSince(dateString) {
    if (!dateString) return 0;
    
    const date = new Date(dateString);
    const now = new Date();
    const diffTime = Math.abs(now - date);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    return diffDays;
  }

  /**
   * Reset weekly stats (should be called via background job)
   */
  async resetWeeklyStats() {
    const data = await this.getData();
    data.timeline.thisWeek = 0;
    await this.saveData(data);
  }

  /**
   * Reset monthly stats (should be called via background job)
   */
  async resetMonthlyStats() {
    const data = await this.getData();
    data.timeline.thisMonth = 0;
    await this.saveData(data);
  }
}

// Export for use in other modules
if (typeof window !== 'undefined') {
  window.AnalyticsTracker = AnalyticsTracker;
}
