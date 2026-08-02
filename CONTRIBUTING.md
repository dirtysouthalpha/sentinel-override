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
| `tests/` | Jest test suites (ESM, 242 suites, 10,400+ tests) |
| `background/platforms/` | Platform profiles — 21 of them; `index.js` is generated, see below |

## Contributing a Platform Profile

A platform profile teaches the agent one web application: how to recognise it, what
its pages are, and how its workflows actually run. They live in
`background/platforms/`, and adding one is the most useful contribution you can make
without touching the engine.

Create `background/platforms/<your_platform>.js` exporting a single object:

```js
export const yourPlatform = {
  priority: 175,             // match order — see below
  id: 'your_platform',       // unique, snake_case, matches the filename
  label: 'Your Platform',    // shown in the UI
  memoryKeyPrefix: 'yp_',    // namespaces anything the agent saves to memory

  detect(url, goal) { /* return true when this profile should handle the page */ },

  pageTypes: [ { name, urlMatch: /re/, hint: 'what this screen is' } ],
  workflowHints: [ { match: /re/, hint: 'Phase 1: ... Phase 2: ...' } ],
  knownGotchas: [ 'things that mislead an agent on this platform' ],
  commitFlow: 'how an edit is actually saved',
};
```

Then regenerate the registry and run the tests:

```
node scripts/generate-platform-registry.cjs
npm test
```

**Do not edit `background/platforms/index.js` or
`popup-modules/platform-profiles.generated.js`** — both are generated, and CI fails if
either does not match the profiles on disk. There are two outputs because the popup
loads classic scripts and cannot import the registry, so the generator emits a plain
`window.SENTINEL_PLATFORM_PROFILES` list for the settings dropdown. Regenerating keeps
them in step; a test asserts they agree.

Your profile appears in Settings → Platform Profile automatically once regenerated.
That dropdown pins detection to one profile, which is how a user works around a
white-labelled or on-prem portal your `detect()` cannot recognise.

### Priority

`getPlatformProfile()` returns the **first** profile whose `detect()` returns true, and
`priority` decides that order (lower matches first). Existing profiles are spaced by 10
so a new one can slot between two without renumbering. A profile that detects on a
specific hostname can sit anywhere; one that detects on goal keywords must sit after
everything it could otherwise shadow. `network_device` is a deliberate catch-all pinned
last at 9999 — nothing may sort after it.

### What makes a profile good

`detect()` must be tight. Match the real hostname, not a substring — `example.com`
containing your product's name is not your product, and neither is
`yourplatform.com.evil.test`. Anchor host regexes with `(^|\.)yourhost\.com$`.

`workflowHints` earn their place by encoding what an agent gets *wrong*: which button
actually commits, which field must be set first because it filters the others, whether
a "reply" emails the customer. A hint that only restates the page title is noise.

Third-party profiles cannot be loaded into a published build at runtime — Chrome MV3
has no filesystem to enumerate, and shipping remote code would breach Chrome Web Store
policy. Contribute profiles by pull request so they ship in the package.

## Provider Compatibility

The extension supports multiple LLM providers. Code must be model-agnostic:
- Vision parsing must handle GLM-4V, DeepSeek, Claude edge cases
- Retry backoff must be provider-aware
- Streaming accumulators support OpenAI-compatible + Anthropic formats
