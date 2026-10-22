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

**Description** (paste as is):

> **Your AI conversations, saved, portable and ready for your next AI.**
>
> LISA adds an "Export to LISA" button to your AI chats. Save any conversation in one click, compress it
> into a compact LISA file any AI can pick up from, or hand it off to another AI and keep working with
> your full context.
>
> **Works on 12 platforms:** Claude, Claude Code on the web, ChatGPT, Gemini, Grok, Mistral, DeepSeek,
> Microsoft Copilot, Perplexity, HuggingChat, Meta AI and Poe.
>
> **SAVE**
> • Markdown: the whole conversation as readable text
> • LISA-Verbatim: structured, word for word, with integrity hashes that show if it was changed later
> • Choose what to keep: the whole conversation, only your messages, only the AI's replies, or the exact
>   messages you tick
>
> **CONTINUE ANYWHERE**
> • Checkpoint: the AI sums up where things stand (decisions, open questions, constraints)
> • Handoff: open a new chat on another AI (or the same one) with your context attached, so you don't
>   start from zero when a conversation gets too long
> • Compress: a compact LISA token that keeps the decisions, tasks and key facts, much smaller than the
>   full chat
>
> **YOUR LIBRARY**
> • Every save lands in a library in your browser: open, re-export or hand off later
> • Optional sync to your online Library in LISA Nexus, to reach it from any device
>
> **CHECK BEFORE YOU PUBLISH: Inference Shield**
> Right-click any text, or use the floating button, and choose "Check with Inference Shield". It opens
> Inference Shield, a SAT-CHAIN tool that finds the phrases revealing how your technology works and
> rewrites them, so your public text doesn't give your methods away.
>
> **ONE KEY FOR THE LISA SUITE**
> One license key and one credit balance work in the extension, LISA Nexus (nexus.sat-chain.com) and
> Inference Shield (shield.sat-chain.com). New keys come with 50 free credits. Pay as you go with
> credits that never expire, or choose a Pro, Team or Enterprise plan.
>
> **PRIVACY**
> Your saved conversations stay in your browser unless you choose to sync them. Nothing is sent to
> Inference Shield until you pick that action, and nothing is analysed until you press Run there.
> Payments are handled by Stripe. We don't sell your data.
>
> Help and guide: nexus.sat-chain.com/guide · Contact: contact@sat-chain.com
> LISA is made by SAT-CHAIN LLC.

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
