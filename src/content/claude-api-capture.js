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
 * VERSION: 0.52.9
 * AUTHOR: SAT-CHAIN LLC / LISA
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
        if (typeof block.text === 'string') textParts.push(block.text);
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
      } else if (typeof block.text === 'string') {
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

    // Conversations already known to live behind the RPC API skip REST.
    if (rpcCache[convoId]) return extractViaRPC(convoId);

    // Two parallel API calls — same as Claude Exporter's proven approach
    var results;
    try {
      results = await Promise.all([
        claudeApiFetch(
          '/api/organizations/' + orgId + '/chat_conversations/' + convoId +
          '?tree=True&rendering_mode=messages&render_all_tools=true'
        ),
        claudeApiFetch(
          '/api/organizations/' + orgId + '/chat_conversations/' + convoId + '/latest'
        )
      ]);
    } catch (err) {
      // Claude in Chrome conversations aren't served by the REST API.
      if (!/returned 404/.test(err && err.message)) throw err;
      console.log('[LISA] Claude REST 404 — trying RPC capture');
      return extractViaRPC(convoId);
    }

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
    var leafSource = treeData.current_leaf_message_uuid ? 'tree'
      : (latestData && latestData.snapshot && latestData.snapshot.current_leaf_message_uuid) ? 'latest'
      : 'guessed';
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
      // Diagnostics only — doesn't change messages/messageCount for existing callers.
      _totalTreeMessages: chatMessages.length,
      _leafSource: leafSource,
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
  // RPC CAPTURE — conversations the REST API doesn't serve
  // ========================================================================
  //
  // Conversations made with Claude in Chrome (id is a v8 UUID) 404 on
  // /chat_conversations/<id>. claude.ai loads them over Connect RPC with
  // protobuf bodies (found live via DevTools):
  //   ConversationService/StreamTimeline — server stream; its first data
  //     frame holds the newest ~40 messages and a signed cursor (csh1.…)
  //   ConversationService/ReadConversationHistory {1:id, 2:cursor, 3:opts}
  //     — one older page per call, each carrying the next cursor, until
  //     the first message (no cursor left).
  // Timeline fields: 3 = message {1 uuid, 2 conversation id, 3 role
  // (1 human, 2 assistant), 4 position, 9 time {1 s, 2 ns}, 11 parent},
  // 4 = group {1 id, 2 message uuid}, 5 = block {1 id, 2 group id,
  // 9 text, 10 {1 kind: 2 = text}, 15 tool name, 5 label}; the
  // conversation record {2 name} sits beside them in field 2.

  var RPC_BASE = '/claudeai-rpc/anthropic.bard.api.v1alpha.ConversationService/';
  var rpcCache = {}; // convoId -> { msgs, groups, blocks, title, model }

  var pbText = new TextDecoder();
  var pbEnc = new TextEncoder();

  function pbVarint(b, p) {
    var x = 0, s = 1, c;
    do {
      if (p.i >= b.length) throw new Error('pb: truncated');
      c = b[p.i++];
      x += (c & 127) * s;
      s *= 128;
    } while (c & 128);
    return x;
  }

  // Wire-level decode: [[field, value]] — value is a number (varint) or the
  // raw bytes (length-delimited / fixed). Throws on anything malformed.
  function pbFields(b) {
    var p = { i: 0 }, out = [];
    while (p.i < b.length) {
      var tag = pbVarint(b, p), f = Math.floor(tag / 8), w = tag & 7;
      if (f < 1) throw new Error('pb: bad field');
      if (w === 0) out.push([f, pbVarint(b, p)]);
      else if (w === 1) { out.push([f, b.subarray(p.i, p.i + 8)]); p.i += 8; }
      else if (w === 5) { out.push([f, b.subarray(p.i, p.i + 4)]); p.i += 4; }
      else if (w === 2) {
        var len = pbVarint(b, p);
        if (p.i + len > b.length) throw new Error('pb: bad length');
        out.push([f, b.subarray(p.i, p.i + len)]);
        p.i += len;
      } else throw new Error('pb: bad wire type');
      if (p.i > b.length) throw new Error('pb: overrun');
    }
    return out;
  }
  function pbOne(fs, f) {
    for (var i = 0; i < fs.length; i++) if (fs[i][0] === f) return fs[i][1];
    return undefined;
  }
  function pbAll(fs, f) {
    return fs.filter(function(e) { return e[0] === f; }).map(function(e) { return e[1]; });
  }
  function pbStr(v) { return v instanceof Uint8Array ? pbText.decode(v) : (v == null ? '' : String(v)); }
  function pbSub(v) { try { return v instanceof Uint8Array ? pbFields(v) : []; } catch (e) { return []; } }

  function pbEncVarint(n) {
    var o = [];
    while (n > 127) { o.push((n & 127) | 128); n = Math.floor(n / 128); }
    o.push(n);
    return o;
  }
  function pbBytes(f, data) {
    var b = typeof data === 'string' ? Array.from(pbEnc.encode(data)) : data;
    return pbEncVarint(f * 8 + 2).concat(pbEncVarint(b.length), b);
  }
  function pbNum(f, n) { return pbEncVarint(f * 8).concat(pbEncVarint(n)); }

  // The level whose field-3 entries are this conversation's messages —
  // StreamTimeline nests it one level deeper than ReadConversationHistory.
  function rpcTimeline(bytes, convoId) {
    var fs;
    try { fs = pbFields(bytes); } catch (e) { return null; }
    for (var depth = 0; depth < 5; depth++) {
      var first = pbAll(fs, 3)[0];
      if (first && pbStr(pbOne(pbSub(first), 2)) === convoId) return fs;
      var inner = pbOne(fs, 1);
      if (!(inner instanceof Uint8Array)) return null;
      try { fs = pbFields(inner); } catch (e) { return null; }
    }
    return null;
  }

  var CURSOR_RE = /csh1\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+/g;

  function rpcIngest(cache, tl, convoId) {
    var added = 0;
    pbAll(tl, 3).forEach(function(m) {
      var f = pbSub(m);
      if (pbStr(pbOne(f, 2)) !== convoId) return;
      var uuid = pbStr(pbOne(f, 1));
      if (!uuid) return;
      if (!cache.msgs.has(uuid)) added++;
      cache.msgs.set(uuid, f);
    });
    pbAll(tl, 4).forEach(function(g) {
      var f = pbSub(g), gid = pbStr(pbOne(f, 1));
      if (gid) cache.groups.set(gid, f);
    });
    pbAll(tl, 5).forEach(function(k) {
      var f = pbSub(k), bid = pbStr(pbOne(f, 1));
      if (bid) cache.blocks.set(bid, f);
    });
    var meta = pbSub(pbOne(tl, 2));
    var name = pbStr(pbOne(meta, 2));
    if (name) cache.title = name;
    var model = pbStr(pbOne(pbSub(pbOne(meta, 6)), 2));
    if (model) cache.model = model;
    return added;
  }

  function concatBytes(a, b) {
    var out = new Uint8Array(a.length + b.length);
    out.set(a); out.set(b, a.length);
    return out;
  }

  async function gunzip(bytes) {
    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  // Newest page: the first data frame of StreamTimeline that carries
  // messages. The stream stays open for live updates, so abort after it.
  async function rpcFirstPage(convoId) {
    var tz = 'UTC';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { /* default */ }
    var msg = pbBytes(1, convoId)
      .concat(pbNum(3, 1), pbBytes(4, pbNum(6, 1).concat(pbNum(22, 1))),
              pbBytes(5, navigator.language || 'en-US'), pbNum(6, 1), pbBytes(8, tz));
    var len = msg.length;
    var body = new Uint8Array([0, (len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255].concat(msg));
    var ac = new AbortController();
    var timer = setTimeout(function() { ac.abort(); }, 15000);
    try {
      var resp = await fetch(RPC_BASE + 'StreamTimeline', {
        method: 'POST',
        credentials: 'include',
        signal: ac.signal,
        headers: {
          'content-type': 'application/connect+proto',
          'connect-protocol-version': '1',
          'connect-accept-encoding': 'gzip'
        },
        body: body
      });
      if (!resp.ok) throw new Error('StreamTimeline returned ' + resp.status);
      var reader = resp.body.getReader();
      var buf = new Uint8Array(0);
      while (true) {
        var chunk = await reader.read();
        if (chunk.done) return null;
        buf = concatBytes(buf, chunk.value);
        // Connect envelope: 1 flag byte (1 = gzip, 2 = end of stream) + 4-byte length.
        while (buf.length >= 5) {
          var size = ((buf[1] << 24) >>> 0) + (buf[2] << 16) + (buf[3] << 8) + buf[4];
          if (buf.length < 5 + size) break;
          var flag = buf[0];
          var data = buf.slice(5, 5 + size);
          buf = buf.slice(5 + size);
          if (flag & 2) return null;
          if (flag & 1) data = await gunzip(data);
          var tl = rpcTimeline(data, convoId);
          if (tl) return { tl: tl, bytes: data };
        }
      }
    } finally {
      clearTimeout(timer);
      ac.abort();
    }
  }

  async function rpcHistoryPage(convoId, cursor) {
    var body = new Uint8Array(pbBytes(1, convoId).concat(
      pbBytes(2, cursor), pbBytes(3, pbNum(6, 1).concat(pbNum(22, 1)))));
    var resp = await fetch(RPC_BASE + 'ReadConversationHistory', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/proto', 'connect-protocol-version': '1' },
      body: body
    });
    if (!resp.ok) throw new Error('ReadConversationHistory returned ' + resp.status);
    var bytes = new Uint8Array(await resp.arrayBuffer());
    return { tl: rpcTimeline(bytes, convoId), bytes: bytes };
  }

  // message uuid -> [blocks], groups and blocks kept in arrival order
  function rpcBlocksByMessage(cache) {
    var byGroup = new Map(), byMsg = new Map();
    cache.blocks.forEach(function(b) {
      var gid = pbStr(pbOne(b, 2));
      if (!byGroup.has(gid)) byGroup.set(gid, []);
      byGroup.get(gid).push(b);
    });
    cache.groups.forEach(function(g, gid) {
      var uuid = pbStr(pbOne(g, 2));
      if (!byMsg.has(uuid)) byMsg.set(uuid, []);
      Array.prototype.push.apply(byMsg.get(uuid), byGroup.get(gid) || []);
    });
    return byMsg;
  }

  function rpcMessageText(blocks) {
    var texts = [], artifacts = [];
    (blocks || []).forEach(function(b) {
        var kind = pbOne(pbSub(pbOne(b, 10)), 1);
        var tool = pbStr(pbOne(b, 15));
        if (kind === 2 && !tool) {
          var t = pbStr(pbOne(b, 9));
          if (t) texts.push(t);
        } else if (tool || pbOne(b, 5) !== undefined) {
          artifacts.push({ type: 'tool_use', name: tool || pbStr(pbOne(b, 5)), id: pbStr(pbOne(b, 41)) || null, input: {} });
        }
    });
    return { text: texts.join('\n\n'), artifacts: artifacts };
  }

  function rpcTime(v) {
    var t = pbSub(v), sec = pbOne(t, 1);
    return typeof sec === 'number' ? new Date(sec * 1000).toISOString() : '';
  }

  async function extractViaRPC(convoId) {
    var cache = rpcCache[convoId] || {
      msgs: new Map(), groups: new Map(), blocks: new Map(), title: '', model: ''
    };
    var seen = new Set();
    function nextCursor(bytes) {
      var found = pbText.decode(bytes).match(CURSOR_RE) || [];
      for (var i = 0; i < found.length; i++) {
        if (!seen.has(found[i])) { seen.add(found[i]); return found[i]; }
      }
      return null;
    }

    var first = await rpcFirstPage(convoId);
    if (!first) throw new Error('StreamTimeline sent no messages');
    rpcIngest(cache, first.tl, convoId);
    var cursor = nextCursor(first.bytes);
    var pages = 1;

    // Page back until the start — or, on a repeat call, until a page brings
    // nothing new (the rest is already cached).
    while (cursor && pages < 200) {
      var page = await rpcHistoryPage(convoId, cursor);
      pages++;
      if (!page.tl) break;
      var added = rpcIngest(cache, page.tl, convoId);
      cursor = nextCursor(page.bytes);
      if (!added) break;
    }

    // Active branch: from the newest message back through parents. If a
    // parent is missing (not loaded), fall back to position order.
    var all = Array.from(cache.msgs.entries()).sort(function(a, b) {
      return (pbOne(a[1], 4) || 0) - (pbOne(b[1], 4) || 0);
    });
    if (!all.length) return null;
    var chain = [], cur = all[all.length - 1], visited = new Set(), broken = false;
    while (cur && !visited.has(cur[0])) {
      visited.add(cur[0]);
      chain.unshift(cur);
      var parent = pbStr(pbOne(cur[1], 11));
      if (!parent) break;
      var next = cache.msgs.get(parent);
      if (!next) { broken = true; break; }
      cur = [parent, next];
    }
    var ordered = broken ? all : chain;

    var blocksByMsg = rpcBlocksByMessage(cache);
    var messages = [];
    ordered.forEach(function(entry) {
      var f = entry[1];
      var content = rpcMessageText(blocksByMsg.get(entry[0]));
      var role = pbOne(f, 3) === 1 ? 'user' : 'assistant';
      if (!content.text && !content.artifacts.length) return;
      var m = {
        role: role,
        content: content.text,
        index: messages.length,
        timestamp: rpcTime(pbOne(f, 9)),
        messageId: entry[0],
        attachments: [],
        files: []
      };
      if (content.artifacts.length) m.artifacts = content.artifacts;
      if (role === 'assistant' && cache.model) m.model = cache.model;
      messages.push(m);
    });

    // Cache only once it worked: a cached id skips the REST attempt.
    if (messages.length) rpcCache[convoId] = cache;
    var title = cache.title || document.title || 'Untitled';
    console.log('[LISA] Claude RPC capture: ' + messages.length + ' messages (' + pages +
      ' page' + (pages === 1 ? '' : 's') + (broken ? ', position order' : '') + ')');

    return {
      platform: 'Claude',
      conversationId: convoId,
      url: window.location.href,
      title: title,
      extractedAt: new Date().toISOString(),
      messageCount: messages.length,
      messages: messages,
      _captureMethod: 'api-rpc',
      _totalTreeMessages: cache.msgs.size,
      _leafSource: broken ? 'position' : 'newest'
    };
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
