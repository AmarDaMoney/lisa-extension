// Perplexity API Capture — Content Script Bridge
// Communicates with perplexity-api-main.js (MAIN world) via CustomEvents
(function() {
  'use strict';

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

  console.debug('[LISA] Perplexity API bridge ready');
})();
