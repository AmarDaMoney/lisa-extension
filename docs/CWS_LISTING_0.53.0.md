# Chrome Web Store: release 0.53.0 (LISA Suite launch)

Everything to paste into the Developer Dashboard for 0.53.0 (the store has 0.52.9). Release rule
(CLAUDE.md): `main` is what ships, so fast-forward `main` first, then zip the repo folder and upload.
Wording rules: no unsourced numbers, no "patent-pending", never promise that a text is safe.

## 1. Store listing

**Name** (from `manifest.json`, unchanged): `LISA - AI Chat Exporter for Claude, ChatGPT & More`.
It keeps the search words people use ("AI chat exporter"). Optional, if you want Handoff in the name:
`LISA - AI Chat Exporter & Handoff for Claude, ChatGPT & More` (edit `manifest.json` → `name`).

**Summary** (from `manifest.json` → `description`, updated, 122 of 132 characters):
> Save, compress and hand off AI chats across 12 platforms. One key and credit balance with LISA Nexus and Inference Shield.

**Description:** paste the whole of `docs/CWS_DESCRIPTION_0.53.0.txt` (about 13,500 of the 16,000
characters the store allows). It keeps the long, explanatory listing (the translation principle, ACM,
the pipeline) and updates it for the suite launch. What changed from the 0.52.9 text, and why:
- New "v0.53.0: the LISA Suite" block and an Inference Shield section ("coming soon" was out of date).
- Pricing: one key across the suite, 50 free credits with a key, Pro includes 300 Shield credits a
  month, Team and Enterprise mentioned.
- Accuracy: "10 languages" (the code detects 6 scripts plus English and other Latin-script languages);
  "tamper-proof" → changes are detectable; "zero server uploads" → text leaves the browser only for the
  online features the user picks (AI compression, sync, Inference Shield); "understands exactly the
  same" → "essentially"; "Every other tool" → "Most tools"; library "search" removed (the popup has
  none); MCP marked early access; version 0.53.0.

## 2. What's new in 0.53.0 (release notes, if shown)

> • Check with Inference Shield: from the right-click menu, the floating button and your library
> • One key and one credit balance across the extension, LISA Nexus and Inference Shield
> • Choose what to save: only your messages, only the AI's replies, or the messages you pick
> • Handoff can now send the full conversation word for word (Markdown) or the compact LISA format
> • Help and Settings moved to the top of the popup; a shorter floating menu
> • New look: LISA's neon-L logo, faster connection to our own servers (api.sat-chain.com)
> • Fix: LISA-Verbatim integrity checks now verify correctly

## 3. Privacy practices tab

**Permission justification: new host permissions** (no other permission changed since 0.52.9):

- `https://api.sat-chain.com/*`
  > The LISA backend's own address (it replaces the previous railway.app address, kept as a fallback).
  > Used for license validation, the credit balance, purchases and the optional Library sync.
- `https://nexus.sat-chain.com/*`
  > LISA Nexus, the web app on the same account: the extension opens its pricing, app and
  > payment-confirmation pages for the user.
- `https://shield.sat-chain.com/*`
  > Opens Inference Shield, a SAT-CHAIN tool on the same LISA account, when the user chooses "Check with
  > Inference Shield" (right-click menu, floating button or library). The extension passes the text the
  > user chose to that page in a new tab so they can analyse it. Nothing is sent until the user picks
  > the action, and nothing is analysed until they press Run on the page.

**Data usage:** "Website content" stays declared (Shield hand-off and Library sync send text the user
chose). Keep the certifications ticked: not sold, not used for unrelated purposes, not used for
creditworthiness.

**Privacy policy URL:** change to `https://nexus.sat-chain.com/privacy` (our own domain; covers the
extension, Nexus and Inference Shield).

## 4. Images (optional but recommended)

- Small promo tile / marquee: the LISA Suite image (neon L + Inference Shield logos, navy and gold).
- Screenshots (1280×800): the floating menu, Handoff destinations, Options / Choose messages, the popup
  library, and Inference Shield opened from a selection. The guide screenshots get recaptured with the
  new logos as part of this release; reuse them.

## 5. Expect after upload

- Existing users see Chrome's "new permissions" prompt (the three sat-chain.com hosts); the extension
  pauses until they accept. Normal for new host permissions.
- Review can take a few days longer than usual because of the new hosts.
- Before uploading: test against the live sites (api., nexus., shield.sat-chain.com), all served by
  Railway.
