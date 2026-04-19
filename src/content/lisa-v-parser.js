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
    if (window.location.pathname.includes('/code/')) return 'Claude Code';
    if (host.includes('claude.ai')) return 'Claude';
    if (host.includes('chatgpt.com')) return 'ChatGPT';
    if (host.includes('gemini.google.com')) return 'Gemini';
    if (host.includes('grok.com')) return 'Grok';
    if (host.includes('chat.mistral.ai')) return 'Mistral AI';
    if (host.includes('chat.deepseek.com')) return 'DeepSeek';
    if (host.includes('copilot.microsoft.com')) return 'Microsoft Copilot';
    if (host.includes('perplexity.ai')) return 'Perplexity';
    return 'unknown';
  }

  // Check if element is a code block
  isCodeBlock(element) {
    return element.tagName === 'PRE' || 
           element.tagName === 'CODE' ||
           element.classList?.contains('code-block') ||
           element.classList?.contains('hljs');
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
      const match = header.textContent.match(/[\w\-\/]+\.(js|ts|jsx|tsx|py|json|css|html|md|txt|yaml|yml|sh|sql|xml)/i);
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
    // Consolidate consecutive same-type text blocks
    const consolidated = [];
    for (const block of blocks) {
      const last = consolidated[consolidated.length - 1];
      if (last && last.t === block.t && (block.t === "u" || block.t === "a_text")) {
        last.v += "\n" + block.v;
      } else {
        consolidated.push({...block});
      }
    }
    return consolidated;
  }

  // Main extraction method - platform agnostic
  async extractConversation() {
    try {
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
    
    if (platform === 'Claude Code') {
      messages = await this.extractClaudeCodeMessages();
    } else if (platform === 'Claude') {
      messages = await this.extractClaudeMessages();
    } else if (platform === 'ChatGPT') {
      messages = await this.extractChatGPTMessages();
    } else if (platform === 'Gemini') {
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
    } catch (error) {
      console.error("[LISA] Extraction error:", error);
      return this.blocks;
    }
  }

  async extractClaudeMessages() {
    // Expand all collapsed "Show more" / "Afficher plus" messages before extraction
    const expandButtons = document.querySelectorAll('button');
    for (const btn of expandButtons) {
      const text = btn.textContent.trim().toLowerCase();
      if (text === 'show more' || text === 'afficher plus' || text === 'see more' || text === 'ver más' || text === 'mehr anzeigen') {
        btn.click();
      }
    }
    // Brief wait for DOM to expand
    if (expandButtons.length > 0) {
      await new Promise(r => setTimeout(r, 300));
    }

    const messages = [];
    const messageContainers = document.querySelectorAll("[data-test-render-count]");
    
    for (const container of messageContainers) {
      // User messages have: justify-end or items-end (right-aligned) + bg-bg-300 background
      // Assistant messages have: data-is-streaming attribute
      const hasStreaming = container.querySelector("[data-is-streaming]") !== null;
      const hasUserBg = container.querySelector(".bg-bg-300") !== null;
      const hasRightAlign = container.querySelector("[class*='justify-end']") !== null ||
                            container.querySelector("[class*='items-end']") !== null;
      
      // Assistant has streaming element, User has right-aligned bg-bg-300 bubble
      const isUser = !hasStreaming && (hasUserBg || hasRightAlign);
      
      const role = isUser ? "user" : "assistant";
      const blocks = await this.parseMessageContent(container, role);
      if (blocks.length > 0) {
        messages.push(blocks);
      }
    }
    
    return messages;
  }

  // Claude Code-specific extraction
  async extractClaudeCodeMessages() {
    const messages = [];
    const messageContainers = document.querySelectorAll('[class*="group/message"]');
    
    for (const container of messageContainers) {
      const classList = container.className;
      const isUser = classList.includes('bg-bg-200') || container.querySelector('.bg-bg-200');
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

  // Extract relationships between concepts (code dependencies, topic flows)
  extractRelationships() {
    const relationships = [];
    const codeBlocks = this.blocks.filter(b => b.t === "code");
    const textBlocks = this.blocks.filter(b => b.t === "a_text" || b.t === "u");
    
    // Code file dependencies
    const files = codeBlocks.map(b => b.file).filter(f => f);
    for (let i = 1; i < codeBlocks.length; i++) {
      if (codeBlocks[i].file && codeBlocks[i-1].file) {
        relationships.push({
          t: "relationship",
          subject: codeBlocks[i-1].file,
          predicate: "followed_by",
          object: codeBlocks[i].file
        });
      }
    }
    
    // Detect imports/dependencies in code
    for (const block of codeBlocks) {
      const importMatches = block.v.match(/import\s+[\w{}\s,]+\s+from\s+["']([^"']+)["']/g) || [];
      const requireMatches = block.v.match(/require\(["']([^"']+)["']\)/g) || [];
      
      for (const imp of [...importMatches, ...requireMatches]) {
        const module = imp.match(/["']([^"']+)["']/)?.[1];
        if (module && block.file) {
          relationships.push({
            t: "relationship",
            subject: block.file,
            predicate: "imports",
            object: module
          });
        }
      }
    }
    
    // Detect API calls (fetch, axios, POST/GET/PUT/DELETE endpoints)
    const allText = this.blocks.map(b => b.v || "").join("\n");
    const apiPatterns = [
      /fetch\(['"]([^'"]+)['"]/g,
      /(?:POST|GET|PUT|DELETE|PATCH)\s+(\/api\/[\w\-\/]+)/g,
      /\.(?:post|get|put|delete|patch)\(['"]([^'"]+)['"]/g
    ];
    
    for (const block of codeBlocks) {
      if (!block.file) continue;
      for (const pattern of apiPatterns) {
        const re = new RegExp(pattern.source, pattern.flags);
        let match;
        while ((match = re.exec(block.v)) !== null) {
          const endpoint = match[1];
          if (endpoint && endpoint.length > 3) {
            relationships.push({
              t: "relationship",
              subject: block.file,
              predicate: "calls",
              object: endpoint
            });
          }
        }
      }
    }
    
    // Detect git commit → file relationships
    const commitPattern = /(?:commit|committed|pushed)\s+(?:to\s+)?(?:[`'"]?)([a-f0-9]{7,40})(?:[`'"]?)/gi;
    const commitMatches = allText.matchAll(commitPattern);
    const mentionedFiles = [...new Set(codeBlocks.map(b => b.file).filter(f => f))];
    
    for (const match of commitMatches) {
      const commitHash = match[1];
      for (const file of mentionedFiles) {
        relationships.push({
          t: "relationship",
          subject: commitHash,
          predicate: "implements",
          object: file
        });
      }
    }
    
    // Detect branch → commit relationships
    const branchPattern = /(?:branch|origin\/)([\w\-\/]+)/gi;
    const branchMatches = allText.matchAll(branchPattern);
    const commitHashes = [...allText.matchAll(/([a-f0-9]{7,40})/g)].map(m => m[1]);
    
    for (const match of branchMatches) {
      const branch = match[1];
      if (branch === 'main' || branch === 'master' || branch.length < 3) continue;
      for (const hash of [...new Set(commitHashes)].slice(0, 5)) {
        relationships.push({
          t: "relationship",
          subject: branch,
          predicate: "contains",
          object: hash
        });
      }
    }
    
    // Deduplicate relationships
    const seen = new Set();
    return relationships.filter(r => {
      const key = r.subject + r.predicate + r.object;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // Generate handoff "next" blocks with resolution tracking
  // Generate handoff "next" blocks with resolution tracking
  generateNextBlocks() {
    const tasks = [];
    const allBlocks = this.blocks;
    const allText = allBlocks.filter(b => b.t === "a_text" || b.t === "u").map(b => b.v || "").join("\n");

    // Resolution signals — if these appear AFTER a task mention, mark it resolved
    const resolutionPatterns = [
      /\u2705/g,                          // ✅ emoji
      /\bfixed\b/gi,
      /\bdone\b/gi,
      /\bdeployed\b/gi,
      /\bcommitted\b/gi,
      /\bresolved\b/gi,
      /\bcompleted\b/gi,
      /\bworking now\b/gi,
      /\bmerged\b/gi,
      /\bshipped\b/gi,
      /\bpushed\b/gi,
      /Syntax OK/gi,
      /SYNTAX OK/gi
    ];

    // Task detection patterns — capture full actionable sentences
    const todoPatterns = [
      { regex: /TODO:?\s*(.{10,300})/gi, type: "todo", priority: "high" },
      { regex: /FIXME:?\s*(.{10,300})/gi, type: "fixme", priority: "high" },
      { regex: /(?:we |I )?(?:need to|must)\s+(?:implement|add|fix|create|update|remove|refactor|deploy|test|verify)\s+(.{10,300})/gi, type: "planned", priority: "medium" },
      { regex: /(?:not yet|still needs?)\s+(?:fixed|implemented|done|deployed|tested|resolved):?\s*(.{10,300})?/gi, type: "pending", priority: "medium" },
      { regex: /(?:^|\n)\s*(?:Bug|Issue|BUG|ISSUE):?\s+(.{10,300})/gm, type: "bug", priority: "high" }
    ];

    // Extract tasks with their position in conversation
    for (const { regex, type, priority } of todoPatterns) {
      const re = new RegExp(regex.source, regex.flags);
      let match;
      while ((match = re.exec(allText)) !== null) {
        const rawAction = match[1].trim().replace(/[.,;:]+$/, "");
        const action = rawAction.length > 200
          ? rawAction.substring(0, rawAction.lastIndexOf(" ", 200)).trim() || rawAction.substring(0, 200)
          : rawAction;
        if (action.length < 10) continue;

        // --- Universal filters: catch false positives from all user types ---

        // Filter 1: Code/regex fragments (original)
        if (/[\\\/{}()\[\]|^$*+?].*[\\\/{}()\[\]|^$*+?]/.test(action)) continue;
        if (/^[^a-zA-Z]*$/.test(action)) continue;
        if ((action.match(/[^a-zA-Z0-9\s.,!?;:\-]/g) || []).length > action.length * 0.3) continue;

        // Filter 2: Terminal/grep output — line starts with file path or $ prompt
        const lineStart = allText.lastIndexOf("\n", match.index);
        const lineContext = allText.substring(lineStart + 1, match.index + action.length);
        if (/^\/[\w\-\.\/]+:\d+:/.test(lineContext)) continue;        // grep output: /path/file.js:42:
        if (/^\s*\$\s/.test(lineContext)) continue;                    // terminal prompt: $ command
        if (/^@\w+.*\$/.test(lineContext)) continue;                   // codespaces prompt: @user $ 

        // Filter 3: Array/object literals — task text is inside quotes in an array
        if (/^['"\[]/.test(action)) continue;                          // starts with quote or bracket
        if (/['"],\s*$/.test(action)) continue;                        // ends with quote-comma (array item)
        if (/^\s*['"].*['"],?\s*$/.test(action.split("\n")[0])) continue; // single quoted string

        // Filter 4: Code patterns — variable assignments, function calls, imports
        if (/^[a-z_$][\w$]*\s*[:=({]/.test(action)) continue;         // variable = / obj: / func(
        if (/^(const|let|var|function|class|import|export|return)\s/.test(action)) continue;
        if (/^(grep|sed|awk|cat|echo|cd|git|npm|pip|node|python)\s/.test(action)) continue;

        tasks.push({
          action,
          type,
          priority,
          position: match.index
        });
      }
    }

    // Check each task for resolution — wider window (2000 chars) to catch
    // resolutions that happen further downstream in the conversation
    const resolvedTasks = [];
    const openTasks = [];

    for (const task of tasks) {
      const textAfterTask = allText.substring(task.position);
      const isResolved = resolutionPatterns.some(pattern => {
        const re = new RegExp(pattern.source, pattern.flags);
        return re.test(textAfterTask.substring(0, 2000));
      });

      if (isResolved) {
        resolvedTasks.push(task);
      } else {
        openTasks.push(task);
      }
    }

    // Detect unanswered questions from last user message
    const lastUserMsg = [...allBlocks].reverse().find(b => b.t === "u");
    if (lastUserMsg?.v?.includes("?") && lastUserMsg.v.length > 15) {
      const questionText = lastUserMsg.v.trim().substring(0, 200);
      // Check if assistant responded after this question
      const lastUserIdx = allBlocks.lastIndexOf(lastUserMsg);
      const hasResponse = allBlocks.slice(lastUserIdx + 1).some(b => b.t === "a_text");
      if (!hasResponse) {
        openTasks.push({
          action: questionText,
          type: "unanswered_question",
          priority: "high",
          position: allText.length
        });
      }
    }

    
    // Build next blocks — open items first, then resolved
    const nextBlocks = [];
    const seen = new Set();
    
    for (const task of openTasks) {
      const key = task.action.toLowerCase().substring(0, 50);
      if (seen.has(key)) continue;
      seen.add(key);
      nextBlocks.push({
        t: "next",
        action: task.action,
        type: task.type,
        priority: task.priority,
        status: "open",
        owner: "next_instance",
        auto_detected: true
      });
    }
    
    for (const task of resolvedTasks) {
      const key = task.action.toLowerCase().substring(0, 50);
      if (seen.has(key)) continue;
      seen.add(key);
      nextBlocks.push({
        t: "next",
        action: task.action,
        type: task.type,
        priority: task.priority,
        status: "resolved",
        owner: "resolved",
        auto_detected: true
      });
    }
    
    // Return max 8 blocks: prioritize open items, then include resolved for context
    const openItems = nextBlocks.filter(b => b.status === "open").slice(0, 5);
    const resolvedItems = nextBlocks.filter(b => b.status === "resolved").slice(0, 3);
    return [...openItems, ...resolvedItems];
  }


  // Generate lightweight manifest for top of file (truncation detection)
  generateLiteManifest(totalBlockCount) {
    return {
      t: "manifest",
      lite: true,
      blockCount: totalBlockCount,
      timestamp: new Date().toISOString()
    };
  }

  // Generate summary block — executive brief for receiving AI instances
  generateSummaryBlock(nextBlocks) {
    const completed = [];
    const open = [];
    for (const block of nextBlocks) {
      if (block.resolved) {
        completed.push(block.action);
      } else {
        open.push(block.action);
      }
    }
    return {
      t: "summary",
      completed,
      open,
      warnings: []
    };
  }
  // Build complete LISA-V with relationships and next blocks
  async finalize() {
    // --- Phase 1: Generate all derived blocks ---
    const relationships = this.extractRelationships();
    const nextBlocks = this.generateNextBlocks();

    // --- Phase 2: Rebuild blocks in truncation-proof order ---
    const conversationBlocks = [...this.blocks];
    this.blocks = [];

    // Line 1: meta (always first element)
    const metaIndex = conversationBlocks.findIndex(b => b.t === "meta");
    const metaBlock = metaIndex >= 0
      ? conversationBlocks.splice(metaIndex, 1)[0]
      : { t: "meta", id: "unknown", platform: "unknown", ver: "1.0", timestamp: new Date().toISOString() };
    this.blocks.push(metaBlock);

    // Line 2: lite manifest — receiving AI knows file scope immediately
    const liteManifestIndex = this.blocks.length;
    this.blocks.push(this.generateLiteManifest(0)); // placeholder, updated below

    // Line 3: summary — executive brief (completed vs open tasks)
    this.blocks.push(this.generateSummaryBlock(nextBlocks));

    // Lines 4-N: next blocks — open tasks before any conversation content
    this.blocks.push(...nextBlocks);

    // Lines N+1+: conversation content (user messages, assistant text, code)
    this.blocks.push(...conversationBlocks);

    // Relationships after conversation
    this.blocks.push(...relationships);

    // Full manifest at bottom for integrity verification
    const merkleRoot = await this.getMerkleRoot();
    this.blocks.push({
      t: "manifest",
      merkleRoot: merkleRoot,
      blockCount: this.blocks.length + 1,
      timestamp: new Date().toISOString()
    });

    // Update lite manifest with actual block count
    this.blocks[liteManifestIndex].blockCount = this.blocks.length + 1;

    // Closing sys block
    this.blocks.push({
      t: "sys",
      v: "Session captured. " + this.blocks.length + " blocks. Ready for handoff."
    });

    return this;
  }

  // Export as JSONL string
  // Calculate Merkle root of all blocks
  async getMerkleRoot() {
    if (this.blocks.length === 0) return null;
    let hashes = [];
    for (const block of this.blocks) {
      hashes.push(await this.sha256(JSON.stringify(block)));
    }
    while (hashes.length > 1) {
      const next = [];
      for (let i = 0; i < hashes.length; i += 2) {
        const left = hashes[i];
        const right = hashes[i + 1] || left;
        next.push(await this.sha256(left + right));
      }
      hashes = next;
    }
    return hashes[0];
  }

  toJSONL() {
    return this.blocks.map(block => JSON.stringify(block)).join('\n');
  }

  // Export as object array
  toArray() {
    return this.blocks;
  }
  // Flatten blocks into messages format for backend compatibility
  toMessages() {
    const messages = [];
    let currentRole = null;
    let currentContent = [];
    
    for (const block of this.blocks) {
      if (block.t === 'meta' || block.t === 'manifest' || block.t === 'sys' || 
          block.t === 'next' || block.t === 'relationship') continue;
      
      const role = block.t === 'u' ? 'user' : 'assistant';
      
      if (role !== currentRole && currentRole !== null) {
        messages.push({
          role: currentRole,
          content: currentContent.join('\n').trim(),
          index: messages.length
        });
        currentContent = [];
      }
      
      currentRole = role;
      currentContent.push(block.v || '');
    }
    
    // Push last message
    if (currentRole && currentContent.length > 0) {
      messages.push({
        role: currentRole,
        content: currentContent.join('\n').trim(),
        index: messages.length
      });
    }
    
    return {
      platform: this.detectPlatform(),
      conversationId: this.conversationId,
      url: window.location.href,
      title: document.title,
      extractedAt: new Date().toISOString(),
      messageCount: messages.length,
      messages: messages
    };
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

// Listen for extraction requests via LISA-V
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extractViaLisaV') {
    (async () => {
      try {
        const parser = new LisaVParser();
        await parser.extractConversation();
        await parser.finalize();
        const messagesData = parser.toMessages();
        sendResponse({ success: true, data: messagesData });
      } catch (error) {
        console.error('[LISA] LISA-V extraction error:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true; // Keep channel open for async
  }
});
