## Hotfix

Fixes a popup load error that surfaced as `Cannot read properties of null (reading 'style')` in the chrome://extensions Errors tab whenever the Templates panel was opened.

### What changed
- `popup.html`: added `id="input-area"` to the message input wrapper (it had the class but not the id, so `getElementById('input-area')` returned null in `templates.js`).
- `popup-modules/templates.js`: hardened every module-level DOM lookup with defensive null checks via new `_setDisplay`, `_toggleClass`, and `_on` helpers, so a missing element can never crash the entire popup module load again.
- `manifest.json`: `3.11.0` -> `3.11.1`.

No feature changes. Drop-in replacement for v3.11.0.
