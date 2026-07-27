/**
 * chatgpt-api-capture.js
 * ======================
 * API-first conversation capture for ChatGPT (chatgpt.com)
 *
 * Calls ChatGPT's internal /backend-api/conversation/{id} endpoint
 * directly. Content script runs on chatgpt.com so browser attaches
 * session cookies automatically.
 *
 * VERSION: 0.51.8
 * AUTHOR: SAT-CHAIN LLC / LISA Core
 */

(function() {
  'use strict';

  if (window.__LISA_CHATGPT_API_CAPTURE) return;

  // ChatGPT URL patterns: /c/{id} or /g/{gizmo-id}/{convo-id}
  var CONVO_FROM_URL = /\/(?:c|g\/[^/]+)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

  // ========================================================================
  // CONVERSATION ID EXTRACTION
  // ========================================================================

  function getConvoId(url) {
    var urlStr = url || window.location.href;
    var match = urlStr.match(CONVO_FROM_URL);
    return match ? match[1] : null;
  }

  // ========================================================================
  // API FETCH WRAPPER
  // ========================================================================

  async function chatgptApiFetch(path) {
    var resp = await fetch(path, {
      method: 'GET',
      credentials: 'include',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });
    if (!resp.ok) {
      throw new Error('API ' + path + ' returned ' + resp.status + ': ' + resp.statusText);
    }
    return resp.json();
  }

  // ========================================================================
  // MESSAGE TREE WALKER
  // ========================================================================

  /**
   * ChatGPT uses a mapping object (not array).
   * Each key is a message UUID, value has: { id, message, parent, children[] }
   * Walk backward from current_node to root, collecting the active branch.
   */
  function walkMappingToLeaf(mapping, currentNode) {
    if (!mapping || !currentNode) return [];

    var chain = [];
    var visited = new Set();
    var nodeId = currentNode;

    while (nodeId && mapping[nodeId] && !visited.has(nodeId)) {
      visited.add(nodeId);
      var node = mapping[nodeId];
      // Only include nodes that have actual messages (skip root placeholder)
      if (node.message && node.message.content) {
        chain.unshift(node);
      }
      nodeId = node.parent;
    }

    return chain;
  }

  // ========================================================================
  // CONTENT PARTS PROCESSOR
  // ========================================================================

  /**
   * ChatGPT messages use content.parts[] — array of strings or objects.
   * Text parts are strings. Image/file parts are objects with asset_pointer etc.
   */
  function processContentParts(content) {
    if (!content || !content.parts || !Array.isArray(content.parts)) {
      return '';
    }

    var textParts = [];
    for (var i = 0; i < content.parts.length; i++) {
      var part = content.parts[i];
      if (typeof part === 'string') {
        textParts.push(part);
      } else if (part && typeof part === 'object') {
        // Multimodal content (images, files) — note it but don't lose it
        if (part.content_type === 'image_asset_pointer' || part.asset_pointer) {
          textParts.push('[Image]');
        } else if (part.text) {
          textParts.push(part.text);
        }
      }
    }

    return textParts.join('\n');
  }

  // ========================================================================
  // MAIN API CAPTURE
  // ========================================================================

  async function extractViaAPI() {
    var convoId = getConvoId();
    if (!convoId) {
      console.warn('[LISA] ChatGPT: No conversation ID in URL');
      return null;
    }

    var data = await chatgptApiFetch('/backend-api/conversation/' + convoId);

    var mapping = data.mapping;
    var currentNode = data.current_node;

    if (!mapping || !currentNode) {
      console.warn('[LISA] ChatGPT: API returned no mapping or current_node');
      return null;
    }

    // Walk the tree from root to current leaf
    var branchNodes = walkMappingToLeaf(mapping, currentNode);

    if (!branchNodes.length) {
      console.warn('[LISA] ChatGPT: Could not resolve active branch');
      return null;
    }

    // Transform to LISA standard format
    var messages = [];
    for (var i = 0; i < branchNodes.length; i++) {
      var node = branchNodes[i];
      var msg = node.message;
      if (!msg || !msg.author) continue;

      var authorRole = msg.author.role;
      // Skip system messages
      if (authorRole === 'system' || authorRole === 'tool') continue;

      var role = authorRole === 'user' ? 'user' : 'assistant';
      var text = processContentParts(msg.content);
      if (!text || !text.trim()) continue;

      var timestamp = '';
      if (msg.create_time) {
        timestamp = new Date(msg.create_time * 1000).toISOString();
      }

      var lisaMessage = {
        role: role,
        content: text.trim(),
        index: messages.length,
        timestamp: timestamp,
        messageId: msg.id || null
      };

      // Model info from metadata
      var modelSlug = (msg.metadata && (msg.metadata.model_slug || msg.metadata.resolved_model_slug)) || undefined;
      if (role === 'assistant' && modelSlug) {
        lisaMessage.model = modelSlug;
      }

      messages.push(lisaMessage);
    }

    if (!messages.length) {
      console.warn('[LISA] ChatGPT: No messages extracted from mapping');
      return null;
    }

    var title = data.title || document.title || 'Untitled';

    var result = {
      platform: 'ChatGPT',
      conversationId: convoId,
      url: window.location.href,
      title: title,
      extractedAt: new Date().toISOString(),
      messageCount: messages.length,
      messages: messages,
      _captureMethod: 'api',
      _branchPath: branchNodes.map(function(n) { return n.id; }).filter(Boolean),
      _conversationMeta: {
        created_at: data.create_time ? new Date(data.create_time * 1000).toISOString() : null,
        updated_at: data.update_time ? new Date(data.update_time * 1000).toISOString() : null,
        model: data.default_model_slug || null,
        is_archived: data.is_archived || false,
        gizmo_id: data.gizmo_id || null
      }
    };

    console.log(
      '[LISA] ChatGPT API capture complete: ' + messages.length + ' messages, ' +
      'convo "' + title.substring(0, 40) + '"'
    );

    return result;
  }

  // ========================================================================
  // SHARED CONVERSATION CAPTURE — /share/ URLs
  // ========================================================================

  async function extractSharedViaAPI() {
    var url = new URL(window.location.href);
    if (!url.pathname.startsWith('/share/')) return null;

    var shareId = url.pathname.split('/').pop();
    if (!shareId) return null;

    var data = await chatgptApiFetch('/backend-api/share/' + shareId);

    var mapping = data.mapping || (data.data && data.data.mapping);
    var currentNode = data.current_node || (data.data && data.data.current_node);

    if (!mapping || !currentNode) return null;

    var branchNodes = walkMappingToLeaf(mapping, currentNode);
    var messages = [];

    for (var i = 0; i < branchNodes.length; i++) {
      var node = branchNodes[i];
      var msg = node.message;
      if (!msg || !msg.author) continue;
      if (msg.author.role === 'system' || msg.author.role === 'tool') continue;

      var text = processContentParts(msg.content);
      if (!text || !text.trim()) continue;

      messages.push({
        role: msg.author.role === 'user' ? 'user' : 'assistant',
        content: text.trim(),
        index: messages.length,
        timestamp: msg.create_time ? new Date(msg.create_time * 1000).toISOString() : '',
        messageId: msg.id || null
      });
    }

    return {
      platform: 'ChatGPT',
      conversationId: shareId,
      url: window.location.href,
      title: data.title || (data.data && data.data.title) || document.title || 'Shared Conversation',
      extractedAt: new Date().toISOString(),
      messageCount: messages.length,
      messages: messages,
      _captureMethod: 'api',
      _isShared: true
    };
  }

  // ========================================================================
  // EXPOSE ON WINDOW
  // ========================================================================

  window.__LISA_CHATGPT_API_CAPTURE = {
    extractViaAPI: extractViaAPI,
    extractSharedViaAPI: extractSharedViaAPI,
    getConvoId: getConvoId
  };

  console.log('[LISA] ChatGPT API capture module loaded');

})();
