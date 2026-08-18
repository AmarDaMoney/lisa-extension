// Perplexity API Capture — Content Script Bridge
// Communicates with perplexity-api-main.js (MAIN world) via postMessage
(function() {
  'use strict';

  window.__LISA_PERPLEXITY_API_CAPTURE = {
    extractViaAPI: function() {
      return new Promise(function(resolve, reject) {
        const timeout = setTimeout(function() {
          window.removeEventListener('message', handler);
          reject(new Error('Perplexity API timeout'));
        }, 15000);

        function handler(event) {
          if (event.data?.type !== '__lisa_perplexity_result') return;
          clearTimeout(timeout);
          window.removeEventListener('message', handler);
          if (event.data.success) {
            resolve(event.data.data);
          } else {
            reject(new Error(event.data.error));
          }
        }

        window.addEventListener('message', handler);
        window.postMessage({ type: '__lisa_perplexity_extract' }, '*');
      });
    }
  };

  console.debug('[LISA] Perplexity API bridge ready');
})();
