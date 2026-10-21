# Chrome Web Store: release 0.53.0

Text to paste into the Developer Dashboard when uploading 0.53.0 (the LISA Suite release; the store has 0.52.9). Release rule (CLAUDE.md): `main` is
what ships, so fast-forward `main` first, then zip the repo folder and upload.

## 1. Privacy practices tab → Permission justification

Add or update these lines. Reviewers read them; a missing justification for a new host is the most
common reason for a slow or rejected review.

**Host permission `https://shield.sat-chain.com/*`**
> Opens Inference Shield, a SAT-CHAIN tool on the same LISA account, when the user chooses "Check with
> Inference Shield" (right-click menu, floating button or library). The extension passes the text the
> user selected to that page in a new tab so they can analyse it. Nothing is sent until the user picks
> the action, and nothing is analysed until they press Run on the page.

## 2. Privacy practices tab → Data usage

Check that "Website content" is declared as collected (it already is if cloud sync was declared): the
Shield hand-off sends the text the user chose to `shield.sat-chain.com`. Keep the existing
certifications ticked: not sold, not used for unrelated purposes, not used for credit decisions.
The privacy policy URL stays `https://lisa-web-backend-production.up.railway.app/privacy` (it now covers
Inference Shield).

## 3. Store listing → Description

Add this paragraph after the feature list:

> **New: check before you publish.** Right-click any text, or use the floating button on an AI
> conversation, and choose "Check with Inference Shield". It opens Inference Shield in a new tab, a
> SAT-CHAIN tool that finds the phrases revealing how your technology works and rewrites them. Same LISA
> key, same credits; new keys come with 50 free credits.

## 4. What's new (release notes, if the listing shows them)

> - Check with Inference Shield: from the right-click menu, the floating button and your library
> - One credit balance across the extension, LISA Nexus and Inference Shield; sign in with Google or a key
> - Get 50 free credits from the popup

## 5. Expect after upload

- Existing users see Chrome's "new permissions" prompt; the extension pauses until they accept. That
  is normal for a new host permission.
- Review can take a few days longer than usual because of the new host.
- Test the hand-off against the live `https://shield.sat-chain.com/app` before uploading: it must be
  served by Railway, not the Namecheap hosting.
