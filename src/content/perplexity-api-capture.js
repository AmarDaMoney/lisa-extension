// Perplexity API Capture
// Injects into page main world to access session cookies and intercept /rest/thread/
// Results communicated back to content script via CustomEvent
(function() {
  'use strict';

  // Inject the capture logic into the page's main world
  const injectedCode = function() {
    if (window.__LISA_PERPLEXITY_API_CAPTURE) return;

    const originalFetch = window.fetch;

    // Extract thread UUID from URL
    function getThreadId() {
      const match = window.location.pathname.match(/\/search\/([a-f0-9-]+)/);
      return match ? match[1] : null;
    }

    // Extract answer text from an entry's blocks
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

    // Fetch all pages of a thread
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
          const resp = await originalFetch(url, {
            credentials: 'include',
            headers: {
              'accept': '*/*',
              'x-app-apiclient': 'web',
              'x-app-apiversion': '2.18'
            }
          });

          if (!resp.ok) break;

          const data = await resp.json();
          if (data.entries) allEntries.push(...data.entries);
          hasMore = data.has_next_page === true;
          offset += limit;
          if (offset > limit * 10) break;
        } catch (e) {
          break;
        }
      }
      return allEntries;
    }

    // Build conversation from entries
    function entriesToConversation(entries, threadUuid) {
      const messages = [];
      const title = entries[0]?.thread_title || document.title;

      for (const entry of entries) {
        const query = entry.query_str || '';
        const answer = extractAnswerText(entry);

        if (query) {
          messages.push({ role: 'user', content: query.trim() });
        }
        if (answer) {
          messages.push({ role: 'assistant', content: answer.trim() });
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
    }

    // Listen for extraction requests from content script
    window.addEventListener('__lisa_perplexity_extract', async function() {
      const threadUuid = getThreadId();
      if (!threadUuid) {
        window.dispatchEvent(new CustomEvent('__lisa_perplexity_result', {
          detail: JSON.stringify({ success: false, error: 'No thread UUID' })
        }));
        return;
      }

      try {
        const entries = await fetchFullThread(threadUuid);
        const conversation = entriesToConversation(entries, threadUuid);
        window.dispatchEvent(new CustomEvent('__lisa_perplexity_result', {
          detail: JSON.stringify({ success: true, data: conversation })
        }));
      } catch (e) {
        window.dispatchEvent(new CustomEvent('__lisa_perplexity_result', {
          detail: JSON.stringify({ success: false, error: e.message })
        }));
      }
    });

    window.__LISA_PERPLEXITY_API_CAPTURE = true;
    console.debug('[LISA] Perplexity API capture injected into main world');
  };

  // Inject into page main world via script element
  const script = document.createElement('script');
  script.textContent = '(' + injectedCode.toString() + ')();';
  (document.head || document.documentElement).appendChild(script);
  script.remove();

  // Content script side: provide extraction function for parsers
  window.__LISA_PERPLEXITY_API_CAPTURE = {
    extractViaAPI: function() {
      return new Promise(function(resolve, reject) {
        const timeout = setTimeout(function() {
          window.removeEventListener('__lisa_perplexity_result', handler);
          reject(new Error('Perplexity API timeout'));
        }, 15000);

        function handler(event) {
          clearTimeout(timeout);
          window.removeEventListener('__lisa_perplexity_result', handler);
          try {
            const result = JSON.parse(event.detail);
            if (result.success) {
              resolve(result.data);
            } else {
              reject(new Error(result.error));
            }
          } catch (e) {
            reject(e);
          }
        }

        window.addEventListener('__lisa_perplexity_result', handler);
        window.dispatchEvent(new CustomEvent('__lisa_perplexity_extract'));
      });
    }
  };

  console.debug('[LISA] Perplexity API capture content script ready');
})();
