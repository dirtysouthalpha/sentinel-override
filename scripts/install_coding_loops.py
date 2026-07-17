#!/usr/bin/env python3
"""Agent Zero Coding Loops Installer — Forward Future patterns wired into A0."""
import json, os, sys

A0_USR = "/a0/usr"
A0_SCRIPTS = "/a0/scripts"

# 1. System prompt injection
SYSTEM_PROMPT_ADDON = """
## CODING LOOP PROTOCOL (AUTOMATIC — DO NOT SKIP)

Before ANY coding task, you MUST follow this protocol. No exceptions.

### Phase 1: CLASSIFY
Determine task type:
- bug_fix → Ticket-to-PR-Ready (#016)
- feature → Goal Forge (#035) + Loop Harness (#020)
- refactor → Loop Harness (#020)
- critical_change → Multi-LLM Convergence (#034)
- sustained_grind → Autonomy Loop (#027)

### Phase 2: SPEC (Goal Forge — #035)
Write a SPEC before writing code. Every time.
- What to build (scope)
- What NOT to build (boundaries)
- Acceptance criteria (measurable)
- Estimated complexity

### Phase 3: EXECUTE with loop discipline
- Never generate AND approve your own code
- Run verification after every code change (tests, linter, git diff)
- Keep context lean — targeted file reads, not full dumps
- Track iteration count — if >10 iterations on same issue, escalate

### Phase 4: VERIFY
- All tests pass
- Linter clean
- Git diff reviewed
- Acceptance criteria met (check each one explicitly)

### Phase 5: STOP
Declare done ONLY when:
- Acceptance criteria are explicitly verified
- No regressions introduced
- Documentation updated (if applicable)
- PR is mergeable

### ANTI-PATTERNS (halt immediately if detected):
- "I'll just code this real quick" → STOP, write spec first
- Self-approving production code → STOP, get review
- Skipping tests → STOP, run them
- Declaring done without evidence → STOP, verify
- Context window filling with file dumps → STOP, summarize and spawn fresh session
"""

# 2. Task routing config
TASK_ROUTING = {
    "bug_fix": {
        "loop": "#016 Ticket-to-PR-Ready",
        "steps": [
            "Reproduce the bug",
            "Prove root cause (log/diff/assert)",
            "Write minimal fix",
            "Verify fix resolves issue",
            "Check for regressions",
            "Write test that would have caught this",
            "PR: describe bug, root cause, fix, test"
        ],
        "stopping_condition": "Bug is resolved, regression test passes, PR is mergeable"
    },
    "feature": {
        "loop": "#035 Goal Forge then #020 Loop Harness",
        "steps": [
            "Write SPEC.md (scope, boundaries, acceptance criteria)",
            "Write PLAN.md (tasks, order, dependencies)",
            "Build iteratively smallest working unit first",
            "Test each unit before moving to next",
            "Integration test",
            "Code review (self-diff or second model)",
            "Update docs if needed"
        ],
        "stopping_condition": "All acceptance criteria met, tests pass, code reviewed"
    },
    "refactor": {
        "loop": "#020 Loop Harness",
        "steps": [
            "Write SPEC: what changes, what stays the same",
            "Verify current behavior (snapshot tests)",
            "Refactor in small steps",
            "Run full test suite after each step",
            "Compare behavior no regressions",
            "Clean up",
            "PR: describe what changed and why"
        ],
        "stopping_condition": "Same behavior, cleaner code, all tests pass"
    },
    "critical_change": {
        "loop": "#034 Multi-LLM Convergence",
        "steps": [
            "Write SPEC with safety analysis",
            "Build implementation",
            "Second model reviews independently",
            "Both agree then proceed",
            "Disagree then iterate until consensus",
            "Full regression suite",
            "Manual review checkpoint"
        ],
        "stopping_condition": "Two models agree code is correct, all tests pass"
    },
    "sustained_grind": {
        "loop": "#027 Autonomy Loop",
        "steps": [
            "Create builder worktree",
            "Create reviewer worktree",
            "Builder implements task from PLAN",
            "Reviewer checks: tests, logic, edge cases",
            "Reviewer approves then merge next task",
            "Reviewer rejects then builder iterates",
            "Track velocity if slowing summarize context"
        ],
        "stopping_condition": "All tasks in PLAN complete, all reviewed and approved"
    }
}

# 3. Spec template
SPEC_TEMPLATE_LINES = [
    "# SPEC: {title}",
    "",
    "## Objective",
    "{objective}",
    "",
    "## Scope",
    "- In scope: {in_scope}",
    "- Out of scope: {out_of_scope}",
    "",
    "## Acceptance Criteria",
    "- [ ] {criteria_1}",
    "- [ ] {criteria_2}",
    "- [ ] {criteria_3}",
    "",
    "## Estimated Complexity",
    "{complexity}",
    "",
    "## Risks",
    "{risks}",
]
SPEC_TEMPLATE = "\n".join(SPEC_TEMPLATE_LINES)

# 4. Loop reference doc
LOOP_REFERENCE = """# Coding Loop Quick Reference

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
"""

def main():
    print("=== Agent Zero Coding Loops Installer ===")
    
    # Ensure directories exist
    os.makedirs(A0_SCRIPTS, exist_ok=True)
    
    # Install system prompt
    prompt_file = os.path.join(A0_USR, "coding_loops_prompt.txt")
    with open(prompt_file, "w") as f:
        f.write(SYSTEM_PROMPT_ADDON)
    print("[OK] System prompt addon: " + prompt_file)
    
    # Install task routing config
    routing_file = os.path.join(A0_USR, "task_routing.json")
    with open(routing_file, "w") as f:
        json.dump(TASK_ROUTING, f, indent=2)
    print("[OK] Task routing config: " + routing_file)
    
    # Install spec template
    spec_file = os.path.join(A0_SCRIPTS, "spec_template.md")
    with open(spec_file, "w") as f:
        f.write(SPEC_TEMPLATE)
    print("[OK] Spec template: " + spec_file)
    
    # Install loop reference
    loop_ref = os.path.join(A0_SCRIPTS, "loop_reference.md")
    with open(loop_ref, "w") as f:
        f.write(LOOP_REFERENCE)
    print("[OK] Loop reference: " + loop_ref)
    
    # Patch Agent Zero's startup_prompt.md to include loop protocol
    startup_prompt_path = os.path.join(A0_USR, "startup_prompt.md")
    if os.path.exists(startup_prompt_path):
        with open(startup_prompt_path, "r") as f:
            existing = f.read()
        if "CODING LOOP PROTOCOL" not in existing:
            with open(startup_prompt_path, "w") as f:
                f.write(existing + "\n" + SYSTEM_PROMPT_ADDON)
            print("[OK] Patched startup_prompt.md with loop protocol")
        else:
            print("[SKIP] startup_prompt.md already has loop protocol")
    else:
        with open(startup_prompt_path, "w") as f:
            f.write(SYSTEM_PROMPT_ADDON)
        print("[OK] Created startup_prompt.md with loop protocol")
    
    # Patch instructions.md if it exists
    instructions_path = os.path.join(A0_USR, "instructions.md")
    if os.path.exists(instructions_path):
        with open(instructions_path, "r") as f:
            existing = f.read()
        if "CODING LOOP PROTOCOL" not in existing:
            with open(instructions_path, "w") as f:
                f.write(existing + "\n" + SYSTEM_PROMPT_ADDON)
            print("[OK] Patched instructions.md with loop protocol")
        else:
            print("[SKIP] instructions.md already has loop protocol")
    else:
        print("[INFO] instructions.md not found - startup_prompt.md is the primary injection point")
    
    # List what A0 has in usr/ for verification
    print("\n=== Files in /a0/usr/ ===")
    for f_name in sorted(os.listdir(A0_USR)):
        f_path = os.path.join(A0_USR, f_name)
        if os.path.isfile(f_path):
            size = os.path.getsize(f_path)
            print("  " + f_name + " (" + str(size) + " bytes)")
    
    print("\n=== Installation complete ===")
    print("Coding loops are now active. Restart the UI to apply.")
    print("Run: supervisorctl restart run_ui")

if __name__ == "__main__":
    main()
