// Perplexity API Capture — ISOLATED world bridge
// Relays fetch requests to MAIN world script via postMessage
// MAIN world carries session cookies; ISOLATED world cannot
(function() {
  'use strict';

  var mainWorldReady = false;

  // Listen for ready signal from MAIN world
  window.addEventListener('message', function(event) {
    if (event.source !== window) return;
    if (event.data && event.data.type === '__lisa_perplexity_api_ready') {
      mainWorldReady = true;
    }
  });

  // Wait for MAIN world ready signal with timeout
  function waitForReady(timeoutMs) {
    if (mainWorldReady) return Promise.resolve(true);
    return new Promise(function(resolve) {
      var elapsed = 0;
      var interval = setInterval(function() {
        elapsed += 100;
        if (mainWorldReady) {
          clearInterval(interval);
          resolve(true);
        } else if (elapsed >= timeoutMs) {
          clearInterval(interval);
          resolve(false);
        }
      }, 100);
    });
  }

  // Send request to MAIN world, wait for response with retry
  function requestFromMain(attempt) {
    return new Promise(function(resolve, reject) {
      var timeout = setTimeout(function() {
        window.removeEventListener('message', handler);
        reject(new Error('MAIN world response timeout (attempt ' + attempt + ')'));
      }, 8000);

      function handler(event) {
        if (event.source !== window) return;
        if (!event.data || event.data.type !== '__lisa_perplexity_api_response') return;
        clearTimeout(timeout);
        window.removeEventListener('message', handler);
        if (event.data.success) {
          resolve(event.data.data);
        } else {
          reject(new Error(event.data.error || 'MAIN world fetch failed'));
        }
      }

      window.addEventListener('message', handler);
      window.postMessage({ type: '__lisa_perplexity_api_request' }, '*');
    });
  }

  window.__LISA_PERPLEXITY_API_CAPTURE = {
    extractViaAPI: async function() {
      // Wait up to 6 seconds for MAIN world to announce readiness
      var ready = await waitForReady(6000);
      if (!ready) {
        console.debug('[LISA] Perplexity bridge: MAIN world not ready after 6s');
        return null;
      }

      // Retry up to 3 times with 500ms gaps
      var lastError = null;
      for (var attempt = 1; attempt <= 3; attempt++) {
        try {
          var result = await requestFromMain(attempt);
          if (result && result.messages && result.messages.length > 0) {
            console.debug('[LISA] Perplexity API capture succeeded: ' + result.messages.length + ' messages (attempt ' + attempt + ')');
            return result;
          }
        } catch (e) {
          lastError = e;
          console.debug('[LISA] Perplexity bridge attempt ' + attempt + ' failed:', e.message);
          if (attempt < 3) {
            await new Promise(function(r) { setTimeout(r, 500); });
          }
        }
      }

      console.debug('[LISA] Perplexity bridge: all attempts failed:', lastError?.message);
      return null;
    }
  };

  console.debug('[LISA] Perplexity API bridge (ISOLATED world) loaded');
})();
