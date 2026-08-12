// LISA Core - Semantic Compression Engine
// Background Service Worker (Manifest V3)
// v0.52.1 - Auto-embed integrity hash for Premium, subscription auto-renewal/cancellation notice

// Shared snapshot schema — one definition of where content lives.
// Must load before any code that reads snapshots.
importScripts('../shared/snapshot-shim.js');

// Safe text extraction — m.content can be a string, an array of
// content blocks (Claude API), or an object. Only strings pass through;
// arrays get their text parts joined; objects are skipped.
function msgText(m) {
  const raw = m && (m.content || m.text || m.v);
  if (!raw) return '';
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) {
    return raw
      .filter(b => b && typeof b === 'object' && b.type === 'text' && typeof b.text === 'string')
      .map(b => b.text)
      .join('\n');
  }
  return '';
}

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
      'FILE','LINE','NODE','NAME','TYPE','DATA','EACH','PUSH','PULL','STEP','TEST','WAIT',
      'QUICK','INDEX','ACTIVE','WORKING','MEMORY','INJECTION','REBIRTH','SMARTER','FULL',
      'STATE','SNAPSHOT','MODE','ADAPTIVE','CONVERSATION','RECENT','EARLIER','CONTEXT',
      'OPEN','CLOSE','START','BLOCK','CHECK','BUILD','MATCH','ABORT','REPLACE','UPDATE']);
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
      if (type === 'hashtags') matches = matches.filter(m => !/^#[0-9a-fA-F]{3,8}$/.test(m) && !/^#\d+$/.test(m));
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
      { pattern: /(\w+)\s+(?:requires?|depends on|needs)\s+(\w+)/gi, type: 'requires' },
      { pattern: /(\w+)\s+(?:implements?|builds|provides)\s+(\w+)/gi, type: 'implements' },
      { pattern: /(\w+)\s+(?:excludes?|replaces|overrides)\s+(\w+)/gi, type: 'excludes' },
      { pattern: /(\w+)\s+(?:references?|calls|uses|imports?)\s+(\w+)/gi, type: 'references' },
      { pattern: /(\w+)\s+(?:triggers?|causes?|leads? to|fires?)\s+(\w+)/gi, type: 'triggers' },
      { pattern: /(\w+)\s+(?:supports?|enables?|allows?)\s+(\w+)/gi, type: 'supports' },
      { pattern: /(\w+)\s+(?:contradicts?|conflicts? with|breaks?)\s+(\w+)/gi, type: 'contradicts' },
      { pattern: /(\w+)\s+(?:supersedes?|upgrades?|extends?)\s+(\w+)/gi, type: 'supersedes' }
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
    // Only check first sentence for question markers (prevents misclassifying
    // long assistant responses that contain rhetorical questions)
    const firstSentence = (text || '').split(/[.!?\n]/)[0] || '';
    const intents = {
      question: /\?$/.test(firstSentence.trim()) || /^(?:what|how|why|when|where|who|can|could|would|should)/i.test(text),
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

  // Working Memory Register — extract cognitive state from conversation
  extractWorkingMemory(messages) {
    const memory = {
      objectives: [],
      resolved: [],
      blocked: [],
      next: [],
      decisions: []
    };
    const seen = { objectives: new Set(), resolved: new Set(), blocked: new Set(), next: new Set(), decisions: new Set() };

    // Shape guard: compressed snapshots store `summary`, not `content`.
    // Without this, every message yields '' and the register returns
    // silently empty - indistinguishable from an uneventful session.
    const usable = messages.filter(m => msgText(m).length >= 15).length;
    if (messages.length > 0 && usable === 0) {
      const note = 'Unavailable - snapshot is compressed; original text not retained.';
      memory.objectives.push(note);
      memory.resolved.push({ text: note, source: 'guard' });
      memory.blocked.push({ text: note, source: 'guard' });
      memory.next.push({ text: note, source: 'guard' });
      memory.decisions.push({ text: note, source: 'guard' });
      return memory;
    }

    // Scan all messages for cognitive state signals
    for (let i = 0; i < messages.length; i++) {
      const text = msgText(messages[i]);
      if (!text || text.length < 15) continue;
      const lines = text.split('\n');
      const isRecent = i >= Math.floor(messages.length * 0.7);
      let inFence = false;

      for (let li = 0; li < lines.length; li++) {
        const trimmed = lines[li].trim();

        // Fence tracking: never scan inside code blocks
        if (/^```/.test(trimmed)) { inFence = !inFence; continue; }
        if (inFence) continue;
        if (!trimmed || trimmed.length < 10) continue;

        // POSITIVE RULE: scan only lines the author marked as structure
        const bulletMatch = /^(?:[-*\u2022\u2192\u2713\u2714\u2705\u26a0]|\[[ xX]\]|\d+\.)\s+/.exec(trimmed);
        const labelMatch = bulletMatch ? null
          : /^(?:blocked|todo|next|issue|waiting on|decision|fixed|done|resolved|shipped)\s*:/i.exec(trimmed);
        if (!bulletMatch && !labelMatch) continue;

        const marker = (bulletMatch || labelMatch)[0].toLowerCase();
        const body = trimmed.slice(marker.length).trim();
        if (body.length < 8 || body.length > 200) continue;
        const key = body.substring(0, 40).toLowerCase();

        // Resolved: completion markers, all messages
        if (/^[\u2713\u2714\u2705]/.test(marker) || /^\[[x]\]/.test(marker)
            || /^(?:fixed|done|resolved|shipped)\s*:/.test(marker)) {
          if (!seen.resolved.has(key)) {
            seen.resolved.add(key);
            memory.resolved.push({ text: body, source: 'extracted' });
          }
        }
        // Blocked: recency-gated
        else if (isRecent && (/^[\u26a0]/.test(marker) || /^(?:blocked|issue|waiting on)\s*:/.test(marker)
                 || /\b(?:blocked|stuck|waiting on|failing|broken|not working)\b/i.test(body))) {
          if (!seen.blocked.has(key)) {
            seen.blocked.add(key);
            memory.blocked.push({ text: body, source: 'extracted' });
          }
        }
        // Decisions: all messages, strong signals only
        else if (/^decision\s*:/.test(marker)
                 || /\b(?:we'?ll use|let'?s (?:replace|use|go with|keep|drop|add|build|make|switch)|decided to|agreed to|going with|the plan is)\b/i.test(body)) {
          if (!seen.decisions.has(key)) {
            let rationale = '';
            if (li < lines.length - 1) {
              const nextLine = lines[li + 1].trim();
              if (/^(?:because|since|the reason|that way|so that|this (?:means|ensures|prevents|avoids))/i.test(nextLine)) {
                rationale = nextLine;
              }
            }
            seen.decisions.add(key);
            memory.decisions.push({ text: rationale ? body + ' \u2014 ' + rationale : body, source: 'extracted' });
          }
        }
        // Next: recency-gated
        else if (isRecent && (/^(?:todo|next)\s*:/.test(marker) || /^\[ \]/.test(marker)
                 || /\b(?:next session|next step|still need to|remaining|upcoming)\b/i.test(body))) {
          if (!seen.next.has(key)) {
            seen.next.add(key);
            memory.next.push({ text: body, source: 'extracted' });
          }
        }
      }
    }
    // Extract current objective from last few user messages
    for (let i = messages.length - 1; i >= Math.max(0, messages.length - 10); i--) {
      if (messages[i].role !== 'user') continue;
      const text = msgText(messages[i]);
      if (!text || text.length < 15 || text.length > 300) continue;
      // Skip code outputs and confirmations
      if (/^(?:done|ok|yes|sure|syntax|match|both|empty|✅)/i.test(text.trim())) continue;
      if (/\b(?:let'?s|want to|can we|how about|I'?d like|please|build|create|add|fix|implement)\b/i.test(text)) {
        const clean = text.trim().split('\n')[0].substring(0, 150);
        if (!seen.objectives.has(clean.substring(0, 40))) {
          seen.objectives.add(clean.substring(0, 40));
          memory.objectives.push(clean);
          if (memory.objectives.length >= 3) break;
        }
      }
    }

    // Deduplicate: remove items from "next" that appear in "resolved"
    const resolvedLower = new Set(memory.resolved.map(r => r.text.toLowerCase().substring(0, 30)));
    memory.next = memory.next.filter(n => !resolvedLower.has(n.text.toLowerCase().substring(0, 30)));

    // Cap each category
    memory.objectives = memory.objectives.slice(0, 3);
    memory.resolved = memory.resolved.slice(-10);
    memory.blocked = memory.blocked.slice(-5);
    memory.next = memory.next.slice(-8);
    memory.decisions = memory.decisions.slice(-8);

    return memory;
  }

  // Artifact classifier — detect code block type from language hint + content
  classifyArtifact(lang, content) {
    lang = (lang || '').toLowerCase().trim();
    const c = (content || '').trim();
    // Shell commands
    if (lang === 'bash' || lang === 'sh' || lang === 'shell' || lang === 'zsh') {
      if (/^(git |npm |pip |cd |mkdir |rm |cp |mv |chmod |curl |wget |docker )/.test(c)) return 'command';
      if (/^(sed |grep |cat |head |tail |wc |find |awk )/.test(c)) return 'command';
      if (/^cat\s*>/.test(c) || /<<\s*'?[A-Z]+/.test(c)) return 'script';
      return 'command';
    }
    // Config files
    if (lang === 'json' || lang === 'yaml' || lang === 'yml' || lang === 'toml' || lang === 'ini' || lang === 'env') return 'config';
    if (/^{/.test(c) && /"[^"]+"\s*:/.test(c) && !lang) return 'config';
    // Output/logs
    if (!lang && (/^(Match count|Syntax OK|✅|❌|Total:|Error:|Warning:)/m.test(c) || /^\s*\d+[\s:]/m.test(c))) return 'output';
    // Diffs/patches
    if (lang === 'diff' || lang === 'patch' || /^[-+]{3}\s/.test(c) || /^@@\s/.test(c)) return 'patch';
    // SQL
    if (lang === 'sql' || /^(SELECT|INSERT|CREATE|ALTER|DROP|UPDATE)\s/i.test(c)) return 'query';
    // CSS
    if (lang === 'css' || lang === 'scss' || lang === 'less') return 'style';
    // HTML/markup
    if (lang === 'html' || lang === 'xml' || lang === 'svg') return 'markup';
    // Code (general)
    if (lang === 'javascript' || lang === 'js' || lang === 'typescript' || lang === 'ts' ||
        lang === 'python' || lang === 'py' || lang === 'python3' || lang === 'java' ||
        lang === 'c' || lang === 'cpp' || lang === 'rust' || lang === 'go') return 'code';
    // Infer from content if no language tag
    if (!lang) {
      if (/^(function |const |let |var |class |import |export |async |def |if \(|for \()/m.test(c)) return 'code';
      if (/^\$\s/.test(c)) return 'command';
    }
    return lang ? 'code' : 'text';
  }

  // Stable message ID — deterministic short hash from content + index
  messageId(text, index) {
    const input = (index || 0) + ':' + (text || '').substring(0, 200);
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
    }
    return 'msg-' + (hash >>> 0).toString(36).padStart(6, '0');
  }

  // Density scorer for adaptive rebirth mode
  // Returns numeric score — higher means denser content. Used by the
  // percentile split to rank turns against each other, not against a
  // fixed threshold.
  scoreDensity(text) {
    if (!text || text.length < 10) return 0;
    let score = 0;
    // Code blocks (triple backtick)
    const codeBlocks = (text.match(/```/g) || []).length / 2;
    score += Math.min(codeBlocks, 3) * 3;
    // Inline code spans
    if (/`[^`]+`/.test(text)) score += 1;
    // LaTeX / math expressions
    if (/\\[[(]|\$\$.+?\$\$|\.(?:frac|sum|int|max|min)\b/s.test(text)) score += 3;
    // Numbered or bulleted lists (3+ items)
    const listItems = (text.match(/(?:^|\n)\s*(?:\d+[.)]\s|-\s|\*\s)/g) || []).length;
    if (listItems >= 3) score += 2;
    // Long message (500+ chars = substantive)
    if (text.length >= 500) score += 1;
    if (text.length >= 1500) score += 1;
    if (text.length >= 3000) score += 1;
    // URLs (reference material)
    const urls = (text.match(/https?:\/\//g) || []).length;
    if (urls >= 1) score += 1;
    // Technical terms (CamelCase or UPPER_CASE identifiers)
    const techTerms = (text.match(/\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b/g) || []).length;
    if (techTerms >= 3) score += 1;
    // File paths
    if (/(?:src|lib|dist|bin)\/\w+/.test(text)) score += 1;
    // Unfenced code: indented blocks or code-like syntax without backticks
    const indentedLines = (text.match(/(?:^|\n)(?:    |\t)\S.*/g) || []).length;
    if (indentedLines >= 4) score += 2;
    // Code syntax patterns (function/const/class/import/if/for without backticks)
    const codeSyntax = (text.match(/(?:^|\n)\s*(?:function |const |let |var |class |import |export |if \(|for \(|return |=>|\{$|\}$)/gm) || []).length;
    if (codeSyntax >= 3) score += 3;
    return score;
  }

  compress(conversation) {
    const compressed = {
      metadata: {
        lisaVersion: '0.52.1',
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
    if (typeof text !== 'string') {
      try { text = JSON.stringify(text); } catch(e) { return ''; }
    }
    // Strip ChatGPT citation syntax
    text = text.replace(/filecite\w+/g, '');
    // Fences must open and close a line of their own. Matching them
    // inline let a sentence that merely mentions two fence sequences
    // delete itself and everything between - which corrupted the
    // State Snapshot whenever this code was discussed with an AI.
    text = text.replace(/^[ \t]*```[a-z0-9]*[ \t]*\r?$[\s\S]*?^[ \t]*```[ \t]*\r?$/gmi, ' ');
    // Unwrap inline spans - keep the text, drop the delimiters.
    // These carry the technical nouns of the sentence (identifiers,
    // filenames, field names); deleting them left fluent summaries
    // about nothing.
    text = text.replace(/`([^`]+)`/g, '$1');
    // Strip console/log output noise. Two patterns were dropped: '>' is a
    // markdown blockquote far more often than a shell prompt, and \d+[:|]
    // matched numbered points and clock times as readily as grep -n output.
    // Together they removed 938 chars from one 2,649-char turn - quoted
    // material and enumerated arguments, not noise. '$' now requires the
    // trailing space of a shell prompt.
    text = text.replace(/^\s*(?:matches:|replaced|aborted|syntax|\$\s|\[LISA).*/gm, '');
    // Strip bash/command lines. The command word alone is not enough -
    // "git handles this differently" is a sentence, not a command. Require
    // something command-shaped after it: a flag, a path, or a quoted arg.
    text = text.replace(/^\s*(?:sed|grep|python3?|node|git|cat|head|tail|wc|cd|bash)\s+(?:-{1,2}[a-z]|[.~/]|["'][^"']*["']|[a-z0-9_.-]+\.[a-z0-9]{1,4}\b).*/gmi, '');
    text = text.trim();
    // Deduplicate before scoring. A sentence repeated in the source -
    // a draft and its revision, a quoted reply - scores identically
    // twice and lands in the output twice, side by side.
    const seenSentence = new Set();
    const sentences = text.split(/[.!?]+/).filter(s => {
      const t = s.trim();
      if (t.length <= 10) return false;
      const k = t.toLowerCase().replace(/\s+/g, ' ');
      if (seenSentence.has(k)) return false;
      seenSentence.add(k);
      return true;
    });
    
    if (sentences.length <= 2) {
      // End at sentence boundary, not mid-word
      const cut = text.substring(0, 500);
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
    
    // Take top 4 sentences by score, maintain original order
    const top = scored.sort((a, b) => b.score - a.score).slice(0, 4);
    top.sort((a, b) => a.index - b.index);
    
    return top.map(s => s.text).join('. ').substring(0, 800);
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
    const allText = sample.map(m => msgText(m)).join(' ');
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
      generated_by:      'LISA v0.52.1',
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
      generated_by:      'LISA v0.52.1'
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
    this.MAX_SNAPSHOTS = 200;
    this.STORAGE_KEY = 'lisaSnapshots';
    this.SETTINGS_KEY = 'lisaAutoSaveSettings';
  }





  async decrementFreePool() {
    try {
      const result = await chrome.storage.sync.get(['usageStats']);
      if (result.usageStats && result.usageStats.lifetimeFreePool > 0) {
        result.usageStats.lifetimeFreePool--;
        await chrome.storage.sync.set({ usageStats: result.usageStats });
      }
    } catch (e) {
      console.debug('[LISA] Pool decrement error:', e.message);
    }
  }

  async saveSnapshot(conversation, source = 'auto') {
    try {
      const data = await chrome.storage.local.get(this.STORAGE_KEY);
      const snapshots = data[this.STORAGE_KEY] || [];

      // Phase 6: Check if this is an update to existing conversation (same URL)
      const existing = snapshots.find(s => s.url === conversation.url && s.source === source);

      // Schema v2: separate original content from derived data.
      // capture  — the original conversation, never modified after save
      // derived  — tokens, summaries, AI results, computed at save time
      // raw      — lean compatibility shim for unconverted popup.js sites
      //            (NOT the entire conversation object — that was the
      //            double-wrap bug that created snapshot.raw.raw)
      const msgs = conversation.messages || [];
      const snapshot = {
        id: 'snap-' + Date.now(),
        schema: 2,
        platform: conversation.platform || this.getPlatformName(conversation.url),
        url: conversation.url,
        title: conversation.title || 'Untitled',
        messageCount: conversation.messageCount || msgs.length,
        savedAt: new Date().toISOString(),
        source: source,
        format: conversation.format || null,
        capture: {
          messages: msgs,
          format: conversation.format || 'raw',
          content: conversation.content || null
        },
        derived: {
          markdown: conversation.rebirthHandoff || conversation.markdownContent || null,
          rebirthMode: conversation.rebirthMode || null,
          semanticTokens: conversation.semanticTokens || null,
          actionVectors: conversation.action_vectors || null,
          reconstructionProtocol: conversation.reconstruction_protocol || null
        },
        // raw removed — all consumers now check capture/derived first,
        // falling back to raw only for v1 snapshots already on disk.
    };
      // Carry phoenix lineage if present
      if (conversation.phoenix) snapshot.phoenix = conversation.phoenix;

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
        if (msgs.length > 0) {
          snapshot.derived.lisaTokens = msgs.map((m, i) => {
            const text = msgText(m);
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
          console.debug('[LISA] Pre-tokenized ' + snapshot.derived.lisaTokens.length + ' messages for instant rebirth');
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

// AI-compressed snapshots carry a working memory register the regex
// extractor cannot produce: action_vectors from the compression backend.
// The data sits at raw.raw on snapshots whose save path double-wrapped.
// Free-tier snapshots have none, and are left exactly as they were.
function mergeAiWorkingMemory(memory, data) {
  if (!memory || !data) return memory;
  let r = (data.raw && typeof data.raw === 'object') ? data.raw : {};
  if (r.raw && typeof r.raw === 'object' && !r.action_vectors) r = r.raw;

  const vectors = r.action_vectors;
  if (!vectors || typeof vectors !== 'object') return memory;
  const keys = Object.keys(vectors);
  if (keys.length === 0) return memory;

  // Guard notes are placeholders for absent data. Real data supersedes them.
  ['objectives', 'resolved', 'blocked', 'next', 'decisions'].forEach(k => {
    memory[k] = (memory[k] || []).filter(e => !(e && e.source === 'guard'));
  });
  memory.objectives = memory.objectives.filter(o =>
    typeof o !== 'string' || o.indexOf('Unavailable - snapshot is compressed') !== 0);

  keys.forEach(k => {
    const v = vectors[k];
    if (!v || typeof v.action !== 'string' || !v.action.trim()) return;
    let line = v.action.trim();
    if (v.priority) line += ' [' + v.priority + ']';
    if (Array.isArray(v.dependencies) && v.dependencies.length > 0) {
      line += ' (depends on: ' + v.dependencies.join('; ') + ')';
    }
    memory.next.push({ text: line, source: 'ai' });
  });

  const themes = r.reconstruction_protocol && r.reconstruction_protocol.key_themes;
  if (Array.isArray(themes)) {
    themes.filter(t => typeof t === 'string' && t.trim())
          .forEach(t => memory.objectives.push(t.trim()));
  }

  return memory;
}

function generateContinuationHandoff(data, platform, mode) {
  const messages = data.messages || [];
  const title = data.title || 'Untitled';
  mode = mode || 'adaptive';

  let earlySummary = '';
  let recentContent = '';
  let earlyMessages, recentMessages;

  if (mode === 'full') {
    // Full fidelity: every message verbatim
    earlyMessages = [];
    recentMessages = messages;

    // State snapshot for full fidelity — compass before the wall of text
    const ffCompressor = new LISACompressor();
    const ffSnapshots = [];
    for (let i = messages.length - 1; i >= 0 && ffSnapshots.length < 3; i--) {
      if (messages[i].role === 'assistant') {
        const t = msgText(messages[i]);
        // Skip code-heavy turns — they produce garbled snapshots
        const codeLen = (t.match(/```[\s\S]*?```/g) || []).reduce((a, b) => a + b.length, 0);
        if (codeLen > t.length * 0.5) continue;
        const s = ffCompressor.summarize(t);
        if (s && s.length > 20 && !/\b(?:suppose|imagine|for example|consider|let'?s say|hypothetically)\b|^(?:Wait|Actually|Hmm|Found it|Let me|Good —|Now |The |Command #)/i.test(s)) ffSnapshots.unshift(s);
      }
    }
    if (ffSnapshots.length > 0) {
      earlySummary = '## STATE SNAPSHOT\n\n';
      earlySummary += '> Current working state from recent assistant turns:\n\n';
      ffSnapshots.forEach(s => { earlySummary += '- ' + s + '\n'; });
      earlySummary += '\n';
    }


    // Working Memory Register for full fidelity
    const ffWMR = mergeAiWorkingMemory(ffCompressor.extractWorkingMemory(messages), data);
    // Always render the register — a silently absent block is
    // indistinguishable from a session with nothing to report.
    {
      earlySummary += '## ACTIVE WORKING MEMORY\n\n';
      earlySummary += '### Current Objective\n';
      if (ffWMR.objectives.length > 0) {
        ffWMR.objectives.forEach(o => { earlySummary += '- ' + o + '\n'; });
      } else {
        earlySummary += '_None detected in recent window._\n';
      }
      earlySummary += '\n';
      earlySummary += '### Resolved\n';
      if (ffWMR.resolved.length > 0) {
        ffWMR.resolved.forEach(r => { earlySummary += '\u2713 ' + r.text + '\n'; });
      } else {
        earlySummary += '_None detected in recent window._\n';
      }
      earlySummary += '\n';
      earlySummary += '### Blocked\n';
      if (ffWMR.blocked.length > 0) {
        ffWMR.blocked.forEach(b => { earlySummary += '\u26a0 ' + b.text + '\n'; });
      } else {
        earlySummary += '_None detected in recent window._\n';
      }
      earlySummary += '\n';
      earlySummary += '### Next\n';
      if (ffWMR.next.length > 0) {
        ffWMR.next.forEach(n => { earlySummary += '- ' + n.text + '\n'; });
      } else {
        earlySummary += '_None detected in recent window._\n';
      }
      earlySummary += '\n';
      earlySummary += '### Decisions\n';
      if (ffWMR.decisions.length > 0) {
        ffWMR.decisions.forEach(d => { earlySummary += '\u2022 ' + d.text + '\n'; });
      } else {
        earlySummary += '_None detected in recent window._\n';
      }
      earlySummary += '\n';
    }

    recentContent = '## FULL CONVERSATION (' + messages.length + ' messages \u2014 verbatim)\n\n';
    messages.forEach(m => {
      const role = (m.role === 'user') ? 'User' : 'Assistant';
      const text = msgText(m);
      if (text) recentContent += '### ' + role + '\n' + text + '\n\n';
    });
  } else if (mode === 'semantic') {
    // Semantic: LISA-structured early context + last N verbatim
    const RECENT_TURNS = 10;
    const recentStart = Math.max(0, messages.length - RECENT_TURNS);
    earlyMessages = messages.slice(0, recentStart);
    recentMessages = messages.slice(recentStart);

    if (earlyMessages.length > 0) {
      const preTokens = data.derived?.lisaTokens || data.lisaTokens || data.raw?.lisaTokens;
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
          const content = msgText(m);
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
      const text = msgText(m);
      if (text) recentContent += '### ' + role + '\n' + text + '\n\n';
    });

  } else {
    // Adaptive: density-scored per-turn fidelity selection
    const compressor = new LISACompressor();
    earlyMessages = [];
    recentMessages = messages;

    // Step 1: Score every turn
    const densityScores = messages.map(m => {
      const text = msgText(m);
      return compressor.scoreDensity(text);
    });
    // Step 2: Percentile split — rank turns against each other, not
    // an absolute bar. In a coding session every turn crosses a fixed
    // threshold; relative ranking ensures a meaningful verbatim/semantic
    // split regardless of conversation type.
    const len = messages.length;
    const verbatimPct = len < 15 ? 0.70
                      : len < 50 ? 0.45
                      : len < 100 ? 0.35
                      : 0.25;
    const sorted = densityScores.map((s, i) => ({ s, i })).sort((a, b) => b.s - a.s);
    const verbatimSlots = Math.max(1, Math.round(len * verbatimPct));
    const verbatimIndices = new Set(sorted.slice(0, verbatimSlots).map(x => x.i));
    const isHighDensity = densityScores.map((_, i) => verbatimIndices.has(i));

    // Step 3: Adjacency smoothing — promote low-density turns to verbatim
    // if both neighbors are high-density (prevent semantic islands)
    for (let i = 1; i < isHighDensity.length - 1; i++) {
      if (!isHighDensity[i] && isHighDensity[i - 1] && isHighDensity[i + 1]) {
        isHighDensity[i] = true;
      }
    }
    // Last 5 messages always verbatim (active working context)
    for (let i = Math.max(0, messages.length - 5); i < messages.length; i++) {
      isHighDensity[i] = true;
    }

    // Step 4: Count modes for reporting
    const verbatimCount = isHighDensity.filter(Boolean).length;
    const semanticCount = messages.length - verbatimCount;

    // Step 5: State Snapshot removed — regex-summarized fragments produced
    // garbled output. AI WMR now provides the working state when available.
    // Free users get the WMR section (regex) without the garbled snapshot.

    // Step 6: Working Memory Register — cognitive state extraction
    // AI-extracted WMR takes priority when available (Pro/PAYG users).
    // Falls back to regex for free tier.
    const aiWMR = data.aiWMR || null;
    let wmrBlock = '';
    let wmrHasAI = false;
    if (aiWMR) {
      wmrHasAI = true;
      wmrBlock = '## ACTIVE WORKING MEMORY (AI-extracted)\n\n';
      const sections = [
        { title: 'Current Objective', key: 'objectives', marker: '- ' },
        { title: 'Resolved', key: 'resolved', marker: '\u2713 ' },
        { title: 'Blocked', key: 'blocked', marker: '\u26a0 ' },
        { title: 'Next', key: 'next_actions', marker: '- ' },
        { title: 'Decisions', key: 'decisions', marker: '\u2022 ' }
      ];
      sections.forEach(s => {
        wmrBlock += '### ' + s.title + '\n';
        const items = aiWMR[s.key] || [];
        if (items.length > 0) {
          items.forEach(item => { wmrBlock += s.marker + item + '\n'; });
        } else {
          wmrBlock += '_None detected._\n';
        }
        wmrBlock += '\n';
      });
    } else {
      const workingMemory = mergeAiWorkingMemory(compressor.extractWorkingMemory(messages), data);
      wmrBlock = '## ACTIVE WORKING MEMORY\n\n';
      const sections = [
        { title: 'Current Objective', items: workingMemory.objectives, marker: '- ', isString: true },
        { title: 'Resolved', items: workingMemory.resolved, marker: '\u2713 ' },
        { title: 'Blocked', items: workingMemory.blocked, marker: '\u26a0 ' },
        { title: 'Next', items: workingMemory.next, marker: '- ' },
        { title: 'Decisions', items: workingMemory.decisions, marker: '\u2022 ' }
      ];
      sections.forEach(s => {
        wmrBlock += '### ' + s.title + '\n';
        if (s.items.length > 0) {
          s.items.forEach(item => {
            wmrBlock += s.marker + (s.isString ? item : item.text) + '\n';
          });
        } else {
          wmrBlock += '_None detected in recent window._\n';
        }
        wmrBlock += '\n';
      });
    }

    // Step 7: Build mixed-fidelity conversation body
    // Skip State Snapshot when almost everything is verbatim — regex-extracted
    // "state" from high-density turns adds noise when the turns themselves are
    // already in the output.


    // Skip WMR when every category is empty — five "None detected" headings
    // waste tokens and look broken. The section appears when regex or AI
    // actually found something.
    // AI WMR always has content worth showing. Regex WMR may be empty.
    if (!wmrHasAI) {
      const emptyCount = (wmrBlock.match(/_None detected/g) || []).length;
      if (emptyCount >= 5) wmrBlock = '';
    }
    earlySummary = wmrBlock;
    recentContent = '## CONVERSATION (' + messages.length + ' messages \u2014 '
      + verbatimCount + ' verbatim, ' + semanticCount + ' ' + (aiWMR ? 'AI-condensed' : 'LISA-condensed') + ')\n\n';

    messages.forEach((m, i) => {
      const role = (m.role === 'user') ? 'User' : 'Assistant';
      const text = msgText(m);
      if (!text) return;

      if (isHighDensity[i]) {
        // Verbatim: full text preserved
        recentContent += '### ' + role + ' [turn ' + (i + 1) + ', verbatim]\n' + text + '\n\n';
      } else {
        // LISA-condensed: semantic translation. AI-disambiguated summary
        // when available (Pro/PAYG), regex tokenization as fallback.
        const aiSummaries = aiWMR && aiWMR.turn_summaries || [];
        const aiTurn = aiSummaries.find(t => t.turn === i + 1);
        if (aiTurn) {
          // AI-condensed: disambiguated summary is the complete representation.
          // No regex metadata — the AI already resolved everything.
          let block = '**[Turn ' + (i + 1) + ', ' + role + ', AI-condensed]**\n';
          block += '> ' + aiTurn.summary.replace(/\n/g, ' ') + '\n';
          recentContent += block + '\n';
        } else {
          // Regex fallback: short turns stay verbatim (condensing inflates them)
          const wordCount = text.split(/\s+/).filter(Boolean).length;
          if (wordCount < 100) {
            let block = '**[Turn ' + (i + 1) + ', ' + role + ', verbatim]**\n';
            block += text.replace(/\n{3,}/g, '\n\n') + '\n';
            recentContent += block + '\n';
          } else {
          const tokens = compressor.tokenize(text);
          const summary = compressor.summarize(text);
          let block = '**[Turn ' + (i + 1) + ', ' + role + ', condensed]**\n';
          if (summary) block += '> ' + summary.replace(/\n/g, ' ') + '\n';
          let meta = [];
          if (tokens.entities && tokens.entities.length > 0) {
            const allVals = tokens.entities.flatMap(e => e.values || []);
            if (allVals.length > 0) meta.push('entities: ' + allVals.slice(0, 8).join(', '));
          }
          if (tokens.concepts && tokens.concepts.length > 0) {
            meta.push('concepts: ' + tokens.concepts.slice(0, 5).map(c => c.term).join(', '));
          }
          if (tokens.relationships && tokens.relationships.length > 0) {
            meta.push('relations: ' + tokens.relationships.slice(0, 3).map(r => r.subject + ' ' + r.type + ' ' + r.object).join('; '));
          }
          const codeBlocks = text.match(/```(\w*)\n([\s\S]*?)```/g) || [];
          if (codeBlocks.length > 0) {
            const types = codeBlocks.map(b => {
              const m = b.match(/```(\w*)\n([\s\S]*?)```/);
              return compressor.classifyArtifact(m[1] || '', m[2] || '');
            });
            meta.push('artifacts: ' + [...new Set(types)].join(', '));
          }
          if (meta.length > 0) block += '> _[' + meta.join(' | ') + ']_\n';
          recentContent += block + '\n';
          } // end else (wordCount >= 100)
        }
      }
    });
  }

  return '# LISA SESSION REBIRTH\n\n'
    + 'Resume this session. Do not re-ask resolved questions or restart work.\n'
    + 'Confirm current state and next action, then proceed.\n\n'
    + '## Lineage\n'
    + '- Parent: ' + title + ' (' + platform + ', ' + messages.length + ' messages)\n'
    + '- Generation: ' + (data.phoenix ? data.phoenix.generation : 1) + ' | Mode: ' + mode + '\n'
    + '- Reborn: ' + new Date().toISOString() + '\n\n'
    + '---\n\n'
    + earlySummary
    + recentContent
    + '---\n'
    + '*LISA Core v0.52.1 \u2022 SAT-CHAIN LLC*\n';
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
          await snapshotManager.decrementFreePool();
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
        await snapshotManager.decrementFreePool();
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

        // 2b. AI WMR extraction — adaptive mode only (blocks rebirth)
        const rebirthMode = request.mode || 'adaptive';
        try {
          if (rebirthMode === 'adaptive') {
          const syncStore = await chrome.storage.sync.get(['licenseKey', 'userTier', 'usageStats', 'installId']);
          const lk = syncStore.licenseKey || syncStore.installId || null;
          const tier = syncStore.userTier || 'free';
          const pool = (syncStore.usageStats || {}).lifetimeFreePool ?? 0;
          // AI WMR for anyone with credits: Pro/PAYG by tier, free users by pool
          if (lk && (tier !== 'free' || pool > 0)) {
            const msgs = data.messages || [];
            // Send last 30 turns — enough for context, cheap enough for 1 credit
            const tail = msgs.slice(-30);
            const formatted = tail.map((m, i) => {
              const role = m.role === 'user' ? 'User' : 'Assistant';
              const text = msgText(m);
              return 'Turn ' + (i + 1) + ' [' + role + ']:\n' + text;
            }).join('\n\n');
            const resp = await fetch('https://lisa-web-backend-production.up.railway.app/api/extract-wmr', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-License-Key': lk },
              body: JSON.stringify({ messages: formatted, provider: 'deepseek' })
            });
            if (resp.ok) {
              const result = await resp.json();
              if (result.success && result.wmr) {
                data.aiWMR = result.wmr;
                console.log('[LISA Phoenix] AI WMR extracted — ' + (result.wmr.turn_summaries || []).length + ' turns disambiguated');
              }
            }
          }
          } // end if (rebirthMode === 'adaptive')
        } catch (wmrErr) {
          console.warn('[LISA Phoenix] AI WMR skipped:', wmrErr.message);
          // Falls through to regex — rebirth continues
        }

        // 3. Generate continuation handoff
        const mdContent = generateContinuationHandoff(data, data.platform, rebirthMode);

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
        data.rebirthMode = rebirthMode;
        await snapshotManager.saveSnapshot(data, 'phoenix-rebirth');
        // Pool deduction handled by phoenix.js gate — not here.
        // (Double-deduction bug: phoenix decrements at the gate,
        //  this line decremented again after save.)

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
              mimeType: 'text/markdown',
              _autoInject: true
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
          // Show fallback toast on the new tab
          try {
            chrome.scripting.executeScript({
              target: { tabId: tabId },
              func: () => {
                const toast = document.createElement('div');
                Object.assign(toast.style, {
                  position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%)',
                  zIndex: '999999', background: 'rgba(15,15,20,0.95)', color: '#e2e8f0',
                  padding: '14px 24px', borderRadius: '12px', fontSize: '13px', lineHeight: '1.5',
                  boxShadow: '0 8px 32px rgba(0,0,0,0.5)', border: '1px solid rgba(251,191,36,0.4)',
                  fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif', maxWidth: '400px',
                  textAlign: 'center'
                });
                toast.innerHTML = '\xf0\x9f\x93\x8e <b>Auto-injection didn\'t go through</b> \u2014 open the LISA extension, go to Library > Rebirths, and tap the inject button to carry your handoff forward.';
                document.body.appendChild(toast);
                setTimeout(() => { toast.style.transition = 'opacity 0.5s'; toast.style.opacity = '0'; setTimeout(() => toast.remove(), 500); }, 15000);
              }
            });
          } catch (e) { /* scripting may not be available */ }
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

    // Copy selection as LISA context (MD-wrapped for AI consumption)
    chrome.contextMenus.create({
      id: 'copy-as-lisa',
      title: '📋 Copy as LISA Context',
      contexts: ['selection']
    }, () => {
      if (chrome.runtime.lastError) {
        console.error('[LISA] Failed to create send-to-ai menu:', chrome.runtime.lastError);
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

  // Generate anonymous install ID for free-tier API tracking
  chrome.storage.sync.get(['installId'], (result) => {
    if (!result.installId) {
      const id = 'free-' + crypto.randomUUID();
      chrome.storage.sync.set({ installId: id });
      console.debug('[LISA] Install ID generated:', id);
    }
  });
  
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
  if (info.menuItemId === 'copy-as-lisa') {
    await handleCopyAsLisa(info, tab);
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

async function handleCopyAsLisa(info, tab) {
  try {
    const selectedText = info.selectionText;
    if (!selectedText || selectedText.trim().length === 0) {
      showNotification('LISA Core', '❌ No text selected');
      return;
    }

    // Detect source platform
    const sourceUrl = info.pageUrl || '';
    let sourcePlatform = 'unknown';
    if (/claude\.ai/.test(sourceUrl)) sourcePlatform = 'Claude';
    else if (/chatgpt\.com|chat\.openai\.com/.test(sourceUrl)) sourcePlatform = 'ChatGPT';
    else if (/gemini\.google/.test(sourceUrl)) sourcePlatform = 'Gemini';
    else if (/mistral\.ai/.test(sourceUrl)) sourcePlatform = 'Mistral';
    else if (/deepseek\.com/.test(sourceUrl)) sourcePlatform = 'DeepSeek';
    else if (/copilot\.microsoft/.test(sourceUrl)) sourcePlatform = 'Copilot';
    else if (/perplexity\.ai/.test(sourceUrl)) sourcePlatform = 'Perplexity';
    else if (/x\.ai|grok\.com/.test(sourceUrl)) sourcePlatform = 'Grok';

    const version = chrome.runtime.getManifest().version;
    const timestamp = new Date().toISOString();

    // Build LISA context wrapper
    let md = '# LISA Context Transfer — Selection\n\n';
    md += '> Selected from ' + sourcePlatform + ' via LISA Core v' + version + '\n';
    md += '> Paste into any AI chat to transfer this context.\n\n';
    md += '---\n\n';
    md += selectedText + '\n\n';
    md += '---\n';
    md += '*LISA Core v' + version + ' • ' + timestamp + '*\n';

    // Copy to clipboard via offscreen or content script
    await chrome.tabs.sendMessage(tab.id, {
      action: 'copyToClipboard',
      text: md
    });

    showNotification('LISA Core', '✅ Copied! ' + selectedText.length + ' chars from ' + sourcePlatform + ' — paste into any AI chat.');

  } catch (error) {
    // Fallback: try writing to clipboard via offscreen document
    try {
      const selectedText = info.selectionText || '';
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['CLIPBOARD'],
        justification: 'Copy LISA context to clipboard'
      });
      await chrome.runtime.sendMessage({ action: 'clipboard-write', text: selectedText });
      showNotification('LISA Core', '✅ Selection copied! Paste into any AI chat.');
    } catch (e2) {
      console.error('[LISA] Copy failed:', e2);
      showNotification('LISA Core', '❌ Copy failed — try selecting text and using Ctrl+C');
    }
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
console.debug('[LISA] Core compression engine initialized v0.52.1');