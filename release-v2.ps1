# Sentinel Override -- v3.11.0 CLEAN RECOVERY release script
#
# This bypasses the rogue .git folder in C:\Users\Administrator\ by cloning
# the real GitHub repo into C:\sentinel-override-release (outside the home
# folder, so git can't walk up and find the wrong .git), then copying the
# v3.11.0 files in and pushing.
#
# USAGE:
#   .\release-v2.ps1

$ErrorActionPreference = "Stop"
$VERSION   = "v3.11.0"
$TITLE     = "v3.11.0 -- Tenant Lockdown + Theme Polish + Custom CSS"
$REPO_URL  = "https://github.com/dirtysouthalpha/sentinel-override.git"
$SRC       = "C:\Users\Administrator\Downloads\sentinel-override-v3.4.0"
$DST       = "C:\sentinel-override-release"

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Sentinel Override $VERSION -- Clean Recovery Release" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# Move cwd OUT of the home folder before doing anything, so git cannot
# accidentally pick up the rogue .git in C:\Users\Administrator\
Set-Location C:\

# Step 0 -- verify source has manifest.json
if (-not (Test-Path "$SRC\manifest.json")) {
    Write-Host "ERROR: $SRC does not contain manifest.json. Aborting." -ForegroundColor Red
    exit 1
}

# Step 1 -- wipe destination if it exists from a prior run
if (Test-Path $DST) {
    Write-Host "[1/8] Removing existing $DST..." -ForegroundColor Green
    Remove-Item -Path $DST -Recurse -Force
}

# Step 2 -- clone the real GitHub repo into the clean destination
Write-Host "[2/8] Cloning $REPO_URL into $DST..." -ForegroundColor Green
git clone $REPO_URL $DST
if (-not (Test-Path "$DST\.git")) {
    Write-Host "ERROR: git clone failed. Check your auth and network." -ForegroundColor Red
    exit 1
}

# Step 3 -- enter the clean clone and figure out which branch to push to
Set-Location $DST
$defaultBranch = (git symbolic-ref refs/remotes/origin/HEAD --short 2>$null)
if ($defaultBranch) {
    $defaultBranch = $defaultBranch -replace "^origin/", ""
} else {
    $defaultBranch = "main"
}
Write-Host "[3/8] Default branch: $defaultBranch" -ForegroundColor Green
# git clone already checks out the default branch, so no explicit checkout needed.

# Step 4 -- wipe the existing working tree (preserve .git)
Write-Host "[4/8] Wiping existing files (preserving .git)..." -ForegroundColor Green
Get-ChildItem -Force -Path $DST -Exclude ".git" | Remove-Item -Recurse -Force

# Step 5 -- copy the v3.11.0 files from the source folder, excluding any .git
Write-Host "[5/8] Copying v3.11.0 files from $SRC..." -ForegroundColor Green
robocopy $SRC $DST /E /XD ".git" /NFL /NDL /NJH /NJS /NC /NS /NP | Out-Null
# robocopy uses non-zero exit codes for normal success (1-7 = success with notes,
# 8+ = failure). Reset $LASTEXITCODE so it doesn't trip $ErrorActionPreference.
if ($LASTEXITCODE -ge 8) {
    Write-Host "ERROR: robocopy failed with exit code $LASTEXITCODE" -ForegroundColor Red
    exit 1
}
$global:LASTEXITCODE = 0

# Step 6 -- verify screenshots are present
$shots = @(
    "docs\screenshots\01-overview.png",
    "docs\screenshots\02-command-palette.png",
    "docs\screenshots\03-theme-customizer.png"
)
$missing = @()
foreach ($s in $shots) {
    if (-not (Test-Path $s)) { $missing += $s }
}
if ($missing.Count -gt 0) {
    Write-Host ""
    Write-Host "MISSING SCREENSHOTS:" -ForegroundColor Yellow
    foreach ($m in $missing) { Write-Host "  - $m" -ForegroundColor Yellow }
    Write-Host ""
    $continue = Read-Host "Continue without screenshots? (y/N)"
    if ($continue -ne "y" -and $continue -ne "Y") {
        Write-Host "Stopped. Add screenshots to $SRC\docs\screenshots\ and re-run." -ForegroundColor Yellow
        exit 0
    }
}

# Step 7 -- stage + commit + push
Write-Host "[6/8] Staging changes..." -ForegroundColor Green
git add -A
$staged = git diff --cached --name-only
if (-not $staged) {
    Write-Host "  Nothing to commit -- working tree matches HEAD." -ForegroundColor Yellow
} else {
    Write-Host "  $(($staged | Measure-Object).Count) files staged."
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
    Write-Host "[7/8] Committing + pushing to origin/$defaultBranch..." -ForegroundColor Green
    git commit -m $msg
    git push origin $defaultBranch
}

# Step 8 -- tag + push tag (idempotent)
$existingTag = git tag -l $VERSION
if ($existingTag) {
    Write-Host "  Tag $VERSION already exists locally -- skipping creation." -ForegroundColor Yellow
} else {
    Write-Host "  Creating tag $VERSION..."
    git tag -a $VERSION -m $TITLE
}
Write-Host "  Pushing tag $VERSION to origin..."
git push origin $VERSION

# Step 9 -- create the GitHub release via gh CLI; fall back to web-UI instructions
Write-Host "[8/8] Creating GitHub release..." -ForegroundColor Green
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

    $buildZip = Read-Host "Build + attach a release ZIP? (y/N)"
    if ($buildZip -eq "y" -or $buildZip -eq "Y") {
        $zipName = "sentinel-override-$VERSION.zip"
        if (Test-Path $zipName) { Remove-Item $zipName -Force }
        Write-Host "  Building $zipName (excluding .git, internal docs)..."
        Compress-Archive -Path (Get-ChildItem -Force | Where-Object { $_.Name -notin @(".git", "release.ps1", "release-v2.ps1", "PUSH_AND_RELEASE.md", "RELEASE_NOTES_v3.11.0.md") }) -DestinationPath $zipName -CompressionLevel Optimal
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
Write-Host "  Done. Clean clone is at: $DST" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""
