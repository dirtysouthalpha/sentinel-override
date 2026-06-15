# Releasing

Sentinel Override is a **Chrome (Manifest V3) browser extension** — it is **not** an npm
package, so it is *not* published to npm (`package.json` stays `private: true`). A release is:

1. a built **Chrome Web Store `.zip`** (produced by `npm run build` → `dist/`), and
2. a **GitHub Release** with that zip attached (automated by `.github/workflows/release.yml`),
3. then an upload to the **Chrome Web Store**.

## Cut a release

The packaged version comes from `manifest.json` (`build.js` reads it); keep `package.json`
`version` in sync for clarity.

```bash
# 1. Bump the version in manifest.json (and package.json to match)
# 2. Commit, tag, push
git commit -am "Release vX.Y.Z"
git push origin main
git tag vX.Y.Z
git push origin vX.Y.Z
```

Pushing the `v*` tag triggers `release.yml`: it runs `npm ci`, `npm test`, `npm run build`,
and creates a GitHub Release with `dist/sentinel-override-vX.Y.Z.zip` attached.

## Publish to the Chrome Web Store

**Manual (simplest):**
1. Download the `.zip` from the GitHub Release (or run `npm run build` locally).
2. Go to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole),
   open the item, **Upload new package**, upload the zip, then **Submit for review**.

**Automated (built in, opt-in):** `release.yml` already includes a "Publish to Chrome Web
Store" step that uploads the zip and submits it for review. It only runs when the CWS secrets
are present, so a release without them still succeeds (zip + GitHub Release only).

Enable it by adding four repo secrets (**Settings → Secrets and variables → Actions**):

| Secret | What it is |
| --- | --- |
| `CWS_EXTENSION_ID` | The extension's ID from the Web Store dashboard URL |
| `CWS_CLIENT_ID` | Google Cloud OAuth client ID |
| `CWS_CLIENT_SECRET` | Google Cloud OAuth client secret |
| `CWS_REFRESH_TOKEN` | OAuth refresh token for the Chrome Web Store API |

To obtain the OAuth credentials: enable the **Chrome Web Store API** in a Google Cloud
project, create an **OAuth client (Desktop app)** for the `CLIENT_ID`/`CLIENT_SECRET`, then do
the one-time consent flow to mint a `REFRESH_TOKEN` (see the
[`chrome-extension-upload` docs](https://github.com/mnao305/chrome-extension-upload#how-to-get-the-keys)).
Google still reviews each submission before it reaches users.

## Build locally

```bash
npm ci
npm run build      # -> dist/sentinel-override-v<version>.zip
```
