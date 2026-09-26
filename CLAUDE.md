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
- **Version bumps:** Update `manifest.json` → `"version"` field. Follow semver-ish: patch for fixes, minor for features.
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

### ACM (Active Context Management) — In Progress
Branch: `feature/acm`
Status: Phase 1 (Monitor) built but paused for redesign.
Concept: Live compression layer that tracks context health during AI conversations.
Three layers: Monitor → Compress → Inject.
See project docs `LISA_ACM_SPEC.md` and `LISA_ACM_PRODUCT.md` for full spec.
