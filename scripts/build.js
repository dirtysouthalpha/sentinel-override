#!/usr/bin/env node
// Sentinel Override — Build Script
// Creates a production-ready .zip for Chrome Web Store.
// Strips console.log/console.warn from JS files (keeps console.error for runtime diagnostics).
// Removes TEMP/HACK/DEBUG comments and dead diagnostic code.
/* global process */

import { createWriteStream, readdirSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve, extname } from 'path';
import { createRequire } from 'module';
import { mkdir, mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';

const require = createRequire(import.meta.url);
const archiver = require('archiver');

import { fileURLToPath } from 'url';
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '..');
const DIST = join(ROOT, 'dist');

// Determine version from manifest.json
const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf-8'));
const version = manifest.version || '0.0.0';
const zipName = `sentinel-override-v${version}.zip`;
const zipPath = join(DIST, zipName);

// Directories to include (recursively)
const includeDirs = ['background', 'content', 'popup-modules', 'lib', 'fonts'];

// Individual files to include
const includeFiles = [
  'manifest.json',
  'popup.html',
  'popup-full.js',
  'popup.css',
  'report-view.html',
  'report-print.html',
  'icon.svg',
  'icon-16.png',
  'icon-32.png',
  'icon-48.png',
  'icon-128.png',
  'icon-256.png',
];

// Patterns to exclude within included dirs
const excludeDirs = new Set(['tests', 'node_modules', 'coverage', 'docs', '.git', 'dist', '__pycache__', 'web']);
const excludeSuffixes = ['.test.js', '.spec.js', '.map'];

function shouldExclude(relPath) {
  const parts = relPath.split(/[/\\]/);
  if (parts.some(p => excludeDirs.has(p))) return true;
  return parts.some(p => excludeSuffixes.some(s => p.endsWith(s)));
}

function collectFiles(dir, base) {
  const results = [];
  if (!existsSync(dir)) return results;

  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    const relPath = base ? join(base, entry.name) : entry.name;

    if (shouldExclude(relPath)) continue;

    if (entry.isDirectory()) {
      results.push(...collectFiles(fullPath, relPath));
    } else {
      results.push({ fullPath, relPath });
    }
  }
  return results;
}

// ========== Production Transform ==========
// Strips debug noise from JS files for production builds:
//   - Removes console.log() and console.warn() calls (keeps console.error)
//   - Removes lines that are only TEMP DIAGNOSTIC comments
//   - Collapses multiple blank lines left by removals
//
// This is intentionally regex-based — no AST dependency needed for a Chrome extension.

const CONSOLE_LOG_RE = /^\s*console\.log\([^;]*\);?\s*$/gm;
const CONSOLE_WARN_RE = /^\s*console\.warn\([^;]*\);?\s*$/gm;
const TEMP_DIAG_COMMENT_RE = /^\s*\/\/\s*(TEMP|HACK|DEBUG|DIAGNOSTIC)[^\n]*$/gim;
const MULTI_BLANK_RE = /\n{3,}/g;

function transformJs(source) {
  let out = source;
  // Strip console.log lines (whole-line only — won't break inline usage)
  out = out.replace(CONSOLE_LOG_RE, '');
  // Strip console.warn lines
  out = out.replace(CONSOLE_WARN_RE, '');
  // Strip TEMP/HACK/DEBUG comment lines
  out = out.replace(TEMP_DIAG_COMMENT_RE, '');
  // Collapse excessive blank lines from removals
  out = out.replace(MULTI_BLANK_RE, '\n\n');
  return out;
}

async function build() {
  console.log(`\n📦 Building Sentinel Override v${version}...`);

  const files = [];

  // Collect from directories
  for (const dir of includeDirs) {
    files.push(...collectFiles(join(ROOT, dir), dir));
  }

  // Collect individual files
  for (const file of includeFiles) {
    const fullPath = join(ROOT, file);
    if (existsSync(fullPath)) {
      files.push({ fullPath, relPath: file });
    } else {
      console.warn(`   ⚠️  ${file} not found, skipping`);
    }
  }

  console.log(`   Found ${files.length} files to package`);

  // Create temp dir for transformed JS files
  const tmpDir = await mkdtemp(join(tmpdir(), 'sentinel-build-'));
  let transformedCount = 0;
  let savedBytes = 0;

  // Transform JS files and replace fullPath with temp copy
  const processedFiles = files.map(f => {
    if (extname(f.relPath) === '.js') {
      const source = readFileSync(f.fullPath, 'utf-8');
      const transformed = transformJs(source);
      const diff = source.length - transformed.length;
      if (diff > 0) {
        const tmpPath = join(tmpDir, f.relPath.replace(/[/\\]/g, '_'));
        writeFileSync(tmpPath, transformed, 'utf-8');
        transformedCount++;
        savedBytes += diff;
        return { ...f, fullPath: tmpPath };
      }
    }
    return f;
  });

  if (transformedCount > 0) {
    const saved = savedBytes > 1024 ? `${(savedBytes / 1024).toFixed(1)} KB` : `${savedBytes} B`;
    console.log(`   🧹 Stripped debug from ${transformedCount} JS files (saved ${saved})`);
  }

  // Create dist directory
  if (!existsSync(DIST)) {
    await mkdir(DIST, { recursive: true });
  }

  return new Promise((resolve, reject) => {
    const output = createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
      const bytes = archive.pointer();
      const size = bytes > 1024 * 1024
        ? `${(bytes / (1024 * 1024)).toFixed(2)} MB`
        : `${(bytes / 1024).toFixed(1)} KB`;
      console.log(`   ✅ ${zipName} created (${size}, ${processedFiles.length} files)`);
      console.log(`   Path: ${zipPath}\n`);

      // Cleanup temp dir
      try { const { rmSync } = require('fs'); rmSync(tmpDir, { recursive: true, force: true }); } catch (_e) { /* non-fatal */ }

      resolve();
    });

    archive.on('error', reject);
    archive.pipe(output);

    for (const file of processedFiles) {
      archive.file(file.fullPath, { name: file.relPath });
    }

    archive.finalize();
  });
}

build().catch(err => {
  console.error('   ❌ Build failed:', (typeof err === 'object' && err !== null && typeof err.message === 'string') ? err.message : String(err));
  process.exit(1);
});
