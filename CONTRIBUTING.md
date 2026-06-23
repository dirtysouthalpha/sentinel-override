# Contributing to Sentinel Override

## Development Setup

1. Clone the repo
2. Run `npm install`
3. Load in Chrome: `chrome://extensions` -> Developer mode -> Load unpacked
4. Run tests: `npm test`

## Critical Rules for Chrome MV3

### No Bare npm Imports
Chrome MV3 service workers cannot resolve bare module specifiers. This will **crash the entire extension**:

```js
// BAD — will crash Chrome MV3 service worker
import { v4 } from 'uuid';
import _ from 'lodash';
```

```js
// GOOD — use native browser APIs
const uuidv4 = () => crypto.randomUUID();
```

The CI pipeline automatically scans for bare imports on every push.

### Test Before Push
```bash
npm test
```
All tests must pass. The CI gate will block merges with failing tests.

## Branch Naming

- `feat/` — New features (e.g. `feat/streaming-display`)
- `fix/` — Bug fixes (e.g. `fix/sw-crash`)
- `chore/` — Maintenance (e.g. `chore/bump-version`)
- `refactor/` — Code restructuring

## Commit Format

```
vXX.Y.Z: Short description of what changed
```

Examples:
```
v21.5.1: Replace bare uuid import with crypto.randomUUID()
v21.5.0: Streaming LLM token display + cross-origin iframe support
```

## Release Process

1. Bump version in `manifest.json` and `package.json`
2. Commit with version prefix: `vXX.Y.Z: description`
3. Tag: `git tag vXX.Y.Z && git push origin vXX.Y.Z`
4. The auto-release workflow builds the zip and creates the GitHub release

## Architecture Overview

| Directory | Purpose |
|-----------|---------|
| `background/` | Service worker — agent engine, LLM client, tab management |
| `content/` | Content scripts injected into pages |
| `popup-modules/` | UI modules for the side panel |
| `tests/` | Jest test suites (ESM, 228 suites, 10,232+ tests) |
| `platforms/` | Platform-specific profiles (Teams Admin, M365, etc.) |

## Provider Compatibility

The extension supports multiple LLM providers. Code must be model-agnostic:
- Vision parsing must handle GLM-4V, DeepSeek, Claude edge cases
- Retry backoff must be provider-aware
- Streaming accumulators support OpenAI-compatible + Anthropic formats
