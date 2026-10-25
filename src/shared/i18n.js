// LISA interface languages. The interface is written in English; each language
// file (src/shared/i18n/<code>.js) adds LISA_I18N[<code>] = { strings, patterns }:
// `strings` maps an English text (whitespace collapsed) to its translation,
// `patterns` are [RegExp, replacement] pairs for texts with numbers or names in them.
//
// Nothing is translated in place in the code: the popup page and the floating
// button's own elements are translated as they appear (a MutationObserver), so
// adding a language never touches popup.js or the floating button. The choice is
// the `uiLanguage` setting (chrome.storage.sync): 'auto' (the browser's language
// when LISA has it, else English), 'en', or a language code.
//
// Loaded by popup.html and, before lisa-floating-button.js, by every content
// script entry that has the floating button.

var LISA_I18N = typeof LISA_I18N !== 'undefined' ? LISA_I18N : {};
var LISA_UI_LANGUAGES = { en: 'English', fr: 'Français' };

var lisaI18nLang = 'en';

function lisaResolveLang(setting) {
  const pick = (code) => (code && (code === 'en' || LISA_I18N[code]) ? code : null);
  if (setting && setting !== 'auto') return pick(setting) || 'en';
  const nav = String((typeof navigator !== 'undefined' && navigator.language) || 'en').toLowerCase().split('-')[0];
  return pick(nav) || 'en';
}

// A text in the current language; unknown texts stay as they are.
function lisaT(text) {
  if (lisaI18nLang === 'en' || typeof text !== 'string') return text;
  const table = LISA_I18N[lisaI18nLang];
  if (!table) return text;
  const m = text.match(/^(\s*)([\s\S]*?)(\s*)$/);
  const core = m[2].replace(/\s+/g, ' ');
  if (!core) return text;
  const hit = table.strings && table.strings[core];
  if (hit !== undefined) return m[1] + hit + m[3];
  for (const [re, rep] of table.patterns || []) {
    if (re.test(core)) return m[1] + core.replace(re, rep) + m[3];
  }
  return text;
}

const LISA_I18N_ATTRS = ['title', 'placeholder', 'aria-label'];

function lisaTranslateNode(node) {
  if (lisaI18nLang === 'en' || !node) return;
  if (node.nodeType === 3) {
    const parent = node.parentElement;
    if (parent && parent.closest && parent.closest('[data-lisa-no-translate]')) return;
    const t = lisaT(node.nodeValue);
    if (t !== node.nodeValue) node.nodeValue = t;
    return;
  }
  if (node.nodeType !== 1) return;
  const tag = node.tagName;
  if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEXTAREA' || node.isContentEditable) return;
  // Inputs keep what the user typed; only their hints are translated.
  for (const a of LISA_I18N_ATTRS) {
    const v = node.getAttribute && node.getAttribute(a);
    if (v) {
      const t = lisaT(v);
      if (t !== v) node.setAttribute(a, t);
    }
  }
  if (node.dataset && node.dataset.lisaNoTranslate !== undefined) return;
  for (const child of node.childNodes) lisaTranslateNode(child);
}

// Translate `root` now and whatever is added or changed in it later.
function lisaWatch(root) {
  lisaTranslateNode(root);
  const obs = new MutationObserver((muts) => {
    for (const mu of muts) {
      if (mu.type === 'characterData') lisaTranslateNode(mu.target);
      else if (mu.type === 'attributes') lisaTranslateNode(mu.target);
      else mu.addedNodes.forEach(lisaTranslateNode);
    }
  });
  obs.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: LISA_I18N_ATTRS });
  return obs;
}

// Content scripts: translate only LISA's own elements (the floating button, its
// menus, panels, toasts and dialogs, all direct children of <body>), never the
// chat page itself.
function lisaWatchOwn(body, isOwn) {
  const seen = new WeakSet();
  const adopt = (el) => {
    if (seen.has(el)) return;
    seen.add(el);
    lisaWatch(el);
  };
  Array.from(body.children).forEach(el => { if (isOwn(el)) adopt(el); });
  new MutationObserver((muts) => {
    for (const mu of muts) mu.addedNodes.forEach(n => { if (n.nodeType === 1 && isOwn(n)) adopt(n); });
  }).observe(body, { childList: true });
}

// Reads the setting; resolves to the language in use.
function lisaI18nInit() {
  return new Promise((resolve) => {
    try {
      chrome.storage.sync.get(['uiLanguage'], (r) => {
        lisaI18nLang = lisaResolveLang(r && r.uiLanguage);
        resolve(lisaI18nLang);
      });
    } catch (_) {
      lisaI18nLang = lisaResolveLang('auto');
      resolve(lisaI18nLang);
    }
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { LISA_I18N, LISA_UI_LANGUAGES, lisaResolveLang, lisaT, setLang: (l) => { lisaI18nLang = l; } };
}
