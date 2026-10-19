// Inference Shield bridge: runs only on https://shield.sat-chain.com/app.
// When LISA opened this tab ("Check with Inference Shield"), collect the text
// and the user's LISA sign-in from the service worker (one time, by tab id)
// and hand them to the Shield page, same origin only. The page shows the text
// and waits for the user to press Run; nothing is sent anywhere from here.
(() => {
  const origin = window.location.origin;

  function whenPageReady(callback, tries = 0) {
    if (document.documentElement.dataset.lisaShieldReady === '1') callback();
    else if (tries < 100) setTimeout(() => whenPageReady(callback, tries + 1), 100);
  }

  try {
    chrome.runtime.sendMessage({ action: 'shieldHandoffTake' }, (response) => {
      if (chrome.runtime.lastError || !response || !response.payload) return;
      whenPageReady(() => {
        window.postMessage({ type: 'lisa-shield-handoff', ...response.payload }, origin);
      });
    });
  } catch (_) {
    // Extension reloaded or unavailable: the page works normally without it.
  }
})();
