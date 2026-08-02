# Chrome Web Store — submission runbook

Everything that can be prepared without a developer account is done. What remains needs
Brandon's Google account and the $5 registration fee.

**Package:** `dist/sentinel-override-v21.6.76.zip` — 1.78 MB, 161 files, rebuilt and verified
2026-08-02. (Issue #43 referenced `v21.5.2`; that is stale.) Rebuild any time with `npm run build`.

## Pre-flight — verified

| Item | State |
|---|---|
| Manifest V3 | ✅ `manifest_version: 3` |
| Version matches `package.json` | ✅ both `21.6.76` |
| Package builds cleanly | ✅ 161 files, debug stripped from 44 |
| Screenshots | ✅ 3 × 1280x800 PNG in `docs/screenshots-cws/` |
| Privacy policy | ✅ `PRIVACY.md`, public at the URL in `CWS-LISTING.md` |
| Listing copy | ✅ `CWS-LISTING.md` — name, summary, description, category, single purpose |
| Permission justifications | ✅ all 15 documented in `CWS-LISTING.md` (was 2) |
| Remote code | ✅ none — everything ships in the package |

## Manual steps

1. **Register** at [chrome.google.com/webstore/devconsole](https://chrome.google.com/webstore/devconsole) — $5 one-time, needs a Google account.
2. **Create item → upload** `dist/sentinel-override-v21.6.76.zip`.
3. **Store listing tab** — paste from `CWS-LISTING.md`: name, short summary (132 char limit, current copy fits), detailed description, category *Developer Tools*, language English. Upload the three screenshots.
4. **Privacy tab** — this is where submissions usually stall. Paste the single-purpose statement and *every* permission justification from `CWS-LISTING.md`. Set the privacy policy URL. Answer the data-usage questions (see below).
5. **Submit for review** — Google typically takes 3–7 days, longer for `debugger`.
6. **After approval** — add the store link to `README.md` and close #43.

## Data-usage answers

The dashboard asks you to certify each category. Based on what the code actually does:

- **Personally identifiable information** — No.
- **Health / financial information** — No.
- **Authentication information** — **Yes.** `background/session-manager.js` stores cookies, and API keys live in `chrome.storage`. Both stay local to the browser; neither is transmitted anywhere except, in the cookies' case, back to the site they came from.
- **Personal communications, location, web history** — No.
- **User activity** — **Yes.** Run history and screenshots are retained locally for reporting.
- **Website content** — **Yes.** Page content and screenshots are sent to the LLM endpoint the user configures. This is the extension's core function and must be disclosed.

Then certify: data is not sold, not used for unrelated purposes, and not used for
creditworthiness or lending.

## Expect scrutiny on `debugger`

It is the single most likely rejection cause, and `proxy` plus `cookies` alongside
`<all_urls>` compounds it. The justification in `CWS-LISTING.md` makes the necessary
argument — screenshots via CDP are the vision mechanism, and the debugger attaches only to
tabs the user explicitly runs on. If a reviewer pushes back, that scoping is the point to
lead with, not the feature list.
