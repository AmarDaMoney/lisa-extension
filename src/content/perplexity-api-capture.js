// Perplexity API Capture — Direct fetch from content script
// Content scripts share the page origin, so credentials: 'include' carries session cookies
(function() {
  'use strict';

  function getThreadId() {
    const match = window.location.pathname.match(/\/search\/([a-f0-9-]+)/);
    return match ? match[1] : null;
  }

  function extractAnswerText(entry) {
    if (!entry.blocks) return '';
    const parts = [];
    for (const block of entry.blocks) {
      if (block.intended_usage === 'workflow_root' && block.workflow_block) {
        for (const step of (block.workflow_block.steps || [])) {
          for (const item of (step.items || [])) {
            if (item.type === 'WORKFLOW_ITEM_TEXT' && item.payload?.text_payload?.text) {
              parts.push(item.payload.text_payload.text);
            }
          }
        }
      }
      if (block.intended_usage === 'plan' && block.plan_block && parts.length === 0) {
        const goals = block.plan_block.goals || [];
        for (const goal of goals) {
          if (goal.description && goal.description.length > 200) {
            parts.push(goal.description);
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
      const url = 'https://www.perplexity.ai/rest/thread/' + threadUuid +
        '?with_schematized_response=true&version=2.18&source=default' +
        '&limit=' + limit + '&offset=' + offset + '&from_first=true';
      try {
        const resp = await fetch(url, {
          credentials: 'include',
          headers: { 'accept': '*/*', 'x-app-apiclient': 'web', 'x-app-apiversion': '2.18' }
        });
        if (!resp.ok) {
          console.debug('[LISA] Perplexity API: ' + resp.status + ' at offset ' + offset);
          break;
        }
        const data = await resp.json();
        if (data.entries) allEntries.push(...data.entries);
        hasMore = data.has_next_page === true;
        offset += limit;
        if (offset > limit * 10) break;
      } catch (e) {
        console.debug('[LISA] Perplexity API fetch error:', e);
        break;
      }
    }
    return allEntries;
  }

  window.__LISA_PERPLEXITY_API_CAPTURE = {
    extractViaAPI: async function() {
      const threadUuid = getThreadId();
      if (!threadUuid) return null;

      const entries = await fetchFullThread(threadUuid);
      if (!entries || entries.length === 0) return null;

      const messages = [];
      const title = entries[0]?.thread_title || document.title;

      for (const entry of entries) {
        const query = entry.query_str || '';
        const answer = extractAnswerText(entry);
        if (query) messages.push({ role: 'user', content: query.trim() });
        if (answer) messages.push({ role: 'assistant', content: answer.trim() });
      }

      if (messages.length === 0) return null;

      return {
        platform: 'Perplexity',
        conversationId: threadUuid,
        url: window.location.href,
        title: title,
        extractedAt: new Date().toISOString(),
        messageCount: messages.length,
        messages: messages
      };
    }
  };

  console.debug('[LISA] Perplexity API capture ready (content script direct fetch)');
})();
