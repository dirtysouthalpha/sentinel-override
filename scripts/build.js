#!/usr/bin/env node
// Sentinel Override — Build Script
// Creates a clean .zip for Chrome Web Store sideload.
/* global process */

import { createWriteStream, readdirSync, existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { createRequire } from 'module';
import { mkdir } from 'fs/promises';

const require = createRequire(import.meta.url);
const archiver = require('archiver');

const ROOT = resolve(new URL('..', import.meta.url).pathname.replace(/\/$/, ''));
const DIST = join(ROOT, 'dist');

// Determine version from manifest.json
const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf-8'));
const version = manifest.version || '0.0.0';
const zipName = `sentinel-override-v${version}.zip`;
const zipPath = join(DIST, zipName);

// Directories to include (recursively)
const includeDirs = ['background', 'content', 'popup-modules'];

// Individual files to include
const includeFiles = [
  'manifest.json',
  'popup.html',
  'popup-full.js',
  'popup.css',
  'report-view.html',
  'report-print.html',
  'marked.min.js',
  'icon.svg',
  'icon-16.png',
  'icon-32.png',
  'icon-48.png',
  'icon-128.png',
  'icon-256.png',
];

// Patterns to exclude within included dirs
const excludeDirs = new Set(['tests', 'node_modules', 'coverage', 'docs', '.git', 'dist', '__pycache__']);
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
      console.log(`   ✅ ${zipName} created (${size}, ${files.length} files)`);
      console.log(`   Path: ${zipPath}\n`);
      resolve();
    });

    archive.on('error', reject);
    archive.pipe(output);

    for (const file of files) {
      archive.file(file.fullPath, { name: file.relPath });
    }

    archive.finalize();
  });
}

build().catch(err => {
  console.error('   ❌ Build failed:', (typeof err === 'object' && err !== null && typeof err.message === 'string') ? err.message : String(err));
  process.exit(1);
});
