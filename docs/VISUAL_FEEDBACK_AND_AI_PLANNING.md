# Sentinel Override — AI Planning & Visual Feedback
**Date:** 2026-05-08
**Brandon — short answer to your two requirements**

---

## 1. AI-driven planning from any prompt — already wired up

The runbook templates I sketched in `MSP_TASK_PLAYBOOKS_2026-05-08.md` are **shortcuts**, not requirements. The agent already plans freeform from any goal. Here's the path it takes today:

- `background/agent-engine.js:355` — every run calls `generatePlan(goal, ...)` first.
- `background/llm-client.js:277-376` — `generatePlan` sends the goal + current URL + page title + platform context to the LLM and asks for a 1-15 step JSON plan.
- The plan is shown in the popup ("📋 Plan ready (12 steps): ..."), executed step by step at `agent-engine.js:373-1308`.
- If plan generation fails (API down, bad JSON), `generateHeuristicPlan()` at `agent-engine.js:234-303` fabricates a basic plan from goal-text analysis.
- After the plan is generated, every per-step decision goes back to the LLM — `callLLMWithRetry` at `agent-engine.js:680` — with the current page state, history, and screenshot.

So when you push *"Add a VPN tunnel from acme to beta on the SonicWall at 1.2.3.4 with PSK foobar"* from your chatbot, the agent:

1. Plans 10-15 steps via the LLM.
2. For each step, re-observes the page, sends DOM + screenshot to the LLM, gets the next action, executes it, repeats.
3. Self-heals (strategy shift) after 3 consecutive failures (`agent-engine.js:442`).
4. Stops when the LLM returns `finish` with a summary.

**You don't need templates** to make any task work. Templates would just save tokens and reduce variance for the most-common workflows. Treat them as caching.

The platform-context blocks for SonicWall, ConnectWise, NinjaOne, etc. (`llm-client.js:16-222`) are also "hints injected at plan time" — they don't restrict what the agent can do, they just give the LLM better defaults for common UIs.

**Bottom line: any prompt → AI plan → AI-driven step-by-step execution. No template required.**

What I would add to make this stronger is the platform context for `admin.microsoft.com`, `admin.exchange.microsoft.com`, `entra.microsoft.com`, and `portal.azure.com` (currently missing — they fall through to no platform-specific guidance). That's a 30-line addition to `llm-client.js`, no architecture change.

---

## 2. Visual feedback — what's there and what's missing

You want to *see* clicks and typing as they happen, like Claude in Chrome. Here's the current state plus the specific changes that close the gap.

### What exists today

- **Action banner** (top-right, dark monospace card) — `content/index.js:387-426`. Shows "Sentinel: clicking 'Save'" / "⌨ Typing: 'admin@acme.com' (8/12)".
- **Click pulse** — `content/index.js:445-456`. 24×24 red ring that pulses outward from the click point, 700ms animation.
- **Element highlight** — `content/highlight.js`. Orange 3px outline + glow, injected via CSS class so it never corrupts page styles. Stays visible 500ms after the action so you can see what was clicked.
- **Typing animation** — `content/index.js:946-964`. On the synthetic path, types character-by-character with adaptive delays (35-110ms per char for short strings, fast-typing for long URLs).
- **Popup action cards** — `popup-modules/chat.js`. Each step gets its own card in chat with an expand/collapse arrow, step number, action type, log lines, and a result badge.

That's already most of what Claude in Chrome shows — but **only on the synthetic-events path**. The reliable CDP path (the one that gets through reCAPTCHA, M365 sign-in, banking) bypasses the content script entirely, so **none of the visual feedback fires for trusted-input clicks/typing**. That's the headline gap.

### Gaps to close (in priority order)

#### G1. CDP clicks have no visual feedback
**Where:** `background/tab-manager.js:162-176` `cdpDispatchClick` dispatches `Input.dispatchMouseEvent` directly. The content script never hears about it, so no banner, no highlight, no pulse.

**Fix:** Two messages from background to content script wrapped around the CDP call:
```js
// In cdpDispatchClick, before chrome.debugger.sendCommand:
try {
  await chrome.tabs.sendMessage(tabId, {
    action: 'cdp_pre_click_visual', x, y
  });
} catch (e) {}
// ...then the CDP commands...
// Optional: post-click cleanup message (not strictly needed, the highlight self-clears)
```
And in `content/index.js` handleMessage:
```js
case 'cdp_pre_click_visual': {
  const el = document.elementFromPoint(request.x, request.y);
  if (el) {
    if (window.__sentinelUtils.highlight) {
      window.__sentinelUtils.highlight.highlightElement(el);
      setTimeout(() => window.__sentinelUtils.highlight.removeHighlight(el), 1500);
    }
  }
  if (window.__sentinelOverlay) {
    window.__sentinelOverlay.showActionBanner('click', `Clicking at (${request.x}, ${request.y})`);
    window.__sentinelOverlay.showClickIndicator(request.x, request.y);
  }
  return { ok: true };
}
```
Result: when CDP trusted clicks fire, you see the orange highlight + red pulse + banner identical to synthetic clicks.

#### G2. CDP typing fills the field instantly
**Where:** `background/tab-manager.js:256-281` `cdpDispatchType` uses `Input.insertText` which dumps the entire string in one CDP call. No animation, no banner.

**Fix:** Default `perCharKeyEvents: true` for strings ≤ 30 chars (most form inputs); use the fast `insertText` path for long strings (URLs, pasted blocks). Also stream banner updates from background:
```js
// Strings ≤ 30 chars: per-char dispatch with banner update each char
if (text.length <= 30 || options.perCharKeyEvents) {
  for (let i = 0; i < text.length; i++) {
    // Send banner-update message every 5 chars
    if (i % 5 === 0) {
      try {
        await chrome.tabs.sendMessage(tabId, {
          action: 'cdp_typing_progress',
          text, position: i + 1
        });
      } catch (e) {}
    }
    // ... existing per-char keyDown/keyUp ...
    await sleep(40 + Math.floor(Math.random() * 50)); // human-ish typing pace
  }
}
```
Add to `content/index.js`:
```js
case 'cdp_typing_progress': {
  if (window.__sentinelOverlay) {
    showTypingBanner(request.text, request.position, request.text.length);
  }
  return { ok: true };
}
```

#### G3. No virtual cursor that moves to the target before clicking
This is the part of Claude in Chrome that *feels* the most like a real operator: a small cursor glides to the button, then the click pulses. Sentinel jumps straight to the pulse with no travel.

**Fix:** Add a persistent SVG cursor element to every page (one-time inject by content script). Before any click — synthetic or CDP — animate it from its last position to the target's `bbox` center over 250-400ms with `cubic-bezier(0.4, 0.0, 0.2, 1)` easing. Then fire the existing click pulse on top of it.

```js
// content/cursor.js (new file, ~80 lines)
window.__sentinelCursor = window.__sentinelCursor || (function() {
  const CURSOR_ID = '__sentinel_cursor__';
  let lastX = window.innerWidth / 2;
  let lastY = window.innerHeight / 2;

  function ensure() {
    let c = document.getElementById(CURSOR_ID);
    if (c) return c;
    c = document.createElement('div');
    c.id = CURSOR_ID;
    c.style.cssText = `
      position: fixed; z-index: 2147483645; pointer-events: none;
      width: 20px; height: 20px;
      background: radial-gradient(circle, rgba(255,107,0,0.9) 30%, transparent 70%);
      border: 2px solid #ff6b00;
      border-radius: 50%;
      left: ${lastX}px; top: ${lastY}px;
      transform: translate(-50%, -50%);
      transition: left 350ms cubic-bezier(0.4, 0, 0.2, 1),
                  top 350ms cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow: 0 0 12px rgba(255,107,0,0.5);
    `;
    document.body.appendChild(c);
    return c;
  }

  return {
    moveTo(x, y) {
      const c = ensure();
      c.style.left = x + 'px';
      c.style.top = y + 'px';
      lastX = x; lastY = y;
      return new Promise(r => setTimeout(r, 380));
    },
    show() { ensure().style.opacity = '1'; },
    hide() { const c = document.getElementById(CURSOR_ID); if (c) c.style.opacity = '0'; }
  };
})();
```
Add a manifest content_script entry to load it everywhere.
Hook into both click paths: before any click action, call `await window.__sentinelCursor.moveTo(x, y)`, then proceed with mousedown/up + click pulse.

#### G4. Banner is functional but a bit raw
Current banner uses `font-family: monospace`, dark blue background, very developer-y. Easy polish:
- Switch font to `Inter, system-ui, sans-serif` (matches the popup).
- Add a small icon per action type (cursor for click, keyboard for type, magnifier for read_page, etc.).
- Slow the fade-out so you can finish reading.
- Position: keep top-right but add a tiny "step N/M" badge.

This is 30 minutes of CSS + some inline SVG.

#### G5. Pre-action "about to" announcement
Right now the banner shows the action *during* execution. For the watching-the-agent feel, announce ~300ms before:
- "About to click: Save" → 300ms pause → cursor moves to target → click pulses → result updates banner.

This is a 4-line change to the existing flow in each action handler — set the banner text, await `humanDelay(250, 450)`, *then* run the existing visual + dispatch sequence.

#### G6. Approval card lacks a target-element preview
When approval mode is on (recommended), the card shows action type + truncated description. For clicks, it could include a *small screenshot region around the bbox* so you can see what's about to be clicked before you approve. This is high-trust UX.

CDP can already capture screenshots; we just crop to the bbox + 20px padding and embed as a base64 image in the approval card. That alone makes the agent feel substantially more transparent than Claude in Chrome's text-only approval.

---

## What I'd implement next, in order

These are all small, isolated changes — none touch the planning architecture:

1. **G1 (CDP click visuals)** — biggest visual win, smallest diff. Ten lines added across `tab-manager.js` and `content/index.js`.
2. **G2 (CDP typing animation)** — default per-char for short strings + banner streaming.
3. **G5 (pre-action announcement)** — 4-line tweak to each action handler.
4. **G3 (virtual cursor)** — new ~80-line `content/cursor.js`, one manifest entry, hooks in click handlers.
5. **G4 (banner polish)** — CSS + icons.
6. **G6 (bbox screenshot in approval card)** — cropped image embed.
7. **M365 platform context blocks** added to `llm-client.js` — purely for AI planning quality, not visuals.

After 1–4, the watching-the-agent experience is at parity with Claude in Chrome on visible activity, and the AI-driven planning side keeps working for any freeform prompt with no templates required.

If you want me to actually write the code for these — say which ones and I'll patch them in directly.
