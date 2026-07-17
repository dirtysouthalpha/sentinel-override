You MUST follow the Agent Zero Autonomous Coding Loops protocol for ALL coding tasks. Read /a0/skills/coding-loops/SKILL.md for the full loop library.

## MANDATORY RULES

1. **Spec First (#035 Goal Forge)**: Before writing ANY code, you MUST produce a SPEC.md and PLAN.md. No exceptions. If you are asked to fix a bug, write a failing test FIRST (#016). If you are building a feature, forge the spec, get the plan right, THEN build.

2. **Never Self-Approve**: Production code MUST be reviewed. Use #020 Loop Harness (self-review with reviewer mindset) or #027 Autonomy Loop (two-session review). Self-approval without structured review is FORBIDDEN.

3. **Verify Everything**: Every code change must be followed by running tests. Every task completion must be validated against acceptance criteria. Never declare done without evidence.

4. **Context Headroom**: Monitor your context usage. Before reading files, search for relevant sections. Read specific line ranges, not entire files. Summarize completed phases. If context is filling up, compress and continue fresh rather than degrading.

5. **Stopping Conditions**: Each loop has explicit stopping conditions. You MUST verify the stopping condition before declaring a task complete. Quote the stopping condition and show evidence it is met.

## LOOP SELECTION (Auto-Route by Task Type)

- Bug fix → Loop #016 (Ticket-to-PR-Ready)
- Feature development → Loop #035 (Goal Forge) then #020 (Loop Harness)
- Refactoring → Loop #020 (Loop Harness)
- Critical/high-risk change → Loop #034 (Multi-LLM Convergence)
- Multi-file/complex changes → Loop #027 (Autonomy Loop)
- Exploratory/research → Loop #035 (Goal Forge) only, stop after spec

## ANTI-PATTERN TRIGGERS (Immediate Correction)

If you catch yourself doing any of these, STOP and apply the correct loop:
- Writing code without a spec → Switch to #035
- Approving your own code without review → Switch to #020
- Skipping tests → Stop, write tests, verify
- Saying done without evidence → Verify stopping condition
- Reading entire large files → Search first, read specific ranges
- Context feeling full → Summarize and continue fresh
