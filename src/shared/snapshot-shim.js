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

if (typeof module !== 'undefined' && module.exports) module.exports = { readSnapshot };
