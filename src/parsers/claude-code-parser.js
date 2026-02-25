// Claude Code Session Parser
// Extracts structured output from Claude Code sessions at claude.ai/code/*
// Produces semantic anchors, action vectors, and reconstruction protocol
// matching the web app format expected by LISA.

class ClaudeCodeParser {
  constructor() {
    this.platform = 'Claude Code';
    this.sessionId = this.extractSessionId();
  }

  extractSessionId() {
    // Extract from URL: https://claude.ai/code/{session_id}
    const match = window.location.pathname.match(/\/code\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : `cc-${Date.now()}`;
  }

  // ============================================================
  // Raw DOM extraction (same selector strategy as claude-parser)
  // ============================================================

  extractRawMessages() {
    const messages = [];
    const messageElements = document.querySelectorAll('[data-test-render-count]');

    messageElements.forEach((element, index) => {
      const isUser =
        element.querySelector('[data-is-streaming="false"]')?.textContent.includes('You') ||
        element.closest('[class*="human"]') !== null;

      const textContent = this.extractTextContent(element);

      if (textContent && textContent.trim().length > 0) {
        messages.push({
          role: isUser ? 'user' : 'assistant',
          content: textContent.trim(),
          index,
          timestamp: new Date().toISOString()
        });
      }
    });

    return messages;
  }

  extractTextContent(element) {
    const clone = element.cloneNode(true);
    clone.querySelectorAll('button, svg, [role="button"]').forEach(el => el.remove());
    return clone.textContent || clone.innerText || '';
  }

  // ============================================================
  // Pattern extractors
  // ============================================================

  detectSeverity(text) {
    // Explicit severity codes: C-1, H-1, M-1, L-1 take priority over word forms
    if (/\bC-\d+\b|\bCRITICAL\b/i.test(text)) return 'CRITICAL';
    if (/\bH-\d+\b|\bHIGH\b/i.test(text)) return 'HIGH';
    if (/\bM-\d+\b|\bMEDIUM\b/i.test(text)) return 'MEDIUM';
    if (/\bL-\d+\b|\bLOW\b/i.test(text)) return 'LOW';
    return null;
  }

  extractFilePaths(text) {
    const paths = new Set();
    // Match file paths like src/file.js, ./path/to/file.py:42, /abs/path.ts:10
    const filePathPattern = /(?:^|[\s"'`(,])(\/?(?:[a-zA-Z0-9_\-]+\/)+[a-zA-Z0-9_\-.]+\.[a-zA-Z]{1,10})(?::(\d+))?/gm;
    let match;
    while ((match = filePathPattern.exec(text)) !== null) {
      const filePath = match[1].replace(/^\.\//, '');
      const entry = match[2] ? `${filePath}:${match[2]}` : filePath;
      paths.add(entry);
    }
    return [...paths];
  }

  extractActionItems(text) {
    const actions = [];
    // Command keywords followed by their target/arguments
    const actionPattern = /\b(SET|DELETE|RUN|DEPLOY|INSTALL|UPDATE|CREATE|REMOVE|CONFIGURE|PUSH|COMMIT|MERGE|REVERT|PATCH)\s+([^\n.!?]{3,80})/gi;
    let match;
    while ((match = actionPattern.exec(text)) !== null) {
      actions.push({ verb: match[1].toUpperCase(), target: match[2].trim() });
    }
    return actions;
  }

  extractBranchCommitRefs(text) {
    const refs = { branches: [], commits: [] };

    // Branch names mentioned after git keywords
    const branchPattern = /(?:branch|checkout|merge|push\s+(?:to\s+)?origin|pull\s+(?:from\s+)?origin)\s+['"]*([a-zA-Z0-9/_\-]+)['"']*/gi;
    let match;
    while ((match = branchPattern.exec(text)) !== null) {
      const branch = match[1].trim();
      if (!refs.branches.includes(branch)) refs.branches.push(branch);
    }

    // Conventional branch name patterns (e.g. claude/fix-xss, feature/auth)
    const namedBranchPattern = /\b((?:claude|feature|fix|hotfix|release|chore|refactor|bugfix)\/[a-zA-Z0-9_\-]+)\b/gi;
    while ((match = namedBranchPattern.exec(text)) !== null) {
      const branch = match[1].trim();
      if (!refs.branches.includes(branch)) refs.branches.push(branch);
    }

    // Short commit hashes (7 hex chars) and full hashes (40 hex chars)
    const commitPattern = /\b([a-f0-9]{7}(?:[a-f0-9]{33})?)\b/g;
    while ((match = commitPattern.exec(text)) !== null) {
      if (!refs.commits.includes(match[1])) refs.commits.push(match[1]);
    }

    return refs;
  }

  extractTags(text) {
    const tagKeywords = [
      'security', 'vulnerability', 'injection', 'xss', 'csrf', 'sqli', 'auth',
      'performance', 'refactor', 'bug', 'fix', 'feature', 'test', 'deploy',
      'config', 'database', 'api', 'logging', 'dependency', 'sanitization'
    ];
    const lower = text.toLowerCase();
    return tagKeywords.filter(kw => lower.includes(kw));
  }

  deriveAnchorTopic(content) {
    const firstLine = content.split(/[\n]/)[0].trim();
    const topic = firstLine.length > 80 ? firstLine.slice(0, 77) + '...' : firstLine;
    return topic || content.slice(0, 80);
  }

  deriveAnchorStatus(content) {
    if (/\b(?:fixed|resolved|done|completed|closed)\b/i.test(content)) return 'resolved';
    if (/\b(?:in.?progress|working.?on|investigating|ongoing)\b/i.test(content)) return 'in_progress';
    return 'identified';
  }

  derivePriority(severity) {
    const map = { CRITICAL: 'critical', HIGH: 'high', MEDIUM: 'medium', LOW: 'low' };
    return map[severity] || 'medium';
  }

  // ============================================================
  // Structured output builders
  // ============================================================

  buildSemanticAnchors(messages) {
    const anchors = {};
    let count = 0;

    messages.forEach(msg => {
      const severity = this.detectSeverity(msg.content);
      const files = this.extractFilePaths(msg.content);
      const tags = this.extractTags(msg.content);

      // Anchor created when message has a severity marker, file references, or
      // security/decision-relevant tags and is substantive (>100 chars)
      const isSubstantive =
        msg.content.length > 100 && (severity || files.length > 0 || tags.length > 0);

      if (isSubstantive) {
        count++;
        const id = `SA${String(count).padStart(3, '0')}`;
        anchors[id] = {
          topic: this.deriveAnchorTopic(msg.content),
          content: msg.content.slice(0, 500),
          severity: severity || 'INFO',
          files,
          status: this.deriveAnchorStatus(msg.content),
          tags
        };
      }
    });

    return anchors;
  }

  buildActionVectors(messages) {
    const vectors = {};
    let count = 0;
    const fullText = messages.map(m => m.content).join('\n');
    const actionItems = this.extractActionItems(fullText);

    actionItems.forEach(item => {
      count++;
      const id = `AV${String(count).padStart(3, '0')}`;
      const isHighPriority = /^(?:DEPLOY|PUSH|COMMIT|MERGE|DELETE)$/.test(item.verb);
      vectors[id] = {
        action: `${item.verb} ${item.target}`,
        owner: 'developer',
        priority: isHighPriority ? 'high' : 'medium',
        status: 'pending'
      };
    });

    return vectors;
  }

  buildReconstructionProtocol(messages, anchors, actionVectors) {
    const fullText = messages.map(m => m.content).join('\n');
    const refs = this.extractBranchCommitRefs(fullText);
    return {
      anchor_count: Object.keys(anchors).length,
      action_count: Object.keys(actionVectors).length,
      branch_refs: refs.branches,
      commit_refs: refs.commits,
      message_count: messages.length
    };
  }

  // ============================================================
  // Main extraction entry point
  // ============================================================

  extractConversation() {
    const rawMessages = this.extractRawMessages();

    if (rawMessages.length === 0) {
      return null;
    }

    const semanticAnchors = this.buildSemanticAnchors(rawMessages);
    const actionVectors = this.buildActionVectors(rawMessages);
    const reconstructionProtocol = this.buildReconstructionProtocol(
      rawMessages, semanticAnchors, actionVectors
    );

    return {
      // Standard fields expected by service-worker / SnapshotManager
      platform: this.platform,
      conversationId: this.sessionId,
      url: window.location.href,
      title: document.title,
      extractedAt: new Date().toISOString(),
      messageCount: rawMessages.length,
      messages: rawMessages,

      // Claude Code structured output (web app format)
      session_metadata: {
        platform: this.platform,
        session_id: this.sessionId,
        url: window.location.href,
        title: document.title,
        captured_at: new Date().toISOString(),
        message_count: rawMessages.length
      },
      semantic_anchors: semanticAnchors,
      action_vectors: actionVectors,
      reconstruction_protocol: reconstructionProtocol
    };
  }

  initializeListener() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'ping') {
        sendResponse({ success: true, platform: this.platform });
        return true;
      }
      if (request.action === 'extractConversation') {
        try {
          const conversation = this.extractConversation();
          sendResponse({ success: true, data: conversation });
        } catch (error) {
          console.error('[LISA] Claude Code extraction error:', error);
          sendResponse({ success: false, error: error.message });
        }
      }
      return true;
    });
  }
}

// Initialize parser when script loads
const parser = new ClaudeCodeParser();
parser.initializeListener();

// Signal that parser is ready
chrome.runtime.sendMessage({
  action: 'parserReady',
  platform: 'Claude Code'
});
