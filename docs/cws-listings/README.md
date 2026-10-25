# Chrome Web Store listings, 8 languages (from 0.53.2)

Two parts:

1. **Title and summary** come from the package itself: `_locales/<lang>/messages.json` (`extName` max 75 characters,
   `extDescription` max 132). They ship with the 0.53.2 zip; the store shows them to people whose Chrome is in that
   language, and store search matches them. Nothing to paste.
2. **Description**: one file per language here (`fr.txt`, `es.txt`, `de.txt`, `ar.txt`, `ru.txt`, `zh_CN.txt`,
   `ja.txt`, `ko.txt`; `en.txt` is the master they were written from). The English store description stays the long
   `docs/CWS_DESCRIPTION_0.53.2.txt`.

Paste after 0.53.2 is approved (the texts describe the ☆ stars and the interface languages, new in 0.53.2):
Developer Dashboard → LISA → **Store listing** → language menu at the top of the page → pick the language → paste
the description → Save draft → repeat for each language → Submit for review.

Facts in the texts (keep them true): 12 platforms; everything local is free and unlimited, library of 25
conversations without a key; free key (email) = unlimited library + Choose messages + Options + 50 credits for AI; 100 credits = $1, credits never expire; Pro $9.99/month. Machine-written: a native speaker
should read each one when possible. When a fact changes, change `en.txt` and every translation.
