// tests/client-pii-guard.test.js
// Guards against client-identifying data entering the repo (which is pushed to
// GitHub). The denylist is STORED AS SHA-256 HASHES so this file itself never
// contains the identifiers it blocks. Regenerate an entry with:
//   node -e "console.log(require('crypto').createHash('sha256').update('<term>'.toLowerCase()).digest('hex'))"
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SELF = fileURLToPath(import.meta.url);
const SCAN_DIRS = ['background', 'popup-modules', 'content'];

const DENYLIST_HASHES = new Set([
  '72eac870f2d2f22de508c0eef10765845290fac9132b0424af19a22ee7b37c76',
  '033219d7206bc15b80974531a986a9d7e8d7333112fe9d0efbb4b6c3dc77389d',
  'b39d53764adc261e193e59ac1c50bc6974c057a59657ef07f6d59ed5108f09f0',
  '0a721c1423d8f2739f30e2bb301b3931fd14476347c57b36ebd4acde213deacc',
  'fb7ea3efa14d707dde3d40cc3d95b7d29a31bdd63f9b8153958b43db5c5ed56b',
  'ff62385d1a95ba186a4ffe9f4e07cb521f4ad09c0fa5271239ba832b3a4fd903',
  '1823c30d3acfbcbdad8b38e03aab18737ef7a31770117377be019e994d0758e8',
  '71e42c60861a04ad162b881f994c55f9473568c07fa00f42105948ff76ecf94f',
  'f80118e2867a8dcbc0c70ce98abc9850f5ac5fdc7d684c577d84ea3c0e6e2676',
  '1ed3c5f3ae6658edd0ef80ca447009826dee2fda93b7196b7673e28a8a351a9d',
  '0ea2079b4931286677c949b4eaa30e5d3adcd9c1944d435b2db43ae1c846694f',
  '9ea6634c12b314dd8f804e0ba5fce63ed06b81550df299d34eda56f7debdd726',
  'c30c194aa47662487172101a4662903cfd7d37dfb4bedae184464e86cbf08c9e',
  'a8e10c933d2128957dae6a3aedf3da4fab21415e409f813dc68efa22badf30a3',
  'abd757da72bf5d3b0c6bd003e87565c6d7214d37c13f42ad71370e5f4d07736c',
]);

const h = (t) => crypto.createHash('sha256').update(t.toLowerCase()).digest('hex');
const TOKEN_RE = /[A-Za-z][A-Za-z0-9_-]{2,}/g;

function filesUnder(dir) {
  const out = [];
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return out;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const p = path.join(abs, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(path.join(dir, entry.name)));
    else if (/\.(js|json|md|html|css)$/.test(entry.name)) out.push(p);
  }
  return out;
}

// Known-safe matches (Chrome API, own product name, 555 test numbers, test fixtures)
const SAFE = /storage\.local|sentinel-override\.local|555|test@test\.com|example\.com|user@domain|localhost/i;

describe('client PII guard (repo stays clean for GitHub)', () => {
  test('no denylisted client-identifying token appears in shipped source', () => {
    const offenders = [];
    for (const dir of SCAN_DIRS) {
      for (const file of filesUnder(dir)) {
        const tokens = fs.readFileSync(file, 'utf8').toLowerCase().match(TOKEN_RE) || [];
        const seen = new Set();
        for (const tok of tokens) {
          if (seen.has(tok)) continue;
          seen.add(tok);
          if (DENYLIST_HASHES.has(h(tok))) {
            offenders.push(`${path.relative(ROOT, file)}: hashed token match`);
            break;
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test('no raw client emails/phones/.local domains in shipped source', () => {
    const offenders = [];
    const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
    const PHONE = /\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/;
    const LOCAL_DOM = /[A-Za-z0-9-]{2,}\.local\b/;
    for (const dir of SCAN_DIRS) {
      for (const file of filesUnder(dir)) {
        const src = fs.readFileSync(file, 'utf8');
        for (const re of [EMAIL, PHONE, LOCAL_DOM]) {
          const m = src.match(re);
          if (m && !SAFE.test(m[0])) {
            offenders.push(`${path.relative(ROOT, file)}: ${m[0].slice(0, 40)}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test('this guard file itself contains no plaintext denylisted term', () => {
    const own = fs.readFileSync(SELF, 'utf8').toLowerCase();
    for (const tok of own.match(TOKEN_RE) || []) {
      expect(DENYLIST_HASHES.has(h(tok))).toBe(false);
    }
  });
});
