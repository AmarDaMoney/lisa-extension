// Microsoft Copilot Conversation Parser
// Extracts conversation data from copilot.com (formerly copilot.microsoft.com)

// ── Shared Copilot turn finder ──
// Used by CopilotParser below and LisaVParser.extractCopilotMessages() so
// the two can't drift. copilot.com (2026 redesign), confirmed live by DOM
// inspection:
//   user turn:      [data-testid="chatQuestion"] → text in .fai-UserMessage__message
//                   (which wraps a [data-testid="chatOutput"] holding the
//                   USER's text — despite its name it is NOT the reply)
//   assistant turn: [data-testid="copilot-message-div"] (.fai-CopilotMessage)
//                   → text in .fai-CopilotMessage__content
// The old copilot.microsoft.com classes (user-message / ai-message) stay as
// a fallback. Returns [{ role, node, el, text }] in page order; el is a
// cleaned CLONE of just the message text (screen-reader "You said /
// Copilot said" headings, buttons, avatar, name, disclaimer removed).
function lisaCopilotTurns() {
  const USER = '[data-testid="chatQuestion"]';
  const BOT = '[data-testid="copilot-message-div"], .fai-CopilotMessage';
  let nodes = [...document.querySelectorAll(USER + ', ' + BOT)];
  const isNew = nodes.length > 0;
  if (!isNew) nodes = [...document.querySelectorAll('[class*="user-message"], [class*="ai-message"]')];
  const roleOf = n => isNew
    ? (n.matches(USER) ? 'user' : 'assistant')
    : (String(n.className).includes('user-message') ? 'user' : 'assistant');
  // Drop a match nested inside another match of the same role only.
  nodes = nodes.filter(n => !nodes.some(o => o !== n && o.contains(n) && roleOf(o) === roleOf(n)));
  return nodes.map(n => {
    const role = roleOf(n);
    let body = n;
    if (isNew) {
      body = n.querySelector(role === 'user' ? '[class*="UserMessage__message"]' : '[class*="CopilotMessage__content"]') || n;
    }
    const el = body.cloneNode(true);
    el.querySelectorAll('h5, h6, [class*="accessibleHeading"], [class*="actionBar"], [class*="__actions"], [role="toolbar"], ' +
      '[class*="disclaimer"], [class*="__avatar"], [class*="__name"], [class*="FeedbackButtons"], button, svg')
      .forEach(x => x.remove());
    return { role, node: n, el, text: (el.textContent || '').replace(/\s+/g, ' ').trim() };
  }).filter(t => t.text);
}

// Copilot only keeps the latest turns on the page and loads older ones
// when the list is scrolled to the top (seen live: 4 of 10 turns loaded).
// Climb to the top until no more history arrives (re-arming the load
// trigger between tries, as the Claude Code sweep does), then sweep back
// down collecting turns in first-seen order — which also copes if Copilot
// unmounts turns far from the viewport. Returns lisaCopilotTurns() items.
async function lisaCopilotCollectAll() {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const TURN = '[data-testid="chatQuestion"], [class*="user-message"]';
  const first = document.querySelector(TURN);
  if (!first) return lisaCopilotTurns();
  let sc = first.parentElement;
  while (sc && !(/(auto|scroll)/.test(getComputedStyle(sc).overflowY) && sc.scrollHeight > sc.clientHeight + 50)) {
    sc = sc.parentElement;
  }
  if (!sc) sc = document.scrollingElement || document.documentElement;
  const count = () => document.querySelectorAll(TURN).length;
  const scrollTo = top => { sc.scrollTop = top; sc.dispatchEvent(new Event('scroll', { bubbles: true })); };

  // Up: load all history.
  let quiet = 0;
  for (let round = 1; quiet < 2 && round <= 60; round++) {
    const n0 = count(), h0 = sc.scrollHeight;
    scrollTo(0);
    const top = document.querySelector(TURN);
    if (top) top.scrollIntoView({ block: 'start' });
    let grew = false;
    for (let t = 0; t < 12; t++) {
      await wait(250);
      if (count() > n0 || sc.scrollHeight !== h0) { grew = true; break; }
    }
    if (grew) { quiet = 0; await wait(400); } else { quiet++; }
    console.log('[LISA] Copilot history: round ' + round + ', turns ' + n0 + ' → ' + count() + (grew ? ' (loaded more)' : ''));
    if (quiet < 2) { scrollTo(Math.min(sc.clientHeight, sc.scrollHeight)); await wait(250); } // re-arm
  }

  // Down: collect in order. Copilot's list is virtualized and RECYCLES its
  // few DOM nodes for different messages as it scrolls (seen live), so
  // dedupe by role + text, not by node — a node-based WeakSet skipped
  // recycled nodes carrying new messages. Small steps so nothing is
  // scrolled past between renders.
  const seen = new Set();
  const out = [];
  const collect = () => {
    for (const t of lisaCopilotTurns()) {
      const key = t.role + '|' + t.text.slice(0, 300);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(t);
    }
  };
  scrollTo(0);
  await wait(400);
  collect();
  const step = Math.max(150, sc.clientHeight * 0.35);
  let last = -1;
  for (let i = 0; i < 600; i++) {
    scrollTo(sc.scrollTop + step);
    await wait(250);
    collect();
    if (Math.abs(sc.scrollTop - last) < 2) break;
    last = sc.scrollTop;
  }
  console.log('[LISA] Copilot capture: ' + out.length + ' messages');
  return out;
}
window.__lisaCopilotTurns = lisaCopilotTurns;
window.__lisaCopilotCollectAll = lisaCopilotCollectAll;

class CopilotParser {
  constructor() {
    this.platform = 'Microsoft Copilot';
    this.conversationId = this.extractConversationId();
  }

  extractConversationId() {
    // Copilot may use session or conversation IDs
    const match = window.location.pathname.match(/\/chat\/(?:conversation\/)?([a-zA-Z0-9-]+)/);
    return match ? match[1] : 'copilot-session';
  }

  extractMessages(turns) {
    const messages = [];

    const allMessages = turns || lisaCopilotTurns();

    // Deduplicate identical consecutive content
    const seen = new Set();
    for (const msg of allMessages) {
      const text = msg.text || (msg.el.textContent || '').trim();
      if (!text) continue;
      const key = text.substring(0, 100);
      if (seen.has(key)) continue;
      seen.add(key);
      messages.push({
        role: msg.role,
        content: text,
        index: messages.length,
        timestamp: new Date().toISOString()
      });
    }

    return messages;
  }

  extractTextContent(element) {
    const clone = element.cloneNode(true);
    
    // Remove UI elements
    clone.querySelectorAll('button, svg, [role="button"], [class*="icon"]').forEach(el => el.remove());
    
    // Copilot may have specific content containers
    const contentDiv = clone.querySelector('[class*="content"]');
    return contentDiv ? (contentDiv.textContent || contentDiv.innerText || '') : (clone.textContent || clone.innerText || '');
  }

  async extractConversation() {
    this.conversationId = this.extractConversationId();
    const messages = this.extractMessages(await lisaCopilotCollectAll());
    
    if (messages.length === 0) {
      return null;
    }

    return {
      platform: this.platform,
      conversationId: this.conversationId,
      url: window.location.href,
      title: document.title,
      extractedAt: new Date().toISOString(),
      messageCount: messages.length,
      messages: messages
    };
  }

  initializeListener() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'ping') {
        sendResponse({ success: true, platform: this.platform });
        return true;
      }
      if (request.action === 'extractConversation') {
        this.extractConversation()
          .then(conversation => sendResponse({ success: true, data: conversation }))
          .catch(error => {
            console.error('[LISA] Copilot extraction error:', error);
            sendResponse({ success: false, error: error.message });
          });
        return true;
      }
      return false; // not ours — let other listeners answer, or the sender fail fast
    });
  }
}

// Initialize parser
const parser = new CopilotParser();
parser.initializeListener();

chrome.runtime.sendMessage({ 
  action: 'parserReady', 
  platform: 'Microsoft Copilot' 
});
