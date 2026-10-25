// Popup language (see shared/i18n.js): translates the page as it appears and
// changes, the alert/confirm dialogs, and runs the Settings language choice.
(function () {
  const root = document.documentElement;
  root.style.visibility = 'hidden'; // no flash of English before the translation
  const show = () => { root.style.visibility = ''; };
  setTimeout(show, 600);

  const nativeAlert = window.alert.bind(window);
  const nativeConfirm = window.confirm.bind(window);
  window.alert = (msg) => nativeAlert(lisaT(String(msg)));
  window.confirm = (msg) => nativeConfirm(lisaT(String(msg)));

  lisaI18nInit().then((lang) => {
    root.lang = lang;
    root.dir = lisaI18nDir();
    lisaWatch(document.body);
    show();
  });

  // Settings → Interface language
  chrome.storage.sync.get(['uiLanguage'], (r) => {
    const select = document.getElementById('uiLanguageSelect');
    if (!select) return;
    // One option per loaded language file, in its own name (never translated).
    for (const [code, name] of Object.entries(LISA_UI_LANGUAGES)) {
      const opt = document.createElement('option');
      opt.value = code;
      opt.textContent = name;
      opt.dataset.lisaNoTranslate = '';
      select.appendChild(opt);
    }
    select.value = (r && r.uiLanguage) || 'auto';
    select.addEventListener('change', () => {
      chrome.storage.sync.set({ uiLanguage: select.value }, () => location.reload());
    });
  });
})();
