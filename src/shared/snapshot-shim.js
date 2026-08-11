/**
 * readSnapshot(snapshot)
 *
 * One definition of where a snapshot's content lives. Snapshots exist in
 * several shapes - markdown exports, captured message arrays, compressed
 * summaries, rebirth handoffs - and consumers previously each guessed at a
 * different fallback order. They disagreed on the same snapshot.
 *
 * Returns a stable shape:
 *   format   - the snapshot's declared format, or 'unknown'
 *   messages - array of {role, content} with real text. EMPTY for lossy
 *              snapshots: summaries must never be handed to code that
 *              believes it is reading a conversation.
 *   markdown - a renderable string, or null. Safe for display.
 *   count    - message count for display purposes
 *   isLossy  - true when the original text was not retained
 */
function readSnapshot(snapshot) {
  const out = { format: 'unknown', messages: [], markdown: null, count: 0, isLossy: false };
  if (!snapshot || typeof snapshot !== 'object') return out;

  const raw = (snapshot.raw && typeof snapshot.raw === 'object') ? snapshot.raw : {};
  out.format = snapshot.format || raw.format || 'unknown';

  out.markdown = snapshot.rebirthHandoff || raw.rebirthHandoff || raw.markdownContent || null;

  let msgs = raw.messages || snapshot.messages || null;
  if (!msgs) {
    const c = snapshot.content || raw.content;
    if (Array.isArray(c)) msgs = c;
  }
  if (!Array.isArray(msgs)) msgs = [];

  const withText = msgs.filter(m => {
    const t = m && (m.content || m.text || m.v);
    return typeof t === 'string' && t.trim().length >= 15;
  });

  out.count = msgs.length || raw.blockCount || snapshot.blockCount || 0;

  if (msgs.length > 0 && withText.length === 0) {
    out.isLossy = true;
    return out;
  }

  out.messages = withText.map(m => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: m.content || m.text || m.v
  }));
  out.count = out.messages.length || out.count;
  return out;
}

/**
 * describeSnapshot(snapshot)
 *
 * Display counterpart to readSnapshot. Where readSnapshot refuses to
 * return summaries as messages - nothing should analyse a summary as if
 * it were conversation - this returns whatever is safe to show a user,
 * clearly flagged when the original text was not retained.
 *
 * Returns { text, isLossy, source } where source names what was found:
 * 'markdown', 'messages', 'summaries', 'blocks', or 'none'.
 */
function describeSnapshot(snapshot) {
  const out = { text: null, isLossy: false, source: 'none' };
  if (!snapshot || typeof snapshot !== 'object') return out;

  const view = readSnapshot(snapshot);

  if (view.markdown) {
    out.text = view.markdown;
    out.source = 'markdown';
    return out;
  }

  if (view.messages.length > 0) {
    out.text = view.messages
      .map(m => '### ' + (m.role === 'user' ? 'User' : 'Assistant') + '\n' + m.content)
      .join('\n\n');
    out.source = 'messages';
    return out;
  }

  const raw = (snapshot.raw && typeof snapshot.raw === 'object') ? snapshot.raw : {};

  const summaryHolders = raw.messages || raw.semanticTokens || raw.compressed || null;
  if (Array.isArray(summaryHolders)) {
    const parts = summaryHolders
      .map(m => m && typeof m.summary === 'string' ? m.summary.trim() : '')
      .filter(t => t.length > 0);
    if (parts.length > 0) {
      out.text = parts.join('\n\n');
      out.isLossy = true;
      out.source = 'summaries';
      return out;
    }
  }

  const c = snapshot.content || raw.content;
  if (Array.isArray(c)) {
    const parts = c
      .map(b => (b && typeof b.v === 'string') ? b.v : '')
      .filter(t => t.trim().length > 0);
    if (parts.length > 0) {
      out.text = parts.join('\n');
      out.source = 'blocks';
      return out;
    }
  } else if (typeof c === 'string' && c.trim().length > 0) {
    out.text = c;
    out.source = 'blocks';
    return out;
  }

  return out;
}

if (typeof module !== 'undefined' && module.exports) module.exports = { readSnapshot, describeSnapshot };
