// LISA-V Parser - Verbatim conversation capture with code separation
// Outputs JSONL format for App compression

class LisaVParser {
  constructor() {
    this.blocks = [];
  }

  // SHA-256 hash for code provenance
  async sha256(content) {
    const encoder = new TextEncoder();
    const data = encoder.encode(content);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 8);
  }

  // Detect platform from URL
  detectPlatform() {
    const host = window.location.hostname;
    if (host.includes('claude.ai')) return 'claude';
    if (host.includes('chatgpt.com')) return 'chatgpt';
    if (host.includes('gemini.google.com')) return 'gemini';
    if (host.includes('grok.com')) return 'grok';
    if (host.includes('chat.mistral.ai')) return 'mistral';
    if (host.includes('chat.deepseek.com')) return 'deepseek';
    if (host.includes('copilot.microsoft.com')) return 'copilot';
    if (host.includes('perplexity.ai')) return 'perplexity';
    return 'unknown';
  }

  // Check if element is a code block
  isCodeBlock(element) {
    return element.tagName === 'PRE' || 
           element.tagName === 'CODE' ||
           element.classList?.contains('code-block') ||
           element.classList?.contains('hljs') ||
           element.querySelector('pre, code');
  }

  // Extract language from code block
  detectLanguage(element) {
    // Check class names for language hints
    const classes = element.className || '';
    const match = classes.match(/language-(\w+)|lang-(\w+)|(\w+)-code/);
    if (match) return match[1] || match[2] || match[3];
    
    // Check data attributes
    if (element.dataset?.language) return element.dataset.language;
    
    // Check child code element
    const codeEl = element.querySelector('code');
    if (codeEl) {
      const codeClasses = codeEl.className || '';
      const codeMatch = codeClasses.match(/language-(\w+)/);
      if (codeMatch) return codeMatch[1];
    }
    
    return 'text';
  }

  // Extract filename if present
  extractFilename(element) {
    // Look for filename in header or nearby elements
    const header = element.previousElementSibling;
    if (header?.textContent?.includes('.')) {
      const match = header.textContent.match(/[\w-]+\.\w+/);
      if (match) return match[0];
    }
    return null;
  }

  // Parse a single message element
  async parseMessageContent(element, role) {
    const blocks = [];
    
    // Walk through child nodes
    const walkNode = async (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent.trim();
        if (text) {
          blocks.push({
            t: role === 'user' ? 'u' : 'a_text',
            v: text
          });
        }
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        if (this.isCodeBlock(node)) {
          const codeContent = node.textContent.trim();
          if (codeContent) {
            blocks.push({
              t: 'code',
              lang: this.detectLanguage(node),
              file: this.extractFilename(node),
              hash: await this.sha256(codeContent),
              v: codeContent
            });
          }
        } else if (node.tagName === 'PRE' || node.tagName === 'CODE') {
          const codeContent = node.textContent.trim();
          if (codeContent) {
            blocks.push({
              t: 'code',
              lang: this.detectLanguage(node),
              file: this.extractFilename(node),
              hash: await this.sha256(codeContent),
              v: codeContent
            });
          }
        } else {
          // Recurse into children
          for (const child of node.childNodes) {
            await walkNode(child);
          }
        }
      }
    };

    await walkNode(element);
    return blocks;
  }

  // Main extraction method - platform agnostic
  async extractConversation() {
    this.blocks = [];
    const platform = this.detectPlatform();
    
    // Add meta block
    this.blocks.push({
      t: 'meta',
      id: `lisa-${Date.now()}`,
      ver: '1.0',
      platform: platform,
      url: window.location.href,
      timestamp: new Date().toISOString()
    });

    // Platform-specific message extraction
    let messages = [];
    
    if (platform === 'claude') {
      messages = await this.extractClaudeMessages();
    } else if (platform === 'chatgpt') {
      messages = await this.extractChatGPTMessages();
    } else if (platform === 'gemini') {
      messages = await this.extractGeminiMessages();
    } else {
      // Generic fallback
      messages = await this.extractGenericMessages();
    }

    // Add all message blocks
    for (const msg of messages) {
      this.blocks.push(...msg);
    }

    return this.blocks;
  }

  // Claude-specific extraction
  async extractClaudeMessages() {
    const messages = [];
    const messageContainers = document.querySelectorAll('[data-test-render-count], .font-claude-message, [class*="Message"]');
    
    for (const container of messageContainers) {
      const isUser = container.closest('[class*="human"]') !== null ||
                     container.querySelector('[class*="human"]') !== null ||
                     container.textContent?.startsWith('You');
      
      const role = isUser ? 'user' : 'assistant';
      const blocks = await this.parseMessageContent(container, role);
      if (blocks.length > 0) {
        messages.push(blocks);
      }
    }
    
    return messages;
  }

  // ChatGPT-specific extraction
  async extractChatGPTMessages() {
    const messages = [];
    const messageContainers = document.querySelectorAll('[data-message-author-role]');
    
    for (const container of messageContainers) {
      const role = container.getAttribute('data-message-author-role') || 'assistant';
      const blocks = await this.parseMessageContent(container, role);
      if (blocks.length > 0) {
        messages.push(blocks);
      }
    }
    
    return messages;
  }

  // Gemini-specific extraction
  async extractGeminiMessages() {
    const messages = [];
    const messageContainers = document.querySelectorAll('[data-turn-id], .conversation-turn');
    
    for (const container of messageContainers) {
      const isUser = container.querySelector('[data-role="user"]') !== null ||
                     container.classList?.contains('user-turn');
      
      const role = isUser ? 'user' : 'assistant';
      const blocks = await this.parseMessageContent(container, role);
      if (blocks.length > 0) {
        messages.push(blocks);
      }
    }
    
    return messages;
  }

  // Generic fallback extraction
  async extractGenericMessages() {
    const messages = [];
    
    // Try common patterns
    const selectors = [
      '[role="article"]',
      '[class*="message"]',
      '[class*="Message"]',
      '[class*="chat"]',
      '.user-message, .assistant-message, .bot-message'
    ];
    
    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector);
      if (elements.length > 0) {
        for (const el of elements) {
          const isUser = el.classList?.contains('user') ||
                        el.getAttribute('data-role') === 'user';
          const role = isUser ? 'user' : 'assistant';
          const blocks = await this.parseMessageContent(el, role);
          if (blocks.length > 0) {
            messages.push(blocks);
          }
        }
        break;
      }
    }
    
    return messages;
  }

  // Export as JSONL string
  toJSONL() {
    return this.blocks.map(block => JSON.stringify(block)).join('\n');
  }

  // Export as object array
  toArray() {
    return this.blocks;
  }

  // Get stats
  getStats() {
    const codeBlocks = this.blocks.filter(b => b.t === 'code');
    const userMessages = this.blocks.filter(b => b.t === 'u');
    const assistantMessages = this.blocks.filter(b => b.t === 'a_text');
    
    return {
      totalBlocks: this.blocks.length,
      codeBlocks: codeBlocks.length,
      userMessages: userMessages.length,
      assistantMessages: assistantMessages.length,
      languages: [...new Set(codeBlocks.map(b => b.lang))]
    };
  }
}

// Make available globally
window.LisaVParser = LisaVParser;
