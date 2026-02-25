// LISA Parser Router
// Loaded by the service worker via importScripts().
// Maps a tab URL to the correct content-script parser path.
// Claude Code sessions (claude.ai/code/*) are resolved BEFORE the
// generic Claude entry so they get the structured output parser.

/* global ParserRouter */  // declared below, referenced by service-worker

const ParserRouter = {
  /**
   * Returns the extension-root-relative path of the content script
   * that should be injected for the given URL.
   * @param {string} url
   * @returns {string}
   */
  getScript(url) {
    if (!url) return 'src/content/universal-parser.js';

    // Claude Code must be checked BEFORE the generic claude.ai entry
    if (url.includes('claude.ai/code/'))         return 'src/parsers/claude-code-parser.js';

    if (url.includes('claude.ai'))               return 'src/content/claude-parser.js';
    if (url.includes('chatgpt.com'))             return 'src/content/chatgpt-parser.js';
    if (url.includes('gemini.google.com'))       return 'src/content/gemini-parser.js';
    if (url.includes('grok.com'))                return 'src/content/grok-parser.js';
    if (url.includes('chat.mistral.ai'))         return 'src/content/mistral-parser.js';
    if (url.includes('chat.deepseek.com'))       return 'src/content/deepseek-parser.js';
    if (url.includes('copilot.microsoft.com'))   return 'src/content/copilot-parser.js';
    if (url.includes('perplexity.ai'))           return 'src/content/perplexity-parser.js';

    return 'src/content/universal-parser.js';
  }
};
