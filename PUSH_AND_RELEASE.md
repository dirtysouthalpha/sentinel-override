# Push to GitHub + Create v3.11.0 Release

A handful of things in this folder I can't do from the sandbox — push to git over a network and authenticate to GitHub. Below is everything you need to copy-paste from your local terminal to ship this release to https://github.com/dirtysouthalpha/sentinel-override.

## ⚠️ ONE STEP YOU NEED TO DO FIRST

Save the three screenshots you sent earlier into the repo, with these exact names:

```
docs/screenshots/01-overview.png       ← the one with GitHub on the left + Sentinel side panel on the right
docs/screenshots/02-command-palette.png ← the command palette modal (edit/save/search/moon/settings/palette)
docs/screenshots/03-theme-customizer.png ← the Customize Theme modal showing all 14 themes + Custom CSS textarea
```

The `docs/screenshots/` folder is already created in the repo. Just drop the PNG files in with those filenames.

The new README references those exact paths, so once they're in place the README will render correctly on GitHub.

## 📦 What's about to be pushed

Run this from the repo root to see the diff:

```bash
git status
```

You should see additions/changes including:
- `manifest.json` — version bumped to 3.11.0, added `downloads` + `tabGroups` permissions
- `README.md` — fully rewritten for the 3.11.0 feature set
- `CHANGELOG.md` — full per-version history
- `RELEASE_NOTES_v3.11.0.md` — release notes for GitHub
- `background/*.js` — every backend file touched across the sprint
- `content/cursor.js` — new file (virtual operator cursor)
- `content/index.js` — substantial additions (sensitive-field block, MFA detection, tenant detection, source chips)
- `popup-modules/chat.js` — major additions (active-tab strip, mini-shot, tenant override card, source chips, run-log export, MFA banner, resume banner, download capture)
- `popup-modules/settings.js` — provider catalog wiring, custom CSS, theme auto-save
- `popup.html` — new UI elements
- `popup.css` — 6 new themes + tenant chip + active-tab strip + mini-shot styles
- `docs/` — audit + design docs

## 🚀 Push commands

```bash
# 1. Check current branch and uncommitted state
cd /path/to/sentinel-override          # adjust to your local path
git status
git branch --show-current

# 2. (If not on main) Switch to main
git checkout main
git pull origin main                   # make sure you're up to date

# 3. Stage everything
git add -A

# 4. Commit with a clean release message
git commit -m "Release v3.11.0 — Tenant Lockdown + Theme Polish + Custom CSS

Major rollup release covering v3.5.x through v3.11.0:
- Tenant lockdown (hard-block cross-tenant modifying actions on M365 admin)
- 14 themes + custom CSS upload + theme auto-save
- 16-provider catalog with model auto-detection
- Source-cited outputs with clickable audit chips
- Forensic run log with JSON/CSV export
- Resume from checkpoint
- CSV/file download capture
- MFA challenge auto-pause
- Sensitive-field protection by label proximity
- Configuration verification gate
- Multi-portal investigation mode (up to 300-step budget)
- Microsoft Graph API extraction strategy
- Virtual operator cursor on synthetic + CDP paths
- Active-tab strip + live mini-screenshot panel
- Tab group attachment + per-tab side panel
- 5 platform contexts (SentinelOne, VirusTotal, M365, Entra, Azure)
- Hallucination hard-stop gate
- 33 JS files, all parse clean as ESM"

# 5. Push to main
git push origin main

# 6. Tag the release
git tag -a v3.11.0 -m "v3.11.0 — Tenant Lockdown + Theme Polish + Custom CSS"
git push origin v3.11.0
```

## 🎁 Create the GitHub release

### Option A — `gh` CLI (one command)

```bash
gh release create v3.11.0 \
  --title "v3.11.0 — Tenant Lockdown + Theme Polish + Custom CSS" \
  --notes-file RELEASE_NOTES_v3.11.0.md \
  --latest
```

If you want to attach a pre-built ZIP for users to download:

```bash
# Build a clean ZIP from the repo (excludes .git, node_modules, docs)
zip -r sentinel-override-v3.11.0.zip . \
  -x "*.git*" "node_modules/*" "*.DS_Store" "docs/AUDIT*" "docs/REVAMP*" \
     "docs/MSP_TASK_PLAYBOOKS*" "docs/VISUAL_FEEDBACK*" "PUSH_AND_RELEASE.md" \
     "RELEASE_NOTES_v3.11.0.md"

# Attach to the release
gh release upload v3.11.0 sentinel-override-v3.11.0.zip
```

### Option B — GitHub web UI

1. Go to https://github.com/dirtysouthalpha/sentinel-override/releases/new
2. **Choose a tag**: `v3.11.0` (it'll create from your push)
3. **Release title**: `v3.11.0 — Tenant Lockdown + Theme Polish + Custom CSS`
4. **Describe this release**: copy the contents of `RELEASE_NOTES_v3.11.0.md`
5. (Optional) Drag the ZIP file from Option A into the binary attachments
6. Check **Set as the latest release**
7. Click **Publish release**

## ✅ Post-release checklist

- [ ] README renders correctly on GitHub (screenshots load, tables render, badges show)
- [ ] Release page is published and tagged `v3.11.0`
- [ ] If you have an existing pinned issue or wiki, update version references
- [ ] Consider adding a tweet/post linking to the release page with the screenshots

## 🐛 If something goes wrong with the README rendering

GitHub's markdown renderer is strict about a few things:

- **Image paths must be relative** (`docs/screenshots/...`) — already done.
- **HTML tables must have proper `<tr>` / `<td>` structure** — already done.
- **Badges via shields.io load slowly the first time** — give it 30 seconds.
- **If a screenshot doesn't load**, check the filename matches exactly (`01-overview.png`, `02-command-palette.png`, `03-theme-customizer.png`). Case-sensitive.

## 📊 What's in the audit docs (for context, not part of the release)

The `docs/` folder includes design docs and audit notes that aren't user-facing but are useful if a contributor wants to understand the sprint history:

- `docs/AUDIT_2026-05-06.md` — original audit identifying P0/P1/P2 issues
- `docs/REVAMP_2026-05-08.md` — prioritized revamp plan with file:line pointers
- `docs/MSP_TASK_PLAYBOOKS_2026-05-08.md` — per-task analysis (SonicWall VPN, M365 perms, Exchange, Entra)
- `docs/VISUAL_FEEDBACK_AND_AI_PLANNING.md` — the design doc for the visual operator cursor + planning architecture

You can keep these in the repo for posterity, exclude them from the release ZIP, or move them to a separate `docs-internal/` branch — your call.

---

That's it. Push, tag, release, done.
