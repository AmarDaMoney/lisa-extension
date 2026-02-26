/**
 * LISA Semantic Analyzer
 * Version: 0.48.2
 * 
 * Transforms raw extracted messages into structured semantic format.
 * Fails gracefully - returns original data if analysis fails.
 * Can be used by any parser.
 */

const SemanticAnalyzer = {
  
  severityPatterns: [
    { regex: /\b(C-\d+|CRITICAL)\b/gi, level: 'critical' },
    { regex: /\b(H-\d+|HIGH)\b/gi, level: 'high' },
    { regex: /\b(M-\d+|MEDIUM)\b/gi, level: 'medium' },
    { regex: /\b(L-\d+|LOW)\b/gi, level: 'low' }
  ],

  actionPatterns: [
    { regex: /\b(TODO|FIXME|HACK)\b:?\s*(.{10,80})/gi, type: 'todo' },
    { regex: /\b(SET|DELETE|RUN|DEPLOY|COMMIT|PUSH|MERGE)\b\s+(.{5,100})/gi, type: 'command' },
    { regex: /\bgit\s+(push|pull|commit|checkout|merge|rebase)\b[^.;\n]{0,40}/gi, type: 'git' },
    { regex: /\bnpm\s+(install|run|build|test)\b[^.;\n]{0,40}/gi, type: 'npm' }
  ],

  filePattern: /(?:^|\s)((?:src|lib|app|pages|components|utils|server|public)\/[\w\-\/]+\.(?:js|ts|jsx|tsx|json|css|html|py|md))/gm,

  gitRefPattern: /\b(?:branch|commit|origin\/)([\w\-\/]+)\b/gi,

  extractSeverities(text) {
    const found = [];
    for (const { regex, level } of this.severityPatterns) {
      const matches = text.match(regex);
      if (matches) {
        matches.forEach(m => found.push({ tag: m, level }));
      }
    }
    return found;
  },

  extractFilePaths(text) {
    const matches = text.match(this.filePattern) || [];
    return [...new Set(matches.map(m => m.trim()))];
  },

  extractActions(text) {
    const actions = [];
    for (const { regex, type } of this.actionPatterns) {
      let match;
      const re = new RegExp(regex.source, regex.flags);
      while ((match = re.exec(text)) !== null) {
        actions.push({
          type,
          command: match[0].trim(),
          detail: match[2] ? match[2].trim() : null
        });
      }
    }
    return actions;
  },

  extractGitRefs(text) {
    const matches = text.match(this.gitRefPattern) || [];
    return [...new Set(matches.map(m => m.trim()))];
  },

  detectTopic(content) {
    const lower = content.toLowerCase();
    if (lower.includes('security') || lower.includes('vulnerab') || lower.includes('exploit')) return 'security';
    if (lower.includes('bug') || lower.includes('fix') || lower.includes('error')) return 'bugfix';
    if (lower.includes('test') || lower.includes('spec')) return 'testing';
    if (lower.includes('refactor') || lower.includes('clean')) return 'refactor';
    if (lower.includes('feature') || lower.includes('add') || lower.includes('implement')) return 'feature';
    if (lower.includes('config') || lower.includes('setup') || lower.includes('install')) return 'config';
    if (lower.includes('doc') || lower.includes('readme') || lower.includes('comment')) return 'documentation';
    return 'general';
  },

  analyze(rawExtraction) {
    try {
      if (!rawExtraction || !rawExtraction.messages || rawExtraction.messages.length === 0) {
        return rawExtraction;
      }

      const allText = rawExtraction.messages.map(m => m.content).join('\n');
      const allFiles = this.extractFilePaths(allText);
      const allGitRefs = this.extractGitRefs(allText);
      const allSeverities = this.extractSeverities(allText);

      const semanticAnchors = {};
      let anchorIndex = 1;

      rawExtraction.messages.forEach((msg, idx) => {
        if (msg.content.length < 30) return;

        const severities = this.extractSeverities(msg.content);
        const files = this.extractFilePaths(msg.content);
        const actions = this.extractActions(msg.content);
        const topic = this.detectTopic(msg.content);

        if (severities.length > 0 || files.length > 0 || actions.length > 0 || msg.content.length > 100) {
          const id = `SA${String(anchorIndex).padStart(3, '0')}`;
          semanticAnchors[id] = {
            topic,
            role: msg.role,
            content: msg.content.substring(0, 200) + (msg.content.length > 200 ? '...' : ''),
            severity: severities.length > 0 ? severities[0].level : null,
            files: files.slice(0, 5),
            tags: severities.map(s => s.tag)
          };
          anchorIndex++;
        }
      });

      const actionVectors = {};
      let actionIndex = 1;
      const allActions = this.extractActions(allText);

      allActions.slice(0, 10).forEach(action => {
        const id = `AV${String(actionIndex).padStart(3, '0')}`;
        actionVectors[id] = {
          action: action.command,
          type: action.type,
          priority: action.type === 'command' ? 'high' : 'medium',
          status: 'extracted'
        };
        actionIndex++;
      });

      const topics = [...new Set(Object.values(semanticAnchors).map(a => a.topic))];
      const reconstructionProtocol = {
        method: 'semantic_anchoring',
        anchor_count: Object.keys(semanticAnchors).length,
        action_count: Object.keys(actionVectors).length,
        key_themes: topics.slice(0, 5),
        files_touched: allFiles.slice(0, 10),
        git_refs: allGitRefs.slice(0, 5),
        severities_found: [...new Set(allSeverities.map(s => s.level))]
      };

      return {
        ...rawExtraction,
        session_metadata: {
          platform: rawExtraction.platform,
          sessionId: rawExtraction.conversationId,
          extractedAt: rawExtraction.extractedAt,
          messageCount: rawExtraction.messageCount,
          enriched: true
        },
        semantic_anchors: semanticAnchors,
        action_vectors: actionVectors,
        reconstruction_protocol: reconstructionProtocol
      };

    } catch (err) {
      console.warn('[LISA SemanticAnalyzer] Analysis failed, returning raw:', err.message);
      return rawExtraction;
    }
  }
};
