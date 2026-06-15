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

**Automated (optional):** add a publish step using the CWS API. It needs four repo secrets —
`CWS_EXTENSION_ID`, `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN` — then append a
job that uses a Chrome-Web-Store upload action (e.g. `mnao305/chrome-extension-upload`) with
`file-path: dist/*.zip`. Left out by default so a release never auto-ships to users.

## Build locally

```bash
npm ci
npm run build      # -> dist/sentinel-override-v<version>.zip
```
