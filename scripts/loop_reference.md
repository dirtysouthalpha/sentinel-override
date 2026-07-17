# Coding Loop Quick Reference

## #016 Ticket-to-PR-Ready
Use for: Bug fixes
Pattern: Reproduce then Prove root cause then Minimal fix then Verify then Regression test then PR
Stop when: Bug resolved, test passes, PR mergeable

## #020 Loop Harness  
Use for: Production code, refactors
Pattern: Builder writes then Reviewer validates then Iterate until approved
Stop when: Reviewer signs off, tests green

## #027 Autonomy Loop
Use for: Long-running tasks (many files, many changes)
Pattern: Builder worktree + Reviewer worktree, iterate per task
Stop when: All tasks complete, all reviewed

## #034 Multi-LLM Convergence
Use for: Critical changes (security, data, core logic)
Pattern: Two models review independently, iterate until consensus
Stop when: Both models agree

## #035 Goal Forge
Use for: ALL tasks (mandatory first step)
Pattern: SPEC.md then PLAN.md then Build then Verify
Stop when: Acceptance criteria explicitly verified

## Context Headroom Rules
- Count tokens per iteration, slow down at 80% capacity
- Never dump full files, grep first read specific lines
- If context fills: summarize previous steps, spawn fresh session
- Targeted reads: only what you need for the current subtask
