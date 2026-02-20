/**
 * LISA Search Engine
 * Smart search across saved conversations with filters and ranking
 * Version: 0.49-beta
 */

class SearchEngine {
  constructor() {
    this.conversations = [];
    this.initialized = false;
  }

  /**
   * Initialize search engine by loading all conversations
   */
  async init() {
    try {
      const result = await chrome.storage.local.get(['conversations']);
      this.conversations = result.conversations || [];
      this.initialized = true;
      console.log(`[LISA Search] Indexed ${this.conversations.length} conversations`);
    } catch (error) {
      console.error('[LISA Search] Init error:', error);
      this.conversations = [];
    }
  }

  /**
   * Search conversations with filters
   * @param {string} query - Search query
   * @param {Object} filters - { platform, dateRange, minScore }
   * @returns {Array} - Ranked search results
   */
  async search(query, filters = {}) {
    if (!this.initialized) {
      await this.init();
    }

    // If no query, return all (optionally filtered)
    if (!query || query.trim().length === 0) {
      return this.applyFilters(this.conversations, filters);
    }

    const normalizedQuery = query.toLowerCase().trim();
    const queryTerms = normalizedQuery.split(/\s+/);
    
    // Search and score all conversations
    const results = this.conversations.map(conversation => {
      const score = this.scoreConversation(conversation, normalizedQuery, queryTerms);
      return {
        conversation,
        score,
        preview: this.generatePreview(conversation, normalizedQuery, queryTerms)
      };
    });

    // Filter by minimum score
    const minScore = filters.minScore || 0.1;
    let filteredResults = results.filter(r => r.score > minScore);

    // Apply additional filters
    filteredResults = this.applyFilters(filteredResults, filters);

    // Sort by score (descending)
    filteredResults.sort((a, b) => b.score - a.score);

    return filteredResults;
  }

  /**
   * Score a conversation's relevance to the query
   */
  scoreConversation(conversation, query, queryTerms) {
    let score = 0;
    const weights = {
      titleMatch: 3.0,
      platformMatch: 2.0,
      messageMatch: 1.0,
      metadataMatch: 1.5
    };

    // Check title/platform
    const platform = (conversation.platform || '').toLowerCase();
    const title = this.getConversationTitle(conversation).toLowerCase();
    
    if (title.includes(query)) score += weights.titleMatch;
    if (platform.includes(query)) score += weights.platformMatch;

    // Check each message
    const messages = conversation.messages || [];
    let messageMatches = 0;
    
    messages.forEach(message => {
      const content = (message.content || '').toLowerCase();
      const role = (message.role || '').toLowerCase();
      
      // Exact query match
      if (content.includes(query)) {
        messageMatches += 2;
      }
      
      // Term matches
      queryTerms.forEach(term => {
        if (content.includes(term)) {
          messageMatches += 0.5;
        }
        if (role.includes(term)) {
          messageMatches += 0.3;
        }
      });
    });

    score += Math.min(messageMatches * weights.messageMatch, 10); // Cap at 10

    // Check metadata
    const metadata = conversation.metadata || {};
    const metadataStr = JSON.stringify(metadata).toLowerCase();
    if (metadataStr.includes(query)) {
      score += weights.metadataMatch;
    }

    // Normalize score (0-1 range typical, but can exceed)
    return score / 10;
  }

  /**
   * Generate preview snippet with highlighted matches
   */
  generatePreview(conversation, query, queryTerms) {
    const messages = conversation.messages || [];
    
    // Find first message with query match
    for (let msg of messages) {
      const content = msg.content || '';
      const lowerContent = content.toLowerCase();
      
      if (lowerContent.includes(query) || queryTerms.some(term => lowerContent.includes(term))) {
        // Extract snippet around match
        const matchIndex = lowerContent.indexOf(query);
        let snippet;
        
        if (matchIndex >= 0) {
          const start = Math.max(0, matchIndex - 50);
          const end = Math.min(content.length, matchIndex + query.length + 100);
          snippet = content.substring(start, end);
          if (start > 0) snippet = '...' + snippet;
          if (end < content.length) snippet = snippet + '...';
        } else {
          // No exact match, just take beginning
          snippet = content.substring(0, 150);
          if (content.length > 150) snippet += '...';
        }
        
        return {
          text: snippet,
          role: msg.role,
          hasMatch: true
        };
      }
    }

    // No match found, return first message preview
    if (messages.length > 0) {
      const firstMsg = messages[0];
      let text = (firstMsg.content || '').substring(0, 150);
      if (firstMsg.content && firstMsg.content.length > 150) text += '...';
      
      return {
        text: text,
        role: firstMsg.role,
        hasMatch: false
      };
    }

    return {
      text: 'No content available',
      role: 'system',
      hasMatch: false
    };
  }

  /**
   * Apply filters to results
   */
  applyFilters(results, filters) {
    let filtered = [...results];

    // Platform filter
    if (filters.platform && filters.platform !== 'all') {
      filtered = filtered.filter(r => {
        const conv = r.conversation || r;
        const platform = (conv.platform || '').toLowerCase();
        return platform === filters.platform.toLowerCase();
      });
    }

    // Date range filter
    if (filters.dateRange) {
      const now = Date.now();
      const ranges = {
        today: 24 * 60 * 60 * 1000,
        week: 7 * 24 * 60 * 60 * 1000,
        month: 30 * 24 * 60 * 60 * 1000,
        all: Infinity
      };
      
      const maxAge = ranges[filters.dateRange] || Infinity;
      
      filtered = filtered.filter(r => {
        const conv = r.conversation || r;
        const timestamp = conv.timestamp || conv.metadata?.timestamp || 0;
        return (now - timestamp) <= maxAge;
      });
    }

    return filtered;
  }

  /**
   * Get conversation title
   */
  getConversationTitle(conversation) {
    // Try various title sources
    if (conversation.title) return conversation.title;
    if (conversation.metadata?.title) return conversation.metadata.title;
    
    // Generate from first message
    const messages = conversation.messages || [];
    if (messages.length > 0) {
      const firstMsg = messages[0];
      const content = firstMsg.content || '';
      return content.substring(0, 50) + (content.length > 50 ? '...' : '');
    }
    
    return 'Untitled Conversation';
  }

  /**
   * Get search suggestions based on query
   */
  getSuggestions(query, limit = 5) {
    if (!query || query.length < 2) return [];
    
    const normalizedQuery = query.toLowerCase();
    const suggestions = new Set();

    // Platform suggestions
    const platforms = ['chatgpt', 'claude', 'gemini', 'copilot', 'deepseek', 'grok', 'perplexity', 'mistral'];
    platforms.forEach(platform => {
      if (platform.includes(normalizedQuery)) {
        suggestions.add(platform);
      }
    });

    // Common search terms from conversations
    this.conversations.forEach(conv => {
      const title = this.getConversationTitle(conv).toLowerCase();
      if (title.includes(normalizedQuery)) {
        suggestions.add(title.substring(0, 50));
      }
    });

    return Array.from(suggestions).slice(0, limit);
  }

  /**
   * Get search statistics
   */
  getStats() {
    return {
      totalConversations: this.conversations.length,
      platforms: this.getPlatformCounts(),
      latestTimestamp: this.getLatestTimestamp()
    };
  }

  /**
   * Get conversation count by platform
   */
  getPlatformCounts() {
    const counts = {};
    this.conversations.forEach(conv => {
      const platform = conv.platform || 'unknown';
      counts[platform] = (counts[platform] || 0) + 1;
    });
    return counts;
  }

  /**
   * Get latest conversation timestamp
   */
  getLatestTimestamp() {
    if (this.conversations.length === 0) return 0;
    
    return Math.max(...this.conversations.map(conv => 
      conv.timestamp || conv.metadata?.timestamp || 0
    ));
  }

  /**
   * Refresh index (reload conversations from storage)
   */
  async refresh() {
    await this.init();
  }
}

// Export for use in other modules
if (typeof window !== 'undefined') {
  window.SearchEngine = SearchEngine;
}
