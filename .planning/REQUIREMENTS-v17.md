# Milestone v17.0 Requirements — Codebase Health + Developer Velocity

## Version & Build (VER)

- [x] **VER-01**: Bump manifest.json and package.json to 16.0.0
- [x] **VER-02**: Build script includes lib/ directory (currently misses lib/marked.min.js)
- [x] **VER-03**: Build script references are correct (marked.min.js moved to lib/ in v16.0)
- [x] **VER-04**: Add 
pm run build as alias and 
pm run test:all for full suite + build check

## Test Coverage (COV)

- [x] **COV-01**: Tests for agent-recovery.js (withRecovery, retry policy, error emission)
- [x] **COV-02**: Tests for ws-bridge.js (auth gate, message validation, jitter)
- [x] **COV-03**: Tests for agent-planning.js (plan generation helpers)
- [x] **COV-04**: Tests for agent-reporting.js (status reporting helpers)
- [x] **COV-05**: Tests for agent-security.js (security check helpers)

## Dead Code & Audit (DCA)

- [x] **DCA-01**: Audit federation.js — confirm only used by collaboration.js or remove dead exports
- [x] **DCA-02**: Audit runtime-profiler.js — confirm single consumer, document usage
- [x] **DCA-03**: Identify top-5 TODO clusters by file and surface for triage
- [x] **DCA-04**: Verify all background module exports have at least one consumer

## Content Script Hardening (CSH)

- [x] **CSH-01**: Add error boundary to content/index.js — catch and report errors to background
- [x] **CSH-02**: Add error boundary to content/quick-assist.js — graceful degradation on failure
- [x] **CSH-03**: Add error boundary to content/cursor.js — prevent UI crash propagation

## LLM Client Modularization (LLM)

- [x] **LLM-01**: Extract retry logic from llm-client.js into llm-retry.js
- [x] **LLM-02**: Extract plan generation from llm-client.js into llm-planning.js
- [x] **LLM-03**: llm-client.js imports from new sub-modules, no behavioral change
- [x] **LLM-04**: All existing llm-client tests still pass after extraction

## Developer Experience (DX)

- [x] **DX-01**: Add 
pm run test:quick — runs only tests for changed files (git diff heuristic)
- [x] **DX-02**: Add 
pm run lint:fix — auto-fix eslint issues
- [x] **DX-03**: Add 
pm run check — runs lint + test + build as pre-push gate

## Traceability

| Phase | Requirements |
|-------|-------------|
| Phase 1: Version & Build | VER-01, VER-02, VER-03, VER-04 |
| Phase 2: Test Coverage | COV-01, COV-02, COV-03, COV-04, COV-05 |
| Phase 3: Dead Code Audit | DCA-01, DCA-02, DCA-03, DCA-04 |
| Phase 4: Content Script Hardening | CSH-01, CSH-02, CSH-03 |
| Phase 5: LLM Client Modularization | LLM-01, LLM-02, LLM-03, LLM-04 |
| Phase 6: Developer Experience | DX-01, DX-02, DX-03 |
