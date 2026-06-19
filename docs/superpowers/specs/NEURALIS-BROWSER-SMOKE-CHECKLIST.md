# Neuralis Integration — Human Browser-Smoke Checklist

> This checklist is the gate to merge `feat/neuralis-brain-integration`. A code
> session **cannot** run it — it requires loading the unpacked extension in a
> real Chrome and eyeballing a real run. **Do not let an agent mark it passed.**
>
> When a human has completed every section and pasted results below, the next
> session marks the draft PR ready-for-review and merges.

Human reviewer: ____________________   Date: __________

Result per section (circle): 0. Setup  PASS / FAIL   1. READ  PASS / FAIL
2. WRITE  PASS / FAIL   3. FAIL-OPEN  PASS / FAIL   4. REDACTION  PASS / FAIL

---

## Prerequisites

- The `feat/neuralis-brain-integration` branch is checked out and `npm test`
  passes locally (baseline: 215 suites, 9829+ tests).
- Neuralis is running and reachable from the browser's network:
  `curl http://localhost:8000/brain/stats` responds with JSON.
  (If Neuralis runs in WSL2 while Chrome runs on the Windows host, you will
  need to set the **Brain base URL** to the WSL eth0 IP, e.g.
  `http://172.22.82.67:8000` — see `docs/NEURALIS-INTEGRATION.md`.)

---

## 0. Load the extension

1. Open `chrome://extensions`.
2. Toggle **Developer mode** ON (top-right).
3. Click **Load unpacked** and select this repo's root directory
   (`C:\Users\brandon.goolsby\Downloads\sentinel-override`).
4. Confirm the Sentinel Override extension appears and is enabled.
5. Click the extension icon → **Settings**.

**Pass criteria:** extension loads with no errors in `chrome://extensions`.
**Paste:** any errors shown on the extension card (should be none).

---

## 1. Enable both toggles (and check the consent dialog)

In **Settings**:

1. Find **🧠 Neuralis Brain (experimental)** and check the box
   (`brainEnabled`). No dialog expected for the READ toggle.
2. In the **Brain base URL** field, confirm/enter the address the browser can
   reach Neuralis at (default `http://localhost:8000`). Click out of the field
   to save — expect a toast "Brain base URL saved".
3. Find **🧠 Neuralis Brain Producer (experimental, write)** and check the box.
   **A confirmation dialog MUST appear** with this **exact** text:

   > This will send redacted, platform-level operating notes to your Neuralis
   > brain. No client names, tenants, emails, or IPs are sent. Continue?

4. Click **OK** (confirm). Expect a success toast.
5. To test the decline path (optional): uncheck, re-check, and click **Cancel**
   on the dialog — the toggle should revert to OFF and no write should occur.

**Pass criteria:** READ toggle on with no dialog; WRITE toggle shows the exact
confirmation text; declining reverts the toggle.
**Paste:** the exact dialog text you saw (must match above).

---

## 2. READ test — `## BRAIN KNOWLEDGE` section renders

1. Navigate to a **known platform page** the brain has data for (e.g. an M365
   admin page at `admin.microsoft.com`, or any page that maps to a platform id
   the brain knows — `premier` is well-populated for testing).
2. Confirm the brain has data for that platform:
   `curl "http://localhost:8000/recall?context=<platform-id>"` returns
   non-empty `direct`/`associated`.
3. Open the Sentinel Override side panel, enter a goal, and start a run.
4. In the run log / devtools console, look for the **`## BRAIN KNOWLEDGE
   (shared, cross-installation)`** section being injected into the prompt.

**Pass criteria:** the `## BRAIN KNOWLEDGE` section appears in the prompt with
`[src:<source>]` tags on each line.
**Paste:** the rendered section (or the console line showing it was injected).

---

## 3. WRITE test — `source:"sentinel-override"` neuron appears

1. With `brainProducerEnabled` ON (and confirmed), run a goal that **triggers a
   self-heal** — i.e. an action that fails first, then the agent recovers via
   a retry/fallback strategy. (Easiest: pick a flaky UI element on the platform
   page; the agent's runtime profiler will attempt a heal.)
2. Let the run **finish** (the producer only ships at run end).
3. Check the brain for the new neuron:
   ```bash
   curl "http://localhost:8000/neurons/search?q=sentinel-override"
   ```
4. Confirm a neuron with `[sentinel-override]` provenance appears, and that its
   `content` is the redacted self-heal note (e.g.
   "After N failed attempt(s), recovery strategy ... succeeded").

**Pass criteria:** a new `source:"sentinel-override"` neuron exists in the brain
after the run, with NO client-identifying data in its content.
**Paste:** the neuron's content + source from the search result.

---

## 4. FAIL-OPEN test — brain down, run still completes

1. **Stop Neuralis** (e.g. kill the uvicorn process, or `docker stop` whatever
   serves :8000).
2. Confirm it's down: `curl http://localhost:8000/brain/stats` fails.
3. With **both toggles ON**, start a run.
4. Confirm the run **still completes** (no crash, the agent keeps working).
5. In the service-worker devtools console, confirm you see **exactly one**
   `[Sentinel/Brain] Brain UNREACHABLE at recall time ...` warning for the run
   — NOT repeated per step, NOT spammed. There may also be one
   `[Sentinel/BrainProducer] Brain UNREACHABLE at run end ...` at finish.
6. Restart Neuralis.

**Pass criteria:** run completes with no crash; exactly one read-path
"UNREACHABLE" warn per run (not per recall); write path warns once at end.
**Paste:** the console warning line(s) and a note that the run finished.

---

## 5. REDACTION test — the trust-critical check (DO NOT SKIP)

This is the most important test: prove client-identifying data can NEVER reach
the shared brain.

1. Keep `brainProducerEnabled` ON.
2. Deliberately run a goal whose agent **notes** would naturally contain a
   client name (e.g. a goal on a page tied to a known client whose
   `displayName` is in `chrome.storage.local` under client knowledge). The
   easiest way: set up a client in Client Knowledge with a distinctive name,
   then run a goal where the agent emits a `note` action mentioning that name.
3. Let the run finish.
4. The producer's denylist should **DROP** that candidate (the client name
   survives the PII scrub because it's unquoted, so the client-entity denylist
   must catch it). Confirm via the service-worker console that no neuron with
   the client name was shipped, OR check the brain directly:
   ```bash
   curl "http://localhost:8000/neurons/search?q=<the-client-name>"
   ```
   — it should return **zero** results whose content contains the client name.
5. Cross-check: a clean (non-client-identifying) note from the same run SHOULD
   have shipped (so you know the producer ran and the gate, not a crash,
   dropped the bad candidate).

**Pass criteria:** NO neuron in the brain contains the client name; at least
one clean note from the run DID ship (proving the gate dropped the leak, not a
silent producer failure).
**Paste:** the search result count for the client name (must be 0), and a
clean neuron from the same run (proving the producer ran).

---

## Sign-off

All five sections PASS (Setup / READ / WRITE / FAIL-OPEN / REDACTION):

- [ ] 0. Setup
- [ ] 1. READ
- [ ] 2. WRITE
- [ ] 3. FAIL-OPEN
- [ ] 4. REDACTION

Reviewer signature: ____________________   Date: __________

Paste the evidence blocks above, then hand off. The next session marks the
draft PR `ready-for-review` and merges.
