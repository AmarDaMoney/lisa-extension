/**
 * claude-api-capture.js
 * =====================
 * API-first conversation capture for Claude.ai
 * 
 * Instead of scraping the DOM (scroll sweeps, virtualization handling),
 * this module calls Claude's internal REST API directly. The content script
 * runs on claude.ai, so the browser attaches session cookies automatically.
 * The API returns the COMPLETE conversation as structured JSON — every message,
 * every branch, every attachment — instantly.
 *
 * Output: LISA standard parser format (same shape all downstream systems consume)
 *
 * VERSION: 0.52.1
 * AUTHOR: SAT-CHAIN LLC / LISA Core
 */

(function() {
  'use strict';

  // Already loaded guard
  if (window.__LISA_CLAUDE_API_CAPTURE) return;

  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const CONVO_ID_FROM_URL = /\/chat\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

  // ========================================================================
  // ORG ID EXTRACTION
  // ========================================================================

  async function getOrgId() {
    // Strategy 1: Cookie
    try {
      const cookies = document.cookie.split(';');
      for (const cookie of cookies) {
        const trimmed = cookie.trim();
        if (trimmed.startsWith('lastActiveOrg=')) {
          const orgId = trimmed.split('=')[1];
          if (UUID_PATTERN.test(orgId)) return orgId;
        }
      }
    } catch (e) { /* continue */ }

    // Strategy 2: API
    try {
      const resp = await fetch('/api/organizations', {
        method: 'GET',
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      });
      if (!resp.ok) throw new Error('orgs ' + resp.status);
      const orgs = await resp.json();
      if (Array.isArray(orgs) && orgs.length > 0 && orgs[0].uuid) {
        return orgs[0].uuid;
      }
    } catch (e) {
      console.warn('[LISA] getOrgId fallback failed:', e.message);
    }

    return null;
  }

  // ========================================================================
  // CONVERSATION ID EXTRACTION
  // ========================================================================

  function getConvoId(url) {
    const urlStr = url || window.location.href;
    const match = urlStr.match(CONVO_ID_FROM_URL);
    return match ? match[1] : null;
  }

  // ========================================================================
  // API FETCH WRAPPER
  // ========================================================================

  async function claudeApiFetch(path) {
    const resp = await fetch(path, {
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

  function walkBranchToLeaf(chatMessages, leafUuid) {
    if (!chatMessages || !chatMessages.length) return [];

    // Build lookup map: uuid -> message
    const byId = new Map();
    for (const msg of chatMessages) {
      if (msg.uuid) byId.set(msg.uuid, msg);
    }

    // If no leaf specified, find it
    if (!leafUuid) {
      const parentIds = new Set();
      for (const msg of chatMessages) {
        if (msg.parent_message_uuid) parentIds.add(msg.parent_message_uuid);
      }
      const leaves = chatMessages.filter(function(m) { return !parentIds.has(m.uuid); });
      if (leaves.length > 0) {
        leaves.sort(function(a, b) {
          return new Date(b.updated_at || 0) - new Date(a.updated_at || 0);
        });
        leafUuid = leaves[0].uuid;
      } else {
        leafUuid = chatMessages[chatMessages.length - 1].uuid;
      }
    }

    // Walk backward from leaf to root
    const chain = [];
    var current = byId.get(leafUuid);
    const visited = new Set();
    while (current && !visited.has(current.uuid)) {
      visited.add(current.uuid);
      chain.unshift(current);
      if (!current.parent_message_uuid) break;
      current = byId.get(current.parent_message_uuid);
    }

    return chain;
  }

  // ========================================================================
  // CONTENT BLOCK PROCESSOR
  // ========================================================================

  function processContentBlocks(contentArray) {
    if (!contentArray || !Array.isArray(contentArray)) {
      return { text: '', artifacts: [] };
    }

    const textParts = [];
    const artifacts = [];

    for (const block of contentArray) {
      if (!block) continue;

      if (block.type === 'text') {
        if (block.text) textParts.push(block.text);
      } else if (block.type === 'tool_use') {
        artifacts.push({
          type: 'tool_use',
          name: block.name || 'unknown_tool',
          id: block.id || null,
          input: block.input || {}
        });
      } else if (block.type === 'tool_result') {
        artifacts.push({
          type: 'tool_result',
          tool_use_id: block.tool_use_id || null,
          content: block.content || ''
        });
      } else if (block.text) {
        textParts.push(block.text);
      }
    }

    return {
      text: textParts.join('\n'),
      artifacts: artifacts
    };
  }

  // ========================================================================
  // MAIN API CAPTURE — normal /chat/ conversations
  // ========================================================================

  async function extractViaAPI() {
    var convoId = getConvoId();
    if (!convoId) {
      console.warn('[LISA] No conversation ID in URL');
      return null;
    }

    var orgId = await getOrgId();
    if (!orgId) {
      console.warn('[LISA] Could not determine org ID');
      return null;
    }

    // Two parallel API calls — same as Claude Exporter's proven approach
    var results = await Promise.all([
      claudeApiFetch(
        '/api/organizations/' + orgId + '/chat_conversations/' + convoId +
        '?tree=True&rendering_mode=messages&render_all_tools=true'
      ),
      claudeApiFetch(
        '/api/organizations/' + orgId + '/chat_conversations/' + convoId + '/latest'
      )
    ]);

    var treeData = results[0];
    var latestData = results[1];

    // Extract chat_messages from tree or nested snapshot
    var chatMessages = treeData.chat_messages
      || (treeData.snapshot && treeData.snapshot.chat_messages)
      || [];

    if (!chatMessages.length) {
      console.warn('[LISA] API returned no chat_messages');
      return null;
    }

    // Resolve the active branch
    var leafUuid = treeData.current_leaf_message_uuid
      || (latestData && latestData.snapshot && latestData.snapshot.current_leaf_message_uuid)
      || null;

    var branchMessages = walkBranchToLeaf(chatMessages, leafUuid);
    if (!branchMessages.length) {
      console.warn('[LISA] Could not resolve active branch');
      return null;
    }

    // Transform to LISA standard format
    var messages = [];
    for (var i = 0; i < branchMessages.length; i++) {
      var msg = branchMessages[i];
      var processed = processContentBlocks(msg.content);

      // Skip system/empty messages
      if (!msg.sender && !processed.text) continue;

      var role = msg.sender === 'human' ? 'user' : 'assistant';

      var lisaMessage = {
        role: role,
        content: processed.text,
        index: messages.length,
        timestamp: msg.updated_at || msg.created_at || '',
        messageId: msg.uuid || null,
        attachments: msg.attachments || [],
        files: msg.files_v2 || msg.files || [],
      };

      if (processed.artifacts.length > 0) {
        lisaMessage.artifacts = processed.artifacts;
      }
      if (role === 'assistant' && msg.model) {
        lisaMessage.model = msg.model;
      }
      if (msg.sync_sources && msg.sync_sources.length > 0) {
        lisaMessage.syncSources = msg.sync_sources;
      }

      messages.push(lisaMessage);
    }

    // Extract title
    var title = treeData.name
      || (treeData.snapshot && treeData.snapshot.name)
      || (latestData && latestData.snapshot && latestData.snapshot.name)
      || document.title
      || 'Untitled';

    var result = {
      platform: 'Claude',
      conversationId: convoId,
      url: window.location.href,
      title: title,
      extractedAt: new Date().toISOString(),
      messageCount: messages.length,
      messages: messages,
      _captureMethod: 'api',
      _orgId: orgId,
      _branchPath: branchMessages.map(function(m) { return m.uuid; }).filter(Boolean),
      _conversationMeta: {
        created_at: treeData.created_at || null,
        updated_at: treeData.updated_at || null,
        model: treeData.model || null,
        is_starred: treeData.is_starred || false,
        project_uuid: treeData.project_uuid || null
      }
    };

    console.log(
      '[LISA] API capture complete: ' + messages.length + ' messages, ' +
      'branch depth ' + branchMessages.length + ', ' +
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

    var snapshotId = url.pathname.split('/').pop();
    if (!snapshotId || !UUID_PATTERN.test(snapshotId)) return null;

    var data = await claudeApiFetch(
      '/api/chat_snapshots/' + snapshotId +
      '?rendering_mode=messages&render_all_tools=true'
    );

    var chatMessages = data.chat_messages || [];
    if (!chatMessages.length) return null;

    var leafUuid = data.current_leaf_message_uuid || null;
    var branchMessages = walkBranchToLeaf(chatMessages, leafUuid);

    var messages = [];
    for (var i = 0; i < branchMessages.length; i++) {
      var msg = branchMessages[i];
      var processed = processContentBlocks(msg.content);
      if (!msg.sender && !processed.text) continue;

      var lisaMessage = {
        role: msg.sender === 'human' ? 'user' : 'assistant',
        content: processed.text,
        index: messages.length,
        timestamp: msg.updated_at || msg.created_at || '',
        messageId: msg.uuid || null,
        attachments: msg.attachments || [],
        files: msg.files_v2 || msg.files || []
      };

      if (processed.artifacts.length > 0) {
        lisaMessage.artifacts = processed.artifacts;
      }

      messages.push(lisaMessage);
    }

    return {
      platform: 'Claude',
      conversationId: snapshotId,
      url: window.location.href,
      title: data.name || data.snapshot_name || document.title || 'Shared Conversation',
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

  window.__LISA_CLAUDE_API_CAPTURE = {
    extractViaAPI: extractViaAPI,
    extractSharedViaAPI: extractSharedViaAPI,
    getOrgId: getOrgId,
    getConvoId: getConvoId
  };

  console.log('[LISA] Claude API capture module loaded');

})();
