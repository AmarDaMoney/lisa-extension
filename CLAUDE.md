# LISA — Chrome Extension

> **Semantic compression for AI conversations.** Export from 12 AI platforms. Premium features include cloud sync and integrity verification.

## Project overview

LISA is a Chrome Extension (Manifest V3) that captures, compresses, and exports AI conversations from 12 platforms: Claude, ChatGPT, Gemini, Grok, Mistral, DeepSeek, Copilot, Perplexity, HuggingChat, Meta AI, Poe, and Claude Code. It uses semantic compression (SAT-chain) to reduce conversation size while preserving meaning. Premium tier adds cloud sync, integrity hashing, and license key management via a Railway-hosted backend.

**Version:** Check `manifest.json` → `"version"` for current.
**Owner:** Amar (dahmani.amar.trad@gmail.com)
**Repo:** AmarDaMoney/lisa-extension

## Architecture

```
manifest.json                    ← MV3 manifest, all 13 content_script entries
src/
  background/
    service-worker.js            ← Core engine (~1900 lines): LISACompressor, SnapshotManager,
                                   license/subscription logic, message handlers, export builders
  content/
    lisa-progressive.js          ← MutationObserver-based live capture for all 12 platforms
    lisa-floating-button.js      ← FAB UI overlay with action menu (export, settings, etc.)
    lisa-v-parser.js             ← V-format parser (~1800 lines) — deep semantic extraction
    acm-monitor.js               ← ACM Phase 1: message/token counting, context health (WIP)
    claude-parser.js             ← Platform-specific DOM parsers (one per platform)
    chatgpt-parser.js
    gemini-parser.js
    grok-parser.js
    mistral-parser.js
    deepseek-parser.js
    copilot-parser.js
    perplexity-parser.js
    huggingchat-parser.js
    metaai-parser.js
    poe-parser.js
    claude-code-parser.js
    universal-parser.js          ← Fallback parser for unsupported platforms
    claude-api-capture.js        ← Network intercept for Claude streaming responses
    chatgpt-api-capture.js       ← Network intercept for ChatGPT streaming responses
    perplexity-api-capture.js    ← Network intercept for Perplexity
    perplexity-api-main.js       ← Perplexity MAIN world script (separate content_script entry)
  popup/
    popup.html                   ← Extension popup UI
    popup.js                     ← Popup logic (~2600 lines): tabs, export, settings, license
    popup.css                    ← Popup styles
    success.html                 ← Post-purchase redirect
  shared/
    html-to-markdown.js          ← HTML→Markdown converter used by content scripts
    export-builders.js           ← Export format builders (JSON, Markdown, etc.)
    snapshot-shim.js             ← Shared snapshot schema (loaded first by service worker)
public/
  icon16.png, icon48.png, icon128.png
```

## Key patterns

### Content script load order matters
Each platform's content_scripts entry in `manifest.json` loads scripts in order. The typical sequence is:
1. API capture script (if applicable — Claude, ChatGPT, Perplexity)
2. Platform-specific parser
3. `lisa-progressive.js` (live capture via MutationObserver)
4. `html-to-markdown.js`
5. `lisa-v-parser.js`
6. `acm-monitor.js`
7. `lisa-floating-button.js` (must be last — depends on others)

### Message passing
Content scripts ↔ service worker communication uses `chrome.runtime.sendMessage` / `chrome.runtime.onMessage`. Key actions:
- `parserReady` — parser loaded and ready
- `exportConversation` — trigger export
- `acm_getMonitorStatus` / `acm_checkpoint` — ACM status queries
- License/subscription management messages

### Storage
- `chrome.storage.local` — conversation data, snapshots, ACM state, license info
- `chrome.storage.sync` — user preferences, settings, ACM thresholds
- Snapshot keys follow `lisaSnapshotsIndex` pattern in service worker

### Platform detection
Parsers detect their platform via `window.location.hostname`. Each parser exports a `parse()` function that returns a standardized conversation object. The `_getConversationId()` pattern extracts conversation IDs from URL paths.

### No build system
This is a raw Chrome extension — no bundler, no transpiler. All JS is vanilla ES2020+. Just load the unpacked extension folder in Chrome.

## Engineering principles

- **Never break existing parsers.** When modifying shared code (lisa-progressive.js, service-worker.js), verify all 12 platform parsers still work.
- **Test on claude.ai first** — it's the primary platform and most complex (streaming API capture + DOM parsing).
- **Keep content scripts lightweight.** Heavy processing belongs in the service worker.
- **WeakSet for DOM deduplication** — never use hash computation on DOM nodes; WeakSet is O(1) and GC-friendly.
- **Fail silently in content scripts.** Wrap chrome.storage and chrome.runtime calls in try/catch — the extension must not break the host page.
- **Respect load order** in manifest.json content_scripts entries.

## Ways of working

- **Branch strategy:** `main` is the release branch (pushed to Chrome Web Store). Feature work goes on `feature/*` branches.
- **Version bumps:** Update `manifest.json` → `"version"` field. Follow semver-ish: patch for fixes, minor for features. Keep it at the *next unreleased* Chrome Web Store version — don't bump per commit (e.g. CWS has 0.52.7 → stay on 0.52.8 until that ships).
- **Keep `main` and `feature/acm` in sync:** after every push to `feature/acm`, fast-forward `main` to it (`git merge --ff-only`) and push `main`. Never force-push either.
- **Commits:** Descriptive messages. Reference the platform name if the change is platform-specific.
- **Testing:** Load unpacked in Chrome, test on the target AI platform. No automated test suite currently.

## Common tasks

### Adding a new AI platform
1. Create `src/content/{platform}-parser.js` following existing parser patterns
2. Add a content_scripts entry in `manifest.json` with the correct URL match and script load order
3. Add platform detection to `lisa-progressive.js` `_getMessageSelector()` and `_getConversationId()`
4. Add platform detection to `acm-monitor.js` (same two methods)
5. If the platform uses streaming, add an API capture script
6. Add the host_permission to manifest.json

### Modifying the floating button
Edit `src/content/lisa-floating-button.js`. The button HTML, CSS, and JS are all in this one file. The ACM dot is inside the button element.

### Export format changes
Export logic lives in `src/background/service-worker.js` (LISACompressor class) and `src/shared/export-builders.js`.

### Backend/API
The backend is at `https://lisa-web-backend-production.up.railway.app`. License validation, subscription management, and cloud sync go through it. The CSP in manifest.json must allow connect-src to this domain.

## Active development

### ACM (Active Context Management)
Branch: `feature/acm`. Concept: keep AI conversations coherent as they grow
long, without requiring a handoff to a fresh conversation until the user
actually chooses one. Three layers — Monitor → Extend → Inject — all built
and working; Inject still has open edges (see below). No separate spec
doc — this section is the current source of truth; earlier inspiration
docs (an ACM spec/product doc, a "Phoenix" rebirth spec) were never
committed to the repo and have since been substantially superseded by
real testing and iteration — treat any old copies as historical context,
not current direction.

**Phase 1 — Monitor** (`src/content/acm-monitor.js`). Health dot on the
floating button (green/yellow/red/critical) from message-count
thresholds. API-first counting on Claude/ChatGPT via the existing
`claude-api-capture.js`/`chatgpt-api-capture.js` modules, DOM rescan
fallback elsewhere. Per-conversation state persisted to
`chrome.storage.local` under `lisa-acm-<conversationId>` (24h restore).

**Phase 2 — Extend** (checkpoint). A "Context Checkpoint" action copies a
structured prompt (DECISIONS/OPEN/RESOLVED/CONSTRAINTS/KEY CONTEXT) to
the clipboard for the user to paste into the live chat — this is Tier 2:
zero API cost, uses the session's own AI to summarize itself. The
monitor passively detects the AI's structured response (via the same
rescan hooks, no polling/blocking UI) and stores it in
`chrome.storage.local` under `lisa-acm-checkpoint-<conversationId>`
(rolling history, last 3). Smart toast suggestions fire once per
health-level transition (yellow/red/critical), not on every rescan.

**Phase 3 — Inject (Handoff)**. Floating button menu has a single
"Handoff" entry opening a two-step panel: ① Create/Update Checkpoint
(same prompt as Phase 2), ② Compress & Handoff (works with or without a
checkpoint — richer with one). Step ② keeps the first 2 and last ~4
messages verbatim and compresses only the middle, via a dedicated
service-worker action `compressForHandoff` that chains the *same*
pipeline the popup's own Compress button uses (`SemanticAnalyzer.analyze`
→ `LISACompressor.compress` → `buildLeanExport`, the last of which now
also keeps opening/closing verbatim for every export path, not just
handoff — see `src/shared/export-builders.js`). This parity was not
automatic — three duplicate/drifted copies of the lean-export logic
existed before being consolidated to call the one shared function.

Handoff works from every source platform: `_executeHandoff()` uses the
platform's API capture where one exists (`ACMMonitor._getApiCapture()` —
Claude, Claude Code, ChatGPT, Perplexity), else the same `LisaVParser`
page capture Markdown export uses. Destinations come from
`ACMMonitor.HANDOFF_RECEIVERS` — a per-*target* status map (the payload is
the same JSON whatever the source, so receiving is a property of the
target alone): ok = claude, chatgpt, gemini, grok, deepseek, huggingchat,
poe, claudecode, mistral, metaai (confirmed after the three-stage
injection + meta.ai URL fix); untested = copilot,
perplexity (non-ok ones are labelled in the picker) — intersected
with the user's platform preferences (set in popup Settings, stored as
`acmPlatforms`). Picking a target opens a new tab next to the source tab
(`chrome.tabs.create` with `index`/`windowId` from `sender.tab`) and
attempts real file injection via the existing `injectFileAttachment`
path in `lisa-progressive.js` (the same one the library's manual inject
already used) — not just a clipboard copy. Confirmed working Claude→
Gemini, Claude→Grok and Claude→ChatGPT. **Injection into the new tab**
(`_autoInjectHandoff` in `lisa-progressive.js`, all platforms) runs three
stages: (1) inject the file — the platform's file input first where live
tests proved it (`FILE_INPUT_FIRST`: claude, gemini, grok, deepseek,
huggingchat, poe; Gemini's hidden input via `_injectViaFileInput`), else a
synthetic `paste` then `drop` carrying the File, each *verified* by the
page calling `preventDefault`, then the file input as an unverified last
try; (2) unless stage 1 was verified, a one-shot capture-phase paste
intercept turns the user's real Ctrl+V into a file paste; (3) the handoff
text is on the clipboard, so a Ctrl+V the page won't take as a file
pastes text. A page/extension can't put a real *file* on the OS
clipboard (Chrome allows text/HTML/PNG only) — stage 2 is the substitute.
Besides `preventDefault`, a step also counts as accepted when an
attachment chip showing the file name (its first 12 chars) appears on the page
within ~2s — Meta AI accepts a pasted file without calling
`preventDefault`, which made the next method run too (handoff arrived
twice). Every step logs `[LISA] Handoff: …` in the new tab. History: ChatGPT's
file path never ran before (TDZ bug, fixed); synthetic paste is confirmed
live on ChatGPT. Meta AI handoffs opened www.meta.ai, where LISA's content
scripts don't run (they match meta.ai) — NEW_CHAT_URLS now opens meta.ai.
The handoff file is named like a library save, `<Title>-lisa-<SourcePlatform>.json`.
Titles in all filenames go through `lisaSafeTitle()` (`src/shared/export-builders.js`;
the FAB, a content script, carries the same rule inline): letters, combining marks and
digits from every script are kept (French accents, Arabic, CJK, Cyrillic, Hindi vowel signs),
only punctuation/symbols/emoji dropped, cut at whole characters. The manual library inject (`injectFiles` without `_autoInject`) keeps its
original file input → drop → clipboard order.

### Claude Code capture (claude.ai/code/*)
API-first via `window.__LISA_CLAUDE_CODE_API_CAPTURE` in
`src/content/claude-code-parser.js`: pages through
`/v1/code/sessions/<session_id>/events` (header `anthropic-version:
2023-06-01`, 50 events/page, newest first, `?cursor=<next_cursor>`).
Only `user` events with typed text and the text blocks of `assistant`
events become messages (tool calls/results, progress, control and
sub-agent events are skipped; one assistant message per turn). Falls
back to the shared scroll sweep `window.__lisaClaudeCodeSweep` (same
file), which re-arms Claude Code's load-more-at-top paging until two
arrivals at the top bring nothing. Both `LisaVParser` (popup + FAB) and
`ClaudeCodeParser` use these — don't re-duplicate them. Console lines
`[LISA CC] …` show which path ran.

Events are cached per session (append-only log, newest-first paging
stops at the first known event), so repeat calls cost ~1 request. That
is what lets ACM run on Claude Code: `acm-monitor.js` (injected there via
the claude.ai/* entry) treats `/code/` as platform `claudecode`, an API
platform fed by the same capture module, and Handoff uses it as a
source. Conversation id is `claudecode-session_…` (lisa-progressive.js
and shared/conversation-id.js) — stable across reloads, so checkpoints
persist. Claude Code confirmed live as a handoff source (→ Claude, →
fresh Claude Code session; other targets reported working).

**Known pre-existing dead ends** (not from ACM work, found during a code
audit): `preCacheConversation` (sent from `lisa-floating-button.js` on
tab-hide) and `refreshUserTier` (sent from `success.html` post-checkout)
both have no handler anywhere — harmless no-ops, not regressions, just
unimplemented. `acm_getStatus` in `service-worker.js` has a handler but
no caller. Leave as-is unless picking them up deliberately.
