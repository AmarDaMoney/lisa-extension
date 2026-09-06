/**
 * judge.js — Reconstruction quality evaluation.
 *
 * Two calls per question so the expected answer never leaks
 * into the answering call.
 *
 * Usage: require('./judge').evaluate(payloadText, questions)
 * questions = [{q: "What file was changed?", a: "popup.js"}]
 */
const MODEL = process.env.LISA_EVAL_MODEL || 'claude-sonnet-4-6';

let _client = null;
function client() {
  if (!_client) {
    const Anthropic = require('@anthropic-ai/sdk');
    _client = new Anthropic();
  }
  return _client;
}

async function ask(payload, question) {
  const r = await client().messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: [{
      type: 'text',
      text: 'Answer only from the attached LISA file. If the file lacks the information, reply exactly: NOT IN FILE.'
    }],
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: payload, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: question }
      ]
    }]
  });
  return r.content.map(b => b.text || '').join('').trim();
}

async function grade(question, expected, got) {
  const r = await client().messages.create({
    model: MODEL,
    max_tokens: 64,
    messages: [{
      role: 'user',
      content: `Question: ${question}\nExpected: ${expected}\nAnswer: ${got}\nReply with one word: CORRECT, WRONG, or MISSING (if answer was NOT IN FILE).`
    }]
  });
  return r.content.map(b => b.text || '').join('').trim().toUpperCase();
}

/**
 * evaluate(payloadText, questions) — Run quality assessment.
 *
 * Returns { recall, hallucination, missing, details }
 */
async function evaluate(payloadText, questions) {
  const details = [];
  let correct = 0, wrong = 0, missing = 0;

  for (const { q, a } of questions) {
    const answer = await ask(payloadText, q);
    const verdict = await grade(q, a, answer);

    if (verdict.includes('CORRECT')) correct++;
    else if (verdict.includes('WRONG')) wrong++;
    else missing++;

    details.push({ q, expected: a, got: answer, verdict });
  }

  const total = questions.length;
  return {
    recall: (correct / total).toFixed(2),
    hallucination: (wrong / total).toFixed(2),
    missing: (missing / total).toFixed(2),
    details
  };
}

module.exports = { evaluate };
