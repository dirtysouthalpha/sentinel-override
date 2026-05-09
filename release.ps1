# Sentinel Override -- v3.11.0 release script
# One command, end-to-end push + tag + GitHub release.
#
# USAGE:
#   1. Drop your 3 screenshots into docs/screenshots/ with these EXACT names:
#         01-overview.png        (GitHub on left + Sentinel side panel on right)
#         02-command-palette.png (the command palette modal)
#         03-theme-customizer.png (the Customize Theme modal with all 14 themes)
#   2. From this folder, in PowerShell:
#         .\release.ps1
#
# Requires: git, optionally gh (GitHub CLI). If gh is not installed, the script
# stops after the push + tag and prints instructions to create the release via
# the GitHub web UI.

$ErrorActionPreference = "Stop"
$VERSION = "v3.11.0"
$TITLE   = "v3.11.0 -- Tenant Lockdown + Theme Polish + Custom CSS"

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Sentinel Override $VERSION -- Release Script" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# Step 0 -- make sure we are in the repo root
if (-not (Test-Path "manifest.json")) {
    Write-Host "ERROR: must be run from the sentinel-override repo root (no manifest.json found)." -ForegroundColor Red
    exit 1
}

# Step 1 -- verify screenshots are in place
$shots = @(
    "docs/screenshots/01-overview.png",
    "docs/screenshots/02-command-palette.png",
    "docs/screenshots/03-theme-customizer.png"
)
$missing = @()
foreach ($s in $shots) {
    if (-not (Test-Path $s)) { $missing += $s }
}
if ($missing.Count -gt 0) {
    Write-Host "MISSING SCREENSHOTS -- add these to the repo before running again:" -ForegroundColor Yellow
    foreach ($m in $missing) { Write-Host "  - $m" -ForegroundColor Yellow }
    Write-Host ""
    Write-Host "You can save your screenshots from the chat directly into docs/screenshots/" -ForegroundColor Yellow
    Write-Host "with those exact filenames, then re-run this script." -ForegroundColor Yellow
    Write-Host ""
    $continue = Read-Host "Continue anyway without the screenshots? (y/N)"
    if ($continue -ne "y" -and $continue -ne "Y") {
        Write-Host "Stopped. Drop the PNGs in and re-run." -ForegroundColor Yellow
        exit 0
    }
}

# Step 2 -- make sure we are on main and up to date
Write-Host "[1/6] Checking out main..." -ForegroundColor Green
$branch = git branch --show-current
if ($branch -ne "main") {
    Write-Host "  Switching from '$branch' to main..."
    git checkout main
}
Write-Host "[2/6] Pulling latest from origin/main..." -ForegroundColor Green
git pull origin main

# Step 3 -- stage + commit
Write-Host "[3/6] Staging changes..." -ForegroundColor Green
git add -A
$staged = git diff --cached --name-only
if (-not $staged) {
    Write-Host "  Nothing to commit -- repo already in sync with HEAD. Continuing to tag step." -ForegroundColor Yellow
} else {
    Write-Host "  Files staged:"
    $staged | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }

    $msg = @"
Release $VERSION -- Tenant Lockdown + Theme Polish + Custom CSS

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
- 33 JS files, all parse clean as ESM
"@
    Write-Host "[4/6] Committing..." -ForegroundColor Green
    git commit -m $msg
}

# Step 4 -- push commits
Write-Host "[5/6] Pushing to origin/main..." -ForegroundColor Green
git push origin main

# Step 5 -- tag + push the tag (idempotent: skip if tag already exists)
$existingTag = git tag -l $VERSION
if ($existingTag) {
    Write-Host "  Tag $VERSION already exists locally -- skipping creation." -ForegroundColor Yellow
} else {
    Write-Host "  Creating tag $VERSION..."
    git tag -a $VERSION -m $TITLE
}
Write-Host "  Pushing tag $VERSION to origin..."
git push origin $VERSION

# Step 6 -- try to create the GitHub release via gh CLI; fall back to web-UI instructions
Write-Host "[6/6] Creating GitHub release..." -ForegroundColor Green
$ghAvailable = $null -ne (Get-Command gh -ErrorAction SilentlyContinue)
if ($ghAvailable) {
    $notesFile = "RELEASE_NOTES_v3.11.0.md"
    if (-not (Test-Path $notesFile)) {
        Write-Host "  WARN: $notesFile not found, creating release with default body..." -ForegroundColor Yellow
        gh release create $VERSION --title $TITLE --latest
    } else {
        gh release create $VERSION --title $TITLE --notes-file $notesFile --latest
    }
    Write-Host ""
    Write-Host "[OK] Release published: https://github.com/dirtysouthalpha/sentinel-override/releases/tag/$VERSION" -ForegroundColor Green
    Write-Host ""

    # Optional: build + attach a clean ZIP
    $buildZip = Read-Host "Build + attach a release ZIP? (y/N)"
    if ($buildZip -eq "y" -or $buildZip -eq "Y") {
        $zipName = "sentinel-override-$VERSION.zip"
        if (Test-Path $zipName) { Remove-Item $zipName -Force }
        Write-Host "  Building $zipName (excluding .git, node_modules, internal docs)..."
        Compress-Archive -Path (Get-ChildItem -Force | Where-Object { $_.Name -notin @(".git", "node_modules", "release.ps1", "PUSH_AND_RELEASE.md", "RELEASE_NOTES_v3.11.0.md") }) -DestinationPath $zipName -CompressionLevel Optimal
        Write-Host "  Uploading $zipName to release..."
        gh release upload $VERSION $zipName
        Write-Host "[OK] ZIP attached." -ForegroundColor Green
    }
} else {
    Write-Host ""
    Write-Host "gh CLI not detected. Tag pushed; create the release via the web UI:" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  1. https://github.com/dirtysouthalpha/sentinel-override/releases/new"
    Write-Host "  2. Choose tag: $VERSION"
    Write-Host "  3. Release title: $TITLE"
    Write-Host "  4. Paste the contents of RELEASE_NOTES_v3.11.0.md into the description"
    Write-Host "  5. Check 'Set as the latest release'"
    Write-Host "  6. Click 'Publish release'"
    Write-Host ""
    Write-Host "Or install gh CLI from https://cli.github.com/ and re-run this script." -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Done." -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""
