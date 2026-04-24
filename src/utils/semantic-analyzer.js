/**
 * LISA Semantic Analyzer
 * Version: 0.49.5
 * 
 * Transforms raw extracted messages into structured semantic format.
 * Fails gracefully - returns original data if analysis fails.
 * Can be used by any parser.
 */

const SemanticAnalyzer = {
  
  // ===========================================
  // MULTILINGUAL SUPPORT
  // ===========================================
  
  // Language detection patterns (first 500 chars sampled)
  languagePatterns: {
    arabic: /[\u0600-\u06FF\u0750-\u077F]/,
    chinese: /[\u4E00-\u9FFF]/,
    japanese: /[\u3040-\u309F\u30A0-\u30FF]/,
    korean: /[\uAC00-\uD7AF]/,
    cyrillic: /[\u0400-\u04FF]/,
    hebrew: /[\u0590-\u05FF]/
  },
  
  // RTL languages need special handling
  rtlLanguages: ['arabic', 'hebrew'],
  
  // Multilingual topic keywords
  topicKeywords: {
    security: {
      en: ['security', 'vulnerab', 'exploit', 'attack', 'breach', 'auth', 'permission'],
      fr: ['sécurité', 'vulnérab', 'exploit', 'attaque', 'faille', 'auth', 'permission'],
      es: ['seguridad', 'vulnerab', 'exploit', 'ataque', 'brecha', 'auth', 'permiso'],
      ar: ['أمن', 'أمان', 'ثغرة', 'هجوم', 'اختراق'],
      de: ['sicherheit', 'schwachstelle', 'angriff', 'exploit'],
      zh: ['安全', '漏洞', '攻击', '入侵']
    },
    bugfix: {
      en: ['bug', 'fix', 'error', 'issue', 'problem', 'crash', 'fail'],
      fr: ['bug', 'bogue', 'erreur', 'problème', 'plantage', 'échec', 'corriger'],
      es: ['bug', 'error', 'problema', 'fallo', 'corregir', 'arreglar'],
      ar: ['خطأ', 'مشكلة', 'عطل', 'إصلاح', 'خلل'],
      de: ['fehler', 'bug', 'problem', 'absturz', 'beheben'],
      zh: ['错误', '问题', '修复', '崩溃', 'bug']
    },
    testing: {
      en: ['test', 'spec', 'unit', 'integration', 'coverage', 'assert'],
      fr: ['test', 'spec', 'unitaire', 'intégration', 'couverture'],
      es: ['test', 'prueba', 'unitario', 'integración', 'cobertura'],
      ar: ['اختبار', 'فحص', 'تجربة'],
      de: ['test', 'prüfung', 'einheit', 'integration'],
      zh: ['测试', '单元', '集成', '覆盖']
    },
    refactor: {
      en: ['refactor', 'clean', 'restructure', 'reorganize', 'simplify'],
      fr: ['refactorer', 'nettoyer', 'restructurer', 'réorganiser', 'simplifier'],
      es: ['refactor', 'limpiar', 'reestructurar', 'reorganizar', 'simplificar'],
      ar: ['إعادة هيكلة', 'تنظيف', 'تبسيط'],
      de: ['refaktor', 'aufräumen', 'umstrukturieren', 'vereinfachen'],
      zh: ['重构', '清理', '简化', '整理']
    },
    feature: {
      en: ['feature', 'add', 'implement', 'new', 'create', 'build'],
      fr: ['fonctionnalité', 'ajouter', 'implémenter', 'nouveau', 'créer', 'construire'],
      es: ['función', 'añadir', 'implementar', 'nuevo', 'crear', 'construir'],
      ar: ['ميزة', 'إضافة', 'تنفيذ', 'جديد', 'إنشاء'],
      de: ['funktion', 'hinzufügen', 'implementieren', 'neu', 'erstellen'],
      zh: ['功能', '添加', '实现', '新建', '创建']
    },
    config: {
      en: ['config', 'setup', 'install', 'environment', 'deploy', 'settings'],
      fr: ['config', 'installation', 'environnement', 'déployer', 'paramètres'],
      es: ['config', 'configurar', 'instalar', 'entorno', 'desplegar', 'ajustes'],
      ar: ['إعداد', 'تثبيت', 'بيئة', 'نشر', 'إعدادات'],
      de: ['konfiguration', 'einrichten', 'installieren', 'umgebung', 'einstellungen'],
      zh: ['配置', '安装', '环境', '部署', '设置']
    },
    documentation: {
      en: ['doc', 'readme', 'comment', 'guide', 'tutorial', 'manual'],
      fr: ['doc', 'readme', 'commentaire', 'guide', 'tutoriel', 'manuel'],
      es: ['doc', 'readme', 'comentario', 'guía', 'tutorial', 'manual'],
      ar: ['توثيق', 'دليل', 'تعليق', 'شرح'],
      de: ['doku', 'readme', 'kommentar', 'anleitung', 'handbuch'],
      zh: ['文档', '说明', '注释', '指南', '教程']
    }
  },
  
  // Multilingual action keywords
  actionKeywords: {
    todo: {
      en: ['TODO', 'FIXME', 'HACK', 'XXX', 'NOTE'],
      fr: ['TODO', 'ÀFAIRE', 'FIXME', 'CORRECTION', 'NOTE'],
      es: ['TODO', 'HACER', 'FIXME', 'ARREGLAR', 'NOTA'],
      ar: ['للتنفيذ', 'إصلاح', 'ملاحظة'],
      de: ['TODO', 'FIXME', 'ERLEDIGEN', 'NOTIZ'],
      zh: ['待办', '修复', '注意']
    }
  },
  
  // Detect primary language from text sample
  detectLanguage(text) {
    if (!text || text.length < 10) return 'en';
    
    const sample = text.substring(0, 500);
    
    // Check for non-Latin scripts first
    for (const [lang, pattern] of Object.entries(this.languagePatterns)) {
      if (pattern.test(sample)) {
        return lang;
      }
    }
    
    // For Latin scripts, use common word detection
    const lower = sample.toLowerCase();
    
    // Latin languages — score ALL, pick highest (avoid overlap between fr/es/de)
    const scores = {
      fr: (sample.match(/\b(les|des|est|sont|avec|dans|pour|cette|nous|vous|mais|aussi|une|faire|comme|très)\b/g) || []).length,
      es: (sample.match(/\b(los|las|una|son|pero|como|más|tiene|puede|hay|esta|esto|también|porque|desde|cuando)\b/g) || []).length,
      de: (sample.match(/\b(der|die|das|ein|eine|ist|sind|haben|nicht|auch|wenn|oder|aber|wird|kann|nach|über|sehr)\b/g) || []).length
    };
    
    const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
    if (best[1] >= 3) return best[0];
    
    // Default to English
    return 'en';
  },
  
  // Check if language is RTL
  isRTL(lang) {
    return this.rtlLanguages.includes(lang);
  },
  
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

  detectTopic(content, lang = null) {
    const lower = content.toLowerCase();
    const detectedLang = lang || this.detectLanguage(content);
    
    // Check each topic against all language variants
    for (const [topic, langKeywords] of Object.entries(this.topicKeywords)) {
      // Check detected language first, then fall back to English
      const langsToCheck = detectedLang !== 'en' ? [detectedLang, 'en'] : ['en'];
      
      for (const checkLang of langsToCheck) {
        const keywords = langKeywords[checkLang] || langKeywords['en'] || [];
        for (const keyword of keywords) {
          if (lower.includes(keyword.toLowerCase())) {
            return topic;
          }
        }
      }
    }
    
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

        if (severities.length > 0 || files.length > 0 || actions.length > 0 || (msg.content.length > 500 && !msg.content.includes("```"))) {
          const id = `SA${String(anchorIndex).padStart(3, '0')}`;
          semanticAnchors[id] = {
            topic,
            role: msg.role,
            content: msg.content,
            severity: severities.length > 0 ? severities[0].level : null,
            files: files,
            tags: severities.map(s => s.tag)
          };
          anchorIndex++;
        }
      });

      const actionVectors = {};
      let actionIndex = 1;
      const allActions = this.extractActions(allText);

      allActions.slice(0, 20).forEach(action => {
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
        key_themes: topics,
        files_touched: allFiles,
        git_refs: allGitRefs,
        severities_found: [...new Set(allSeverities.map(s => s.level))]
      };

      // Detect primary language of conversation
      const detectedLanguage = this.detectLanguage(allText);
      const isRTL = this.isRTL(detectedLanguage);
      
      return {
        ...rawExtraction,
        session_metadata: {
          platform: rawExtraction.platform,
          sessionId: rawExtraction.conversationId,
          extractedAt: rawExtraction.extractedAt,
          messageCount: rawExtraction.messageCount,
          enriched: true,
          language: detectedLanguage,
          rtl: isRTL
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
