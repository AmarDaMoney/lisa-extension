// UNIVERSAL Web Parser
// Extracts and compresses semantic content from ANY webpage
// This is LISA's secret weapon - turns it into a universal semantic compression tool

class UniversalParser {
  constructor() {
    this.platform = 'web (universal)';
    this.conversationId = this.generatePageId();
  }

  generatePageId() {
    // Generate unique ID from URL
    return btoa(window.location.href).slice(0, 20);
  }

  extractPageType() {
    // Detect what kind of page this is
    const url = window.location.href;
    const domain = window.location.hostname;
    
    if (domain.includes('reddit.com')) return 'reddit-thread';
    if (domain.includes('stackoverflow.com')) return 'stackoverflow';
    if (domain.includes('github.com')) return 'github-repo';
    if (domain.includes('medium.com') || domain.includes('substack.com')) return 'article';
    if (domain.includes('youtube.com')) return 'youtube';
    if (domain.includes('twitter.com') || domain.includes('x.com')) return 'twitter-thread';
    if (domain.includes('linkedin.com')) return 'linkedin';
    if (domain.includes('news') || domain.includes('blog')) return 'news-article';
    
    return 'generic-webpage';
  }

  extractArticleContent() {
    // Try to find main article content
    const candidates = [
      document.querySelector('article'),
      document.querySelector('main'),
      document.querySelector('[role="main"]'),
      document.querySelector('.article-content'),
      document.querySelector('.post-content'),
      document.querySelector('#content'),
      document.querySelector('.content')
    ];

    for (const candidate of candidates) {
      if (candidate && candidate.textContent.length > 200) {
        return this.cleanContent(candidate);
      }
    }

    // Fallback to body
    return this.cleanContent(document.body);
  }

  cleanContent(element) {
    const clone = element.cloneNode(true);
    
    // Remove noise
    const selectorsToRemove = [
      'script', 'style', 'nav', 'header', 'footer',
      'aside', '[role="navigation"]', '[role="banner"]',
      '.ad', '.advertisement', '.sidebar', '.comments',
      'button', 'svg', '[role="button"]', 'iframe'
    ];

    selectorsToRemove.forEach(selector => {
      clone.querySelectorAll(selector).forEach(el => el.remove());
    });

    return clone.textContent || clone.innerText || '';
  }

  extractStructuredData() {
    // Extract semantic structure
    const structure = {
      headings: [],
      paragraphs: [],
      lists: [],
      codeBlocks: [],
      links: []
    };

    // Headings
    document.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(h => {
      if (h.textContent.trim().length > 0) {
        structure.headings.push({
          level: h.tagName.toLowerCase(),
          text: h.textContent.trim()
        });
      }
    });

    // Key paragraphs (first 10)
    const paragraphs = Array.from(document.querySelectorAll('p'))
      .filter(p => p.textContent.trim().length > 50)
      .slice(0, 10);
    
    structure.paragraphs = paragraphs.map(p => p.textContent.trim());

    // Lists
    document.querySelectorAll('ul, ol').forEach(list => {
      const items = Array.from(list.querySelectorAll('li'))
        .map(li => li.textContent.trim())
        .filter(text => text.length > 0);
      
      if (items.length > 0) {
        structure.lists.push(items);
      }
    });

    // Code blocks
    document.querySelectorAll('pre, code').forEach(code => {
      const text = code.textContent.trim();
      if (text.length > 10 && text.length < 1000) {
        structure.codeBlocks.push(text);
      }
    });

    // Important links
    const links = Array.from(document.querySelectorAll('a[href]'))
      .filter(a => {
        const href = a.getAttribute('href');
        return href && 
               (href.startsWith('http') || href.startsWith('/')) &&
               !href.includes('facebook.com') &&
               !href.includes('twitter.com') &&
               a.textContent.trim().length > 0;
      })
      .slice(0, 20)
      .map(a => ({
        text: a.textContent.trim(),
        url: a.getAttribute('href')
      }));

    structure.links = links;

    return structure;
  }

  extractMetadata() {
    // Extract page metadata
    const meta = {
      title: document.title,
      description: '',
      author: '',
      publishDate: '',
      keywords: []
    };

    // Description
    const descMeta = document.querySelector('meta[name="description"]') ||
                     document.querySelector('meta[property="og:description"]');
    if (descMeta) {
      meta.description = descMeta.getAttribute('content') || '';
    }

    // Author
    const authorMeta = document.querySelector('meta[name="author"]') ||
                       document.querySelector('meta[property="article:author"]');
    if (authorMeta) {
      meta.author = authorMeta.getAttribute('content') || '';
    }

    // Publish date
    const dateMeta = document.querySelector('meta[property="article:published_time"]') ||
                     document.querySelector('meta[name="publish-date"]');
    if (dateMeta) {
      meta.publishDate = dateMeta.getAttribute('content') || '';
    }

    // Keywords
    const keywordsMeta = document.querySelector('meta[name="keywords"]');
    if (keywordsMeta) {
      const keywords = keywordsMeta.getAttribute('content') || '';
      meta.keywords = keywords.split(',').map(k => k.trim());
    }

    return meta;
  }

  extractConversation() {
    const pageType = this.extractPageType();
    const content = this.extractArticleContent();
    const structure = this.extractStructuredData();
    const metadata = this.extractMetadata();

    // Create a "conversation" format for universal content
    // Treat the page as a single "message" with rich semantic structure
    const messages = [{
      role: 'web-content',
      content: content.slice(0, 10000), // Limit to first 10K chars
      index: 0,
      timestamp: new Date().toISOString(),
      structure: structure,
      metadata: metadata,
      pageType: pageType
    }];

    return {
      platform: this.platform,
      conversationId: this.conversationId,
      url: window.location.href,
      title: document.title,
      pageType: pageType,
      extractedAt: new Date().toISOString(),
      messageCount: 1,
      messages: messages,
      structuredData: structure,
      metadata: metadata,
      // Add helpful message for user
      userMessage: this.getUserMessage(pageType)
    };
  }

  getUserMessage(pageType) {
    // Provide context-specific messages
    const messages = {
      'reddit-thread': '✅ Reddit thread captured! Main posts and comments extracted.',
      'stackoverflow': '✅ Stack Overflow Q&A captured! Question and answers extracted.',
      'github-repo': '✅ GitHub content captured! README and description extracted.',
      'article': '✅ Article content captured! Main text and structure extracted.',
      'news-article': '✅ News article captured! Story content extracted.',
      'youtube': '✅ YouTube page captured! Video metadata and description extracted.',
      'twitter-thread': '✅ Twitter thread captured! Tweets extracted.',
      'linkedin': '✅ LinkedIn content captured!',
      'generic-webpage': '✅ Web content captured! Main page content extracted.\n\n💡 For AI conversations, use LISA on Claude.ai, ChatGPT.com, or Gemini.google.com'
    };
    
    return messages[pageType] || messages['generic-webpage'];
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
          console.error('[LISA] Universal extraction error:', error);
          sendResponse({ success: false, error: error.message });
        }
      }
      return true;
    });
  }
}

// Initialize parser
const parser = new UniversalParser();
parser.initializeListener();

chrome.runtime.sendMessage({ 
  action: 'parserReady', 
  platform: 'web (universal)' 
});
