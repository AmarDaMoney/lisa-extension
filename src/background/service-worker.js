// LISA Core - Semantic Compression Engine
// Background Service Worker (Manifest V3)
// v0.51.6 - Auto-embed integrity hash for Premium, subscription auto-renewal/cancellation notice

class LISACompressor {
  constructor() {
    this.compressionRatio = null;
  }

  // Semantic tokenization - identifies key concepts and structures
  tokenize(text) {
    if (!text) text = '';
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
    // Common uppercase words that aren't real acronyms
    const acronymNoise = new Set(['OK','NO','IF','OR','ON','IN','AT','IS','IT','DO','SO','UP',
      'AM','PM','GET','SET','PUT','RUN','END','ADD','FIX','LOG','THE','AND','BUT','FOR','NOT',
      'ALL','HAS','HAD','LET','NEW','TRY','USE','VAR','WAS','GOT','DID','MAY','SAY','NOW',
      'TOP','KEY','MAP','MAX','MIN','DOM','DIV','CSS','TAB','ROW','COL','ERR','MSG','BTN',
      'SRC','OBJ','REF','OUT','RAW','OLD','RED','HIT','BAD','BIG','LOW','DONE','FOUND',
      'TRUE','FALSE','NULL','VOID','ELSE','THEN','FROM','WITH','THIS','THAT','NEXT','LAST',
      'FILE','LINE','NODE','NAME','TYPE','DATA','EACH','PUSH','PULL','STEP','TEST','WAIT']);
    const patterns = {
      urls: /https?:\/\/[^\s]+/g,
      emails: /[\w.-]+@[\w.-]+\.\w+/g,
      mentions: /@\w+/g,
      hashtags: /#\w+/g,
      technicalTerms: /\b[A-Z][A-Za-z0-9]+(?:[A-Z][a-z]+)+\b/g,
      acronyms: /\b[A-Z]{3,}\b/g
    };
    for (const [type, pattern] of Object.entries(patterns)) {
      let matches = [...new Set(text.match(pattern) || [])];
      if (type === 'acronyms') matches = matches.filter(m => !acronymNoise.has(m) && m.length >= 3);
      if (type === 'technicalTerms') matches = matches.filter(m => m.length <= 40);
      if (matches.length > 0) {
        entities.push({ type, values: matches.slice(0, 15) });
      }
    }
    return entities;
  }

  extractConcepts(text) {
    const words = text.toLowerCase().split(/\s+/);
    const stopWords = new Set(['the', 'is', 'at', 'which', 'on', 'a', 'an', 'and', 'or', 'but',
      'in', 'with', 'to', 'for', 'of', 'as', 'by', 'from', 'this', 'that', 'then', 'than',
      'what', 'when', 'where', 'will', 'would', 'could', 'should', 'have', 'been', 'were',
      'here', 'there', 'just', 'also', 'very', 'some', 'more', 'into',
      'const', 'function', 'return', 'await', 'async', 'true', 'false', 'null', 'undefined',
      'catch', 'throw', 'class', 'super', 'export', 'import', 'typeof', 'instanceof']);
    const wordFreq = {};
    words.forEach(word => {
      word = word.replace(/[^\w]/g, '');
      if (word.length > 3 && word.length <= 18 && !stopWords.has(word)
          && !/\d{3,}/.test(word)
          && !/[A-Z]/.test(word.slice(1))
          && !word.includes('_')) {
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
        const subj = (match[1] || '').toLowerCase();
        const obj = (match[2] || '').toLowerCase();
        if (subj.length < 3 || obj.length < 3) return;
        const noise = new Set(['the','this','that','then','here','now','not','all','its','has','was','are','had','can','may','been','done','true','false','null','just','also','very','some','more']);
        if (noise.has(subj) || noise.has(obj)) return;
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
        lisaVersion: '0.51.6',
        platform: conversation.platform,
        conversationId: conversation.conversationId,
        originalUrl: conversation.url,
        title: conversation.title,
        compressedAt: new Date().toISOString(),
        messageCount: conversation.messageCount
},
      semanticTokens: []
    };

    conversation.messages.forEach(message => {
      const content = message.content || message.v || '';
      const tokens = this.tokenize(content);
      
      compressed.semanticTokens.push({
        role: message.role,
        index: message.index,
        tokens: tokens,
        summary: this.summarize(content),
        originalLength: content.length
      });
    });

    const originalSize = JSON.stringify(conversation).length;
    const compressedSize = JSON.stringify(compressed).length;
    compressed.metadata.compressionRatio = (originalSize / compressedSize).toFixed(2);
    compressed.anchor = this.generateSemanticAnchor(compressed);
    compressed._instructions = 'LISA semantic export. Each semanticTokens entry = one conversation turn with entities, weighted concepts, relationships, and intent. Read anchor for session context. Use semanticTokens[].summary for condensed turns. Upload to any AI and say: read this LISA file and continue the conversation.';

    return compressed;
  }

  summarize(text) {
    if (!text) return '';
    // Strip code blocks to prevent code pollution in summaries
    text = text.replace(/```(?:bash|python3?|javascript|js|json|css|html)?[\s\S]*?```/g, '[code block]');
    text = text.replace(/`[^`]+`/g, '[code]');
    // Strip orphaned language identifiers left after code block removal
    text = text.replace(/\b(bash|python3?|javascript|js|json)(grep|sed|cat|node|git|head|tail)/gi, '$2');
    // Strip console/log output noise
    text = text.replace(/^\s*(matches:|replaced|aborted|syntax|\$|>|\d+[:|]|\[LISA).*/gm, '');
    // Strip bash/command lines
    text = text.replace(/^\s*(sed|grep|python3|node|git|cat|head|tail|wc|cd|bash)\s.*/gm, '');
    text = text.trim();
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 10);
    
    if (sentences.length <= 2) {
      // End at sentence boundary, not mid-word
      const cut = text.substring(0, 300);
      const lastPeriod = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
      return lastPeriod > 50 ? cut.substring(0, lastPeriod + 1) : cut;
    }
    
    // Score sentences by keyword density (concepts, technical terms, actions)
    const scored = sentences.map((s, i) => {
      let score = 0;
      // Position bonus: first and last sentences often have context
      if (i === 0) score += 2;
      if (i === sentences.length - 1) score += 1;
      // Content signals
      if (/\b(?:because|therefore|however|conclusion|result|key|important|critical|must|should)\b/i.test(s)) score += 3;
      if (/\b(?:fix|bug|error|issue|implement|deploy|create|update)\b/i.test(s)) score += 2;
      if (/[A-Z][a-z]+[A-Z]/.test(s)) score += 1; // camelCase = technical
      if (/\b[A-Z]{2,}\b/.test(s)) score += 1; // ACRONYMS = technical
      // Penalize short filler sentences
      if (s.trim().length < 20) score -= 2;
      return { text: s.trim(), score, index: i };
    });
    
    // Take top 3 sentences by score, maintain original order
    const top = scored.sort((a, b) => b.score - a.score).slice(0, 3);
    top.sort((a, b) => a.index - b.index);
    
    return top.map(s => s.text).join('. ').substring(0, 500);
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

  generateRawAnchor(conversation) {
    const messages = conversation.messages || [];
    const userMsgs      = messages.filter(m => m.role === 'user');
    const assistantMsgs = messages.filter(m => m.role === 'assistant');
    // Sample first + last 5 messages for concept extraction
    const sample = [...messages.slice(0, 5), ...messages.slice(-5)];
    const allText = sample.map(m => m.content || m.v || '').join(' ');
    const stopwords = new Set(['this','that','with','from','have','been','will','would','could',
      'should','their','there','they','what','when','where','which','more','also','into',
      'your','about','just','like','some','than','then','them','these','those','were','very','well']);
    const freq = {};
    (allText.toLowerCase().match(/[a-z]{4,}/g) || []).forEach(w => {
      if (!stopwords.has(w)) freq[w] = (freq[w] || 0) + 1;
    });
    const dominantConcepts = Object.entries(freq).sort((a,b) => b[1]-a[1]).slice(0, 6).map(([w]) => w);
    const coreTopic = conversation.title ||
      (userMsgs[0]?.content || userMsgs[0]?.v || '').substring(0, 100).replace(/\n/g, ' ').trim();
    return {
      core_topic:        coreTopic,
      platform:          conversation.platform || 'unknown',
      message_count:     { user: userMsgs.length, assistant: assistantMsgs.length },
      dominant_concepts: dominantConcepts,
      generated_by:      'LISA v0.51.6',
      key_entities:    Object.keys(freq).length > 0 ? Object.entries(freq).sort((a,b) => b[1]-a[1]).slice(0, 12).map(([w]) => w) : [],
      note:              'Lightweight anchor — raw verbatim format'
    };
  }

  generateSemanticAnchor(compressed) {
    const tokens = compressed.semanticTokens || [];
    const userTokens      = tokens.filter(t => t.role === 'user');
    const assistantTokens = tokens.filter(t => t.role === 'assistant');
    const conceptMap = {};
    tokens.forEach(t => {
      (t.tokens?.concepts || []).forEach(c => {
        conceptMap[c.term] = (conceptMap[c.term] || 0) + (c.weight || 1);
      });
    });
    const dominantConcepts = Object.entries(conceptMap)
      .sort((a, b) => b[1] - a[1]).slice(0, 8).map(([term]) => term);
    const entitySet = new Set();
    tokens.forEach(t => {
      (t.tokens?.entities || []).forEach(e => (e.values || []).forEach(v => entitySet.add(v)));
    });
    const intentCount = {};
    tokens.forEach(t => { const i = t.tokens?.intent; if (i) intentCount[i] = (intentCount[i]||0)+1; });
    const sessionIntent = Object.entries(intentCount).sort((a,b)=>b[1]-a[1])[0]?.[0] || 'statement';
    const hasCodeRatio = tokens.filter(t => t.tokens?.context?.hasCode).length / Math.max(tokens.length,1);
    const techConcepts    = ['code','function','error','deploy','api','model','class','data','system'];
    const emotionConcepts = ['feel','love','trust','hope','care','human','understand','want','believe'];
    const techScore    = dominantConcepts.filter(c => techConcepts.includes(c)).length;
    const emotionScore = dominantConcepts.filter(c => emotionConcepts.includes(c)).length;
    let register = 'conversational';
    if (hasCodeRatio > 0.15 || techScore > 3)     register = 'technical';
    else if (emotionScore > 2 && techScore < 2)   register = 'philosophical';
    else if (techScore > 2   && emotionScore > 2) register = 'mixed';
    const coreTopic = compressed.metadata?.title ||
      (userTokens[0]?.summary || '').substring(0, 100).trim();
    return {
      core_topic:        coreTopic,
      platform:          compressed.metadata?.platform || 'unknown',
      message_count:     { user: userTokens.length, assistant: assistantTokens.length },
      dominant_concepts: dominantConcepts,
      key_entities:      [...entitySet].slice(0, 12),
      session_intent:    sessionIntent,
      session_register:  register,
      open_tasks:        tokens.filter(t => t.tokens?.intent === 'question' || t.tokens?.intent === 'request').slice(-5).map(t => (t.summary || '').substring(0, 100)),
      generated_by:      'LISA v0.51.6'
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





  async saveSnapshot(conversation, source = 'auto') {
    try {
      const data = await chrome.storage.local.get(this.STORAGE_KEY);
      const snapshots = data[this.STORAGE_KEY] || [];

      // Phase 6: Check if this is an update to existing conversation (same URL)
      const existing = snapshots.find(s => s.url === conversation.url && s.source === source);

      // Store RAW conversation (not compressed) so App can compress with user's settings
      const snapshot = {
        id: 'snap-' + Date.now(),
        platform: conversation.platform || this.getPlatformName(conversation.url),
        url: conversation.url,
        title: conversation.title || 'Untitled',
        messageCount: conversation.messageCount,
        savedAt: new Date().toISOString(),
        source: source,
        format: conversation.format || null,
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

      // Inject lightweight anchor if not already present
      if (!conversation.anchor && (conversation.messages || []).length > 0) {
        snapshot.anchor = compressor.generateRawAnchor(conversation);
      } else if (conversation.anchor) {
        snapshot.anchor = conversation.anchor;
      }
      // Pre-store LISA tokenization for instant semantic rebirth
      try {
        const msgs = conversation.messages || [];
        if (msgs.length > 0) {
          snapshot.lisaTokens = msgs.map((m, i) => {
            const text = m.content || m.text || m.v || '';
            if (!text || text.length < 10) return null;
            const tokens = compressor.tokenize(text);
            return {
              index: i,
              role: m.role || 'assistant',
              summary: compressor.summarize(text),
              intent: tokens.intent,
              entities: (tokens.entities || []).length > 0 ? tokens.entities : undefined,
              concepts: (tokens.concepts || []).slice(0, 8),
              relationships: (tokens.relationships || []).length > 0 ? tokens.relationships.slice(0, 5) : undefined
            };
          }).filter(Boolean);
          console.debug('[LISA] Pre-tokenized ' + snapshot.lisaTokens.length + ' messages for instant rebirth');
        }
      } catch (tokenError) {
        console.warn('[LISA] Pre-tokenization failed, rebirth will tokenize on-the-fly:', tokenError);
      }

      // Phase 6: Generate content hash (non-fatal — save proceeds even if hashing fails)
      try {
        snapshot.hash = await this.hashContent(JSON.stringify(conversation));
      } catch (hashError) {
        console.warn('[LISA] Hash generation failed, saving without hash:', hashError);
        snapshot.hash = null;
      }

      snapshots.unshift(snapshot);

      if (snapshots.length > this.MAX_SNAPSHOTS) {
        snapshots.length = this.MAX_SNAPSHOTS;
      }

      await chrome.storage.local.set({ [this.STORAGE_KEY]: snapshots });

      console.debug(`[LISA] Snapshot saved: ${snapshot.platform} - ${snapshot.title} (v${snapshot.version})`);
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
// Get friendly platform name from URL
  getPlatformName(url) {
    if (!url) return 'Unknown';
    if (url.includes('claude.ai')) return 'Claude';
    if (url.includes('chatgpt.com')) return 'ChatGPT';
    if (url.includes('gemini.google.com')) return 'Gemini';
    if (url.includes('grok.com')) return 'Grok';
    if (url.includes('chat.mistral.ai')) return 'Mistral AI';
    if (url.includes('chat.deepseek.com')) return 'DeepSeek';
    if (url.includes('copilot.microsoft.com')) return 'Microsoft Copilot';
    if (url.includes('perplexity.ai')) return 'Perplexity';
    try {
      return new URL(url).hostname;
    } catch {
      return 'Unknown';
    }
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

// ============================================
// PHOENIX — SESSION REBIRTH
// ============================================

const NEW_CHAT_URLS = {
  'claude':      'https://claude.ai/new',
  'claude-code': 'https://claude.ai/new',
  'chatgpt':     'https://chatgpt.com/',
  'gemini':      'https://gemini.google.com/app',
  'grok':        'https://grok.com/',
  'deepseek':    'https://chat.deepseek.com/',
  'mistral':     'https://chat.mistral.ai/chat',
  'copilot':     'https://copilot.microsoft.com/',
  'perplexity':  'https://www.perplexity.ai/'
};

const pendingRebirths = new Map();

function generateContinuationHandoff(data, platform, mode) {
  const messages = data.messages || [];
  const title = data.title || 'Untitled';
  mode = mode || 'distilled';

  let earlySummary = '';
  let recentContent = '';
  let earlyMessages, recentMessages;

  if (mode === 'full') {
    // Full fidelity: every message verbatim
    earlyMessages = [];
    recentMessages = messages;
    recentContent = '## FULL CONVERSATION (' + messages.length + ' messages \u2014 verbatim)\n\n';
    messages.forEach(m => {
      const role = (m.role === 'user') ? 'User' : 'Assistant';
      const text = m.content || m.text || m.v || '';
      if (text) recentContent += '### ' + role + '\n' + text + '\n\n';
    });
  } else if (mode === 'semantic') {
    // Semantic: LISA-structured early context + last N verbatim
    const RECENT_TURNS = 10;
    const recentStart = Math.max(0, messages.length - RECENT_TURNS);
    earlyMessages = messages.slice(0, recentStart);
    recentMessages = messages.slice(recentStart);

    if (earlyMessages.length > 0) {
      const preTokens = data.lisaTokens || data.raw?.lisaTokens;
      earlySummary = '## SEMANTIC CONTEXT (' + earlyMessages.length + ' messages - LISA-structured)\n\n';
      earlySummary += '> Pre-translated by LISA. Entities, concepts, and relationships are resolved.\n';
      earlySummary += '> Parse this section as structured data, not prose.\n\n';
      earlySummary += '```json\n';
      let semanticBlocks;
      if (preTokens && preTokens.length > 0) {
        // Use pre-computed tokens (instant rebirth)
        semanticBlocks = preTokens.filter(t => t.index < earlyMessages.length);
        console.debug('[LISA Rebirth] Using pre-stored tokens (' + semanticBlocks.length + ' blocks)');
      } else {
        // Fallback: tokenize on-the-fly
        const compressor = new LISACompressor();
        semanticBlocks = earlyMessages.map((m, i) => {
          const content = m.content || m.text || m.v || '';
          const tokens = compressor.tokenize(content);
          const block = {
            index: i,
            role: m.role || 'assistant',
            summary: compressor.summarize(content),
            intent: tokens.intent
          };
          if (tokens.entities && tokens.entities.length > 0) block.entities = tokens.entities;
          if (tokens.concepts && tokens.concepts.length > 0) block.concepts = tokens.concepts.slice(0, 8);
          if (tokens.relationships && tokens.relationships.length > 0) block.relationships = tokens.relationships.slice(0, 5);
          return block;
        });
        console.debug('[LISA Rebirth] Tokenized on-the-fly (' + semanticBlocks.length + ' blocks)');
      }
      earlySummary += JSON.stringify(semanticBlocks, null, 1) + '\n';
      earlySummary += '```\n\n';
    }

    recentContent = '## RECENT CONVERSATION (last ' + recentMessages.length + ' messages \u2014 verbatim)\n\n';
    recentMessages.forEach(m => {
      const role = (m.role === 'user') ? 'User' : 'Assistant';
      const text = m.content || m.text || m.v || '';
      if (text) recentContent += '### ' + role + '\n' + text + '\n\n';
    });

  } else {
    // Distilled: summarized early + last N verbatim
    const RECENT_TURNS = 10;
    const recentStart = Math.max(0, messages.length - RECENT_TURNS);
    earlyMessages = messages.slice(0, recentStart);
    recentMessages = messages.slice(recentStart);

    // Build early context summary (topics covered, not full text)
    if (earlyMessages.length > 0) {
      earlySummary = '## EARLIER CONTEXT (' + earlyMessages.length + ' messages summarized)\n\n';
      const topics = [];
      earlyMessages.forEach(m => {
        if (m.role !== 'user') {
          const text = m.content || m.text || m.v || '';
          const firstLine = text.split('\n')[0].substring(0, 120).trim();
          if (firstLine.length > 30
              && !/^(Command|command|bash|python|grep|sed|cat |node |git )/i.test(firstLine)
              && !/^[\`\$#>|{]/.test(firstLine)
              && !/matches?:|replaced|aborted|syntax/i.test(firstLine)) {
            topics.push('- ' + firstLine);
          }
        }
      });
      if (topics.length > 0) {
        earlySummary += 'Key points covered:\n' + topics.slice(-15).join('\n') + '\n\n';
      }
    }

    // Build recent turns verbatim
    recentContent = '## RECENT CONVERSATION (last ' + recentMessages.length + ' messages — verbatim)\n\n';
    recentMessages.forEach(m => {
      const role = (m.role === 'user') ? 'User' : 'Assistant';
      const text = m.content || m.text || m.v || '';
      if (text) recentContent += '### ' + role + '\n' + text + '\n\n';
    });
  }

  return '# LISA SESSION REBIRTH — CONTINUATION DIRECTIVE\n\n'
    + 'You are RESUMING work in progress, not starting a new task. The previous\n'
    + 'session reached context capacity and was distilled into this handoff by\n'
    + 'LISA (Linguistic Intelligence Semantic Anchoring).\n\n'
    + 'MANDATORY BEHAVIOR\n\n'
    + '1. Read this entire handoff sequentially and in full before responding.\n'
    + '2. Adopt the working state described below as YOUR current state. Do not\n'
    + '   re-litigate decisions marked RESOLVED; do not re-ask answered questions.\n'
    + '3. Treat OPEN THREADS as your immediate working agenda.\n'
    + '4. Your first reply: confirm (a) the task you are resuming, (b) current\n'
    + '   state, (c) what you see as the next logical action based on the handoff.\n'
    + '   Then proceed directly.\n'
    + '5. Conversation language: continue in the language the user was using.\n\n'
    + '## SESSION LINEAGE\n'
    + '- Parent session: ' + title + ' (' + platform + ', ' + messages.length + ' messages)\n'
    + '- Generation: ' + (data.phoenix ? data.phoenix.generation : 1) + ' in this work chain\n'
    + '- Session ID: ' + (data.phoenix ? data.phoenix.session_id : 'genesis') + '\n'
    + '- Reborn at: ' + new Date().toISOString() + '\n'
    + '- Integrity: ' + (data.phoenix && data.phoenix.chain_hash ? 'SHA-256 ' + data.phoenix.chain_hash.slice(0, 16) : 'pending') + '\n'
    + '- Mode: ' + (mode === 'full' ? 'Full fidelity (' + messages.length + ' messages verbatim)' : mode === 'semantic' ? 'Semantic (' + earlyMessages.length + ' LISA-structured, ' + recentMessages.length + ' verbatim)' : 'Distilled (' + earlyMessages.length + ' summarized, ' + recentMessages.length + ' verbatim)') + '\n\n'
    + '---\n\n'
    + earlySummary
    + recentContent
    + '---\n\n'
    + '## ⚖️ SAT-CHAIN Governance Node\n'
    + '> LISA Core v0.51.6 | Phoenix Generation: ' + (data.phoenix ? data.phoenix.generation : 1) + '\n'
    + '> Chain Hash: ' + (data.phoenix && data.phoenix.chain_hash ? data.phoenix.chain_hash.slice(0, 16) : 'genesis') + '\n'
    + '> Enforcement: ACTIVE\n\n'
    + '### Reading Protocol\n'
    + 'Process this handoff in its entirety before responding. '
    + 'Every block above is source of truth.\n\n'
    + '### Enforcement Directives\n'
    + '1. **SOURCE FIDELITY**: All claims, decisions, and context are verified. '
    + 'Do not contradict, re-derive, or silently override them.\n'
    + '2. **NO HALLUCINATION**: Do not introduce entities, decisions, or conclusions not present in this handoff.\n'
    + '3. **CONFLICT PROTOCOL**: If the user\u2019s new request conflicts with handoff context, '
    + 'flag the conflict explicitly \u2014 do not assume precedence.\n'
    + '4. **CONTINUATION**: This is a reborn session (Generation ' + (data.phoenix ? data.phoenix.generation : 1) + '). '
    + 'Resume work, do not restart.\n\n'
    + '---\n'
    + '*LISA Core v0.51.6 \u2022 SAT-CHAIN LLC \u2022 Phoenix Session Rebirth*\n';
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Handle parser ready signals
  if (request.action === 'parserReady') {
    if (sender.tab) {
      readyTabs.set(sender.tab.id, {
        platform: request.platform,
        timestamp: Date.now()
      });
      console.debug(`[LISA] Parser ready on tab ${sender.tab.id}: ${request.platform}`);
    }
    sendResponse({ success: true });
    return false;
  }

  // Handle compression
  if (request.action === 'compress') {
    (async () => {
    try {
      const compressed = compressor.compress(request.data);
        
        // Premium: auto-embed integrity block
        const tierResult = await chrome.storage.sync.get(['userTier']);
        if (tierResult.userTier === 'premium') {
          const hashData = await hasher.generateHash(compressed);
          compressed.integrity = {
            hash: hashData.hash,
            algorithm: hashData.algorithm,
            generatedAt: hashData.generatedAt,
            tokenCount: compressed.semanticTokens.length
          };
        }
      sendResponse({ success: true, compressed });
    } catch (error) {
      console.error('[LISA] Compression error:', error);
      sendResponse({ success: false, error: error.message });
    }
    })();
    return true;
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

        // Skip re-extraction when caller already provides data (e.g. popup compress path)
        let extractResponse = null;
        if (!request.data) {
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
        }

        // Ensure required fields exist
          const data = request.data || extractResponse?.data || {};
          data.platform = data.platform || snapshotManager.getPlatformName(tab.url);
          data.url = data.url || tab.url;
          data.title = data.title || tab.title || 'Untitled';
          data.messageCount = data.messageCount || (data.messages?.length || 0);

          // Tag format if provided
          if (request.format) data.format = request.format;
          // Save snapshot with appropriate source
          const source = request.data ? 'extension-compressed' : 'floating-button';
          const snapshot = await snapshotManager.saveSnapshot(data, source);
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

  // Handle analytics tracking
  if (request.action === 'trackEvent') {
    console.debug('[LISA] Event:', request.event, request.data);
    // Future: send to analytics backend
    sendResponse({ success: true });
    return false;
  }

  // ── PHOENIX REBIRTH: orchestrate session rebirth ──
  if (request.type === 'PHOENIX_REBIRTH') {
    (async () => {
      try {
        const sourceTab = sender.tab;
        if (!sourceTab) {
          sendResponse({ success: false, error: 'No source tab' });
          return;
        }

        // 1. Extract conversation from source tab (use extractViaLisaV for scroll sweep)
        let extractResponse;
        try {
          extractResponse = await chrome.tabs.sendMessage(sourceTab.id, { action: 'extractViaLisaV' });
        } catch (err) {
          // Fallback to legacy extraction if LISA-V not available
          try {
            extractResponse = await chrome.tabs.sendMessage(sourceTab.id, { action: 'extractConversation' });
          } catch (err2) {
            sendResponse({ success: false, error: 'Could not extract conversation: ' + err2.message });
            return;
          }
        }

        // 2. Save snapshot (source = phoenix-rebirth for lineage tracking)
        const data = extractResponse?.data || {};
        data.platform = data.platform || request.platform || 'unknown';
        data.url = data.url || sourceTab.url;
        data.title = data.title || sourceTab.title || 'Untitled';
        data.messageCount = data.messageCount || (data.messages?.length || 0);
        // Compute lineage before saving
        const sessionId = 'phx-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
        const parentLineage = data.phoenix || null;
        const generation = parentLineage ? (parentLineage.generation || 1) + 1 : 1;

        // Save snapshot with lineage
        data.phoenix = {
          session_id: sessionId,
          parent_session_id: parentLineage ? parentLineage.session_id : null,
          generation: generation,
          platform: data.platform,
          parent_platform: parentLineage ? parentLineage.platform : null,
          reborn_at: new Date().toISOString(),
          trigger: request.trigger || 'manual'
        };
        // (snapshot saved below after hash computation)

        // 3. Generate continuation handoff
        const mdContent = generateContinuationHandoff(data, data.platform, request.mode || 'distilled');

        // Compute handoff hash + chain hash
        const encoder = new TextEncoder();
        const hashBuf = await crypto.subtle.digest('SHA-256', encoder.encode(mdContent));
        const handoffHash = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
        const parentChain = parentLineage ? (parentLineage.chain_hash || '') : '';
        const chainBuf = await crypto.subtle.digest('SHA-256', encoder.encode(parentChain + handoffHash));
        const chainHash = Array.from(new Uint8Array(chainBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
        data.phoenix.handoff_hash = handoffHash;
        data.phoenix.chain_hash = chainHash;

        // Save once with complete data (hashes + handoff content)
        data.rebirthHandoff = mdContent;
        data.rebirthMode = request.mode || 'distilled';
        await snapshotManager.saveSnapshot(data, 'phoenix-rebirth');

        const filename = 'LISA_REBIRTH_' + data.platform + '_' + Date.now() + '.md';

        // 4. Clean stale entries before opening new tab
        const now = Date.now();
        for (const [tid, p] of pendingRebirths) {
          if (now - p.timestamp > 60000) pendingRebirths.delete(tid);
        }
        // 5. Open new tab + store pending IMMEDIATELY (race: TAB_READY can fire before set)
        const newChatUrl = NEW_CHAT_URLS[request.platform] || NEW_CHAT_URLS[data.platform] || NEW_CHAT_URLS['claude'];
        const newTab = await chrome.tabs.create({ url: newChatUrl });
        pendingRebirths.set(newTab.id, {
          mdContent,
          filename,
          sourceTabId: sourceTab.id,
          timestamp: Date.now()
        });

        console.log('[LISA Phoenix] Rebirth initiated — new tab ' + newTab.id + ' → ' + newChatUrl);
        sendResponse({ success: true, newTabId: newTab.id });
      } catch (error) {
        console.error('[LISA Phoenix] Rebirth error:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  // ── PHOENIX TAB READY: new tab signals composer is ready ──
  if (request.type === 'PHOENIX_TAB_READY') {
    const tabId = sender.tab?.id;
    const pending = pendingRebirths.get(tabId);
    if (pending) {
      (async () => {
        // Retry injection up to 3 times with increasing delay
        let result = null;
        let lastErr = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            result = await sendMessageWithTimeout(tabId, {
              action: 'injectFileAttachment',
              filename: pending.filename,
              content: pending.mdContent,
              mimeType: 'text/markdown'
            }, 15000);
            console.log('[LISA Phoenix] Handoff injected into tab ' + tabId + ' (attempt ' + attempt + ')');
            break;
          } catch (err) {
            lastErr = err;
            console.warn('[LISA Phoenix] Injection attempt ' + attempt + ' failed:', err.message);
            if (attempt < 3) await new Promise(r => setTimeout(r, 2000 * attempt));
          }
        }
        pendingRebirths.delete(tabId);
        if (result) {
          try {
            chrome.tabs.sendMessage(pending.sourceTabId, {
              type: 'PHOENIX_REBIRTH_COMPLETE',
              newTabId: tabId
            });
          } catch (e) { /* source tab may have closed */ }
          sendResponse({ success: true, injected: result });
        } else {
          console.error('[LISA Phoenix] All injection attempts failed:', lastErr?.message);
          sendResponse({ success: false, error: lastErr?.message || 'Injection failed' });
        }
      })();
      return true;
    }
    sendResponse({ success: false, error: 'No pending rebirth for this tab' });
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
    
    console.debug('[LISA] Context menus created');
  });
}

// Create menus on install/update

chrome.runtime.setUninstallURL("https://forms.gle/2Vu8M8NQYP6eKBnR9");
chrome.runtime.onInstalled.addListener((details) => {
  console.debug("[LISA] Extension installed/updated:", details.reason);
  createContextMenus();
  
  // Show "What's new" for updates (not fresh installs)
  if (details.reason === 'update') {
    const currentVersion = chrome.runtime.getManifest().version;
    const previousVersion = details.previousVersion;
    
    // Only show if major or minor version changed (not patch)
    const [currMajor, currMinor] = currentVersion.split('.').map(Number);
    const [prevMajor, prevMinor] = (previousVersion || '0.0.0').split('.').map(Number);
    
    if (currMajor > prevMajor || currMinor > prevMinor) {
      // Store flag to show "What's new" when popup opens
      chrome.storage.local.set({ 
        showWhatsNew: true,
        updatedToVersion: currentVersion,
        changelog: [
          "Fixed code block detection in conversation capture",
          "Fixed user/assistant role detection for Claude",
          "Removed content truncation limits",
          "Payment system improvements"
        ]
      });
      console.debug('[LISA] Update detected:', previousVersion, '->', currentVersion);
    }
  }
});

// Also create menus on service worker startup (in case of restart)
chrome.runtime.onStartup.addListener(() => {
  console.debug('[LISA] Service worker started');
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
    
    if (url.includes('claude.ai/code/')) scriptFile = 'src/content/claude-code-parser.js';
    else if (url.includes('claude.ai')) scriptFile = 'src/content/claude-parser.js';
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
  const title = (compressed.metadata.title || "").replace(/[^a-zA-Z0-9]/g, "-").substring(0, 30);
  const basePrefix = prefix || platform;
  const filePrefix = title ? basePrefix + "-" + title : basePrefix;
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
        platform: snapshotManager.getPlatformName(tab.url),
        lastSeen: Date.now()
      });
    }
  }
});

// Auto-save when AI platform tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  readyTabs.delete(tabId);
  aiPlatformTabs.delete(tabId);
});
console.debug('[LISA] Core compression engine initialized v0.51.6');