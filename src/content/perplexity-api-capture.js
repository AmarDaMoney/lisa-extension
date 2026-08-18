// Perplexity API Capture
// Intercepts /rest/thread/ responses to capture full conversation history
// Mirrors the pattern used in claude-api-capture.js and chatgpt-api-capture.js
if (typeof window.__LISA_PERPLEXITY_API_CAPTURE === 'undefined') {
(function() {
  'use strict';

  const capture = {
    entries: new Map(), // keyed by entry UUID
    threadId: null,
    ready: false
  };

  // Extract thread UUID from current URL
  function getThreadId() {
    const match = window.location.pathname.match(/\/search\/([a-f0-9-]+)/);
    return match ? match[1] : null;
  }

  // Extract answer text from an entry's blocks
  function extractAnswerText(entry) {
    if (!entry.blocks) return '';
    const parts = [];
    for (const block of entry.blocks) {
      // Primary: workflow_root blocks contain the answer
      if (block.intended_usage === 'workflow_root' && block.workflow_block) {
        for (const step of (block.workflow_block.steps || [])) {
          for (const item of (step.items || [])) {
            if (item.type === 'WORKFLOW_ITEM_TEXT' && item.payload?.text_payload?.text) {
              parts.push(item.payload.text_payload.text);
            }
          }
        }
      }
      // Fallback: plan_block last goal (older format)
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

  // Process thread API response
  function processThreadResponse(data) {
    if (!data || !data.entries) return;

    capture.threadId = data.thread_metadata?.title || getThreadId();

    for (const entry of data.entries) {
      if (capture.entries.has(entry.uuid)) continue;

      const userQuery = entry.query_str || '';
      const assistantAnswer = extractAnswerText(entry);

      if (!userQuery && !assistantAnswer) continue;

      capture.entries.set(entry.uuid, {
        uuid: entry.uuid,
        query: userQuery,
        answer: assistantAnswer,
        model: entry.display_model || 'unknown',
        timestamp: entry.entry_created_datetime || new Date().toISOString(),
        status: entry.status
      });
    }

    capture.ready = capture.entries.size > 0;
    console.debug(`[LISA] Perplexity API: captured ${capture.entries.size} entries`);
  }

  // Intercept fetch to capture /rest/thread/ responses
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const response = await originalFetch.apply(this, args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
      if (url.includes('/rest/thread/') && !url.includes('/rest/thread/create')) {
        const clone = response.clone();
        const data = await clone.json();
        processThreadResponse(data);
      }
    } catch (e) {
      // Silent — don't break the page
    }
    return response;
  };

  // Fetch all pages of a thread via API
  async function fetchFullThread(threadUuid) {
    const allEntries = [];
    let offset = 0;
    const limit = 50; // Max per page
    let hasMore = true;

    while (hasMore) {
      const url = `https://www.perplexity.ai/rest/thread/${threadUuid}?` +
        `with_schematized_response=true&version=2.18&source=default` +
        `&limit=${limit}&offset=${offset}&from_first=true`;

      try {
        const resp = await originalFetch(url, {
          credentials: 'include',
          headers: {
            'accept': '*/*',
            'x-app-apiclient': 'web',
            'x-app-apiversion': '2.18'
          }
        });

        if (!resp.ok) {
          console.error(`[LISA] Perplexity API: ${resp.status} at offset ${offset}`);
          break;
        }

        const data = await resp.json();
        if (data.entries) {
          allEntries.push(...data.entries);
        }
        hasMore = data.has_next_page === true;
        offset += limit;

        // Safety: max 10 pages
        if (offset > limit * 10) break;
      } catch (e) {
        console.error('[LISA] Perplexity API fetch error:', e);
        break;
      }
    }

    return allEntries;
  }

  // Public API for extraction
  capture.extractViaAPI = async function() {
    const threadUuid = getThreadId();
    if (!threadUuid) return null;

    // Fetch full thread from API
    const entries = await fetchFullThread(threadUuid);
    if (!entries || entries.length === 0) return null;

    const messages = [];
    const title = entries[0]?.thread_title || document.title;

    for (const entry of entries) {
      const query = entry.query_str || '';
      const answer = extractAnswerText(entry);

      if (query) {
        messages.push({
          role: 'user',
          content: query.trim()
        });
      }
      if (answer) {
        messages.push({
          role: 'assistant',
          content: answer.trim()
        });
      }
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
  };

  window.__LISA_PERPLEXITY_API_CAPTURE = capture;
  console.debug('[LISA] Perplexity API capture initialized');
})();
}
