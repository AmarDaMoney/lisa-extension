// Perplexity API Fetch — MAIN world script
// Runs as page context so fetch() carries session cookies
// Communicates with ISOLATED content script via postMessage bridge
(function() {
  'use strict';

  // Thread URLs are /search/<slug> (title words + an id, e.g. how-to-plan-a-launch-Xy7.Q2_ab);
  // /rest/thread/ takes that slug whole. The old pattern ([a-f0-9-]+) dated from UUID URLs: on a
  // slug it found nothing or a few letters, every API call failed, and capture fell back to the
  // page (1 message; ACM, ☆ and Handoff had no messages either).
  function getThreadId() {
    const match = window.location.pathname.match(/\/search\/([^/?#]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  }

  function extractAnswerText(entry) {
    if (!entry.blocks) return '';
    const parts = [];
    for (const block of entry.blocks) {
      // Current format: ask_text with markdown_block.answer (one string, 2026-09) or
      // markdown_block.chunks[] (earlier)
      if (String(block.intended_usage || '').startsWith('ask_text') && block.markdown_block) {
        const mb = block.markdown_block;
        const text = typeof mb.answer === 'string' && mb.answer.trim() ? mb.answer
          : (mb.chunks || []).filter(c => typeof c === 'string').join('');
        if (text.trim() && !parts.includes(text.trim())) parts.push(text.trim());
      }
      // Legacy format: workflow_root with WORKFLOW_ITEM_TEXT
      if (block.intended_usage === 'workflow_root' && block.workflow_block) {
        for (const step of (block.workflow_block.steps || [])) {
          for (const item of (step.items || [])) {
            if (item.type === 'WORKFLOW_ITEM_TEXT' && item.payload?.text_payload?.text) {
              parts.push(item.payload.text_payload.text);
            }
          }
        }
      }
    }
    return parts.join('\n\n');
  }

  async function fetchFullThread(threadUuid) {
    const allEntries = [];
    let offset = 0;
    const limit = 50;
    let hasMore = true;
    while (hasMore) {
      // Same origin as the page (perplexity.ai or www.perplexity.ai), so the session cookies go along
      const url = window.location.origin + '/rest/thread/' + encodeURIComponent(threadUuid) +
        '?with_schematized_response=true&version=2.18&source=default' +
        '&limit=' + limit + '&offset=' + offset + '&from_first=true';
      try {
        const resp = await fetch(url, {
          credentials: 'include',
          headers: { 'accept': '*/*', 'x-app-apiclient': 'web', 'x-app-apiversion': '2.18' }
        });
        if (!resp.ok) {
          console.debug('[LISA-MAIN] Perplexity API: ' + resp.status + ' at offset ' + offset);
          break;
        }
        const data = await resp.json();
        if (data.entries) allEntries.push(...data.entries);
        hasMore = data.has_next_page === true;
        offset += limit;
        if (offset > limit * 10) break;
      } catch (e) {
        console.debug('[LISA-MAIN] Perplexity API fetch error:', e);
        break;
      }
    }
    return allEntries;
  }

  // Handle fetch requests from ISOLATED world bridge
  window.addEventListener('message', async function(event) {
    if (event.source !== window) return;
    if (!event.data || event.data.type !== '__lisa_perplexity_api_request') return;

    const threadUuid = getThreadId();
    if (!threadUuid) {
      window.postMessage({ type: '__lisa_perplexity_api_response', success: false, error: 'No thread UUID found' }, window.location.origin);
      return;
    }

    try {
      const entries = await fetchFullThread(threadUuid);
      if (!entries || entries.length === 0) {
        window.postMessage({ type: '__lisa_perplexity_api_response', success: false, error: 'No entries returned' }, window.location.origin);
        return;
      }

      const messages = [];
      const title = entries[0]?.thread_title || document.title;
      let noAnswer = 0;

      for (const entry of entries) {
        const query = entry.query_str || '';
        const answer = extractAnswerText(entry);
        if (!answer) noAnswer++;
        if (query) messages.push({ role: 'user', content: query.trim() });
        if (answer) messages.push({ role: 'assistant', content: answer.trim() });
      }
      console.debug('[LISA-MAIN] Perplexity API: ' + entries.length + ' entries, ' + messages.length + ' messages' +
        (noAnswer ? ', ' + noAnswer + ' without answer text (block types: ' +
          [...new Set(entries.flatMap(e => (e.blocks || []).map(b => b.intended_usage)))].join(', ') + ')' : ''));

      window.postMessage({
        type: '__lisa_perplexity_api_response',
        success: true,
        data: {
          platform: 'Perplexity',
          conversationId: threadUuid,
          url: window.location.href,
          title: title,
          extractedAt: new Date().toISOString(),
          messageCount: messages.length,
          messages: messages
        }
      }, window.location.origin);
    } catch (e) {
      window.postMessage({ type: '__lisa_perplexity_api_response', success: false, error: e.message }, window.location.origin);
    }
  });

  // Announce readiness — repeat every 500ms for 5 seconds
  // so the bridge catches it regardless of load order
  window.postMessage({ type: '__lisa_perplexity_api_ready' }, window.location.origin);
  var readyCount = 0;
  var readyInterval = setInterval(function() {
    readyCount++;
    window.postMessage({ type: '__lisa_perplexity_api_ready' }, window.location.origin);
    if (readyCount >= 10) clearInterval(readyInterval);
  }, 500);

  console.debug('[LISA-MAIN] Perplexity API MAIN world script loaded');
})();
