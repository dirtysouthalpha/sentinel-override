# Agent Zero Autonomous Coding Loops

## Overview
Forward Future loop patterns adapted for Agent Zero. These loops enforce structured, safe, and verifiable autonomous coding.

## Anti-Pattern Detection (ALWAYS enforce)
- Never write code without a spec or plan
- Never self-approve production code
- Never skip verification phases
- Never assume stopping condition — verify it explicitly
- Never exceed 5 iterations without explicit checkpoint

## Loop Selection Matrix

| Task Type | Primary Loop | Secondary Loop |
|-----------|-------------|----------------|
| Bug fix | #016 Ticket-to-PR | #034 Multi-LLM |
| Feature | #035 Goal Forge → #020 Loop Harness | #027 Autonomy |
| Refactor | #020 Loop Harness | #016 Ticket-to-PR |
| Critical fix | #034 Multi-LLM Convergence | #016 Ticket-to-PR |
| Exploratory | #035 Goal Forge | (stop after spec) |
| Multi-file change | #027 Autonomy Loop | #020 Loop Harness |

## Loop #035 — Goal Forge (Mandatory First Step for ALL tasks)

### Phase 1: FORGE (must complete before any code)
1. Read existing codebase — understand current state
2. Write SPEC.md: what to build, what to exclude, measurable done criteria
3. Write PLAN.md: ordered tasks with acceptance criteria per task
4. Stop and wait for approval OR proceed if confidence >= 80%

### Phase 2: BUILD (after spec approved)
- Execute tasks from PLAN.md in order
- Run tests after each task
- Mark tasks complete only when acceptance criteria met

### Phase 3: VERIFY (after build)
- Run full test suite
- Verify all acceptance criteria from SPEC.md
- Check for regressions

### Stopping Condition
- All PLAN.md tasks marked complete AND all SPEC.md criteria verified AND tests pass

---

## Loop #016 — Ticket-to-PR-Ready

### Phase 1: REPRODUCE
- Write a failing test that reproduces the bug
- Verify test fails on main branch

### Phase 2: ROOT CAUSE
- Identify the exact line(s) causing the bug
- Document root cause in comments

### Phase 3: FIX
- Minimal fix — change only what is necessary
- Verify failing test now passes

### Phase 4: VERIFY
- Run full test suite — no regressions
- Check git diff — ensure minimal, focused change

### Phase 5: DOCUMENT
- Update CHANGELOG.md if user-facing
- Add inline comments explaining the fix

### Stopping Condition
- Failing test passes AND full suite passes AND diff is minimal

---

## Loop #020 — Loop Harness (Production Code)

### Phase 1: PLAN
- Write implementation plan with clear phases
- Define test strategy before coding

### Phase 2: BUILD (Builder Session)
- Implement code per plan
- Write tests alongside code
- Commit after each passing test phase

### Phase 3: REVIEW (Reviewer Session)
- Review own diff as if reviewing someone else PR
- Check: correctness, edge cases, error handling, naming, performance
- List issues found

### Phase 4: FIX
- Address all issues from review
- Re-run tests

### Phase 5: APPROVE
- Final test run
- Sign off if all checks pass

### Stopping Condition
- All review issues resolved AND tests pass AND no self-identified concerns remain

---

## Loop #027 — Autonomy Loop (Sustained Grinding)

### Phase 1: SETUP
- Create worktree-a (builder) and worktree-b (reviewer)
- Install dependencies in both

### Phase 2: ITERATE (max 5 iterations per checkpoint)
- Builder: implement next task from plan
- Builder: run tests, commit
- Reviewer: review builder diff
- Reviewer: approve or reject with specific feedback
- If rejected: builder fixes in next iteration

### Phase 3: CHECKPOINT (every 5 iterations)
- Full test suite on both worktrees
- Sync worktree-b with worktree-a if approved
- Report progress

### Stopping Condition
- All tasks complete AND reviewer approves final state AND full suite passes

---

## Loop #034 — Multi-LLM Convergence

### Phase 1: IMPLEMENT
- Write code using primary model
- Run tests, document approach

### Phase 2: CROSS-REVIEW
- Review code using secondary/different model
- Document disagreements

### Phase 3: RESOLVE
- If models agree: proceed
- If models disagree: implement both approaches, compare test results

### Phase 4: VERIFY
- Run full test suite
- Both models sign off OR objective metrics decide

### Stopping Condition
- Both models agree code is correct AND tests pass OR objective metrics clearly favor one approach

---

## Context Headroom Rules
1. Before reading any file: grep/search for relevant sections first
2. Never load more than 200 lines of a file at once unless absolutely necessary
3. Summarize completed phases before starting new ones
4. If context feels full: compress previous iterations into a summary
5. Spawn a fresh session rather than continuing in degraded context
