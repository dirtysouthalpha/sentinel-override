# Coding Conventions

**Analysis Date:** 2026-04-24

## Naming Patterns

**Variables:**
- camelCase for all variables and functions
- Descriptive names with clear intent
- Prefixed with domain context (e.g., `agentRunning`, `apiCallCount`, `agentMemory`)
- Constants use UPPER_SNAKE_CASE for configuration objects

**Functions:**
- Async functions use `async function` syntax
- Action handlers prefixed with `execute` (e.g., `executeCommand`)
- Utility functions use clear verbs (e.g., `generatePlan`, `sendSilentUpdate`)
- Event handlers use descriptive names (e.g., `handleWaitFor`)

**Classes/Objects:**
- No ES6 classes used - relies on prototype patterns and object literals
- Configuration object named `CONFIG` with UPPER_SNAKE_CASE properties

## Code Style

**Formatting:**
- 2-space indentation
- Semicolons used consistently
- Braces on same line as opening statement
- Maximum line length: 120 characters
- Trailing commas in arrays and objects

**Comments:**
- Single-line comments with `//`
- Section headers with `// ========== Section Name ==========`
- Inline comments explain WHY not WHAT
- TODO comments use format: `// TODO: description`
- Comments explain complex business logic and self-healing strategies

**Structure:**
- Code organized in logical sections with clear headers
- Functions are reasonably sized (mostly < 50 lines)
- Deep nesting avoided (max 3-4 levels)
- Early returns used for error handling

## Import Organization

**Chrome APIs:**
- Chrome APIs used directly (e.g., `chrome.tabs`, `chrome.runtime`)
- No third-party dependency management system

**Internal Modules:**
- All code in single files (background.js, content.js, popup-full.js)
- No explicit import/export patterns
- Communication via Chrome messaging API

**External Libraries:**
- Marked.js (minified) for markdown rendering
- No build process or bundler

## Error Handling

**Patterns:**
- Try-catch blocks for async operations
- Error messages specific and actionable
- Graceful fallbacks where possible
- Chrome errors checked with `chrome.runtime.lastError`
- Console logging for debugging

**Error Recovery:**
- Retry mechanism with exponential backoff
- Self-healing through strategy shifts
- Circuit breaker pattern for API calls
- Fallback to alternative screenshot methods

**Validation:**
- URL validation before navigation
- Selector validation against scanned elements
- API key validation before making requests
- Model support detection (vision vs text-only)

## Logging

**Console Usage:**
- `console.log` for general information
- `console.warn` for non-critical issues
- `console.error` for failures
- Structured logging with context

**UI Updates:**
- Silent updates via `sendSilentUpdate`
- Progress indicators with step numbers
- Action descriptions for user feedback
- Status indicators in popup

## Comments

**When to Comment:**
- Complex business logic (self-healing, strategy shifts)
- Platform-specific UI behavior (SonicWall, Cisco patterns)
- Critical configuration decisions
- Performance optimizations
- Chrome API limitations and workarounds

**Documentation Style:**
- Clear, concise explanations
- Focus on intent rather than implementation
- Include context about edge cases
- Document timing-sensitive operations

## Function Design

**Size Guidelines:**
- Most functions < 50 lines
- Main agent loop exception (complex state management)
- Break down complex operations into smaller helpers
- Avoid deep nesting with early returns

**Parameters:**
- 3-5 parameters maximum
- Use objects for multiple related parameters
- Optional parameters with defaults
- Destructuring for object parameters

**Return Values:**
- Consistent return types
- Error objects with descriptive messages
- Promise-based for async operations
- Null/undefined for exceptional cases

## Module Design

**Exports:**
- No explicit exports - uses Chrome messaging
- Global state managed through closure
- Chrome storage for persistence

**State Management:**
- Module-level variables for agent state
- Chrome storage for persistence
- Memory management (limits on history entries)
- Clean state resets between tasks

**Communication:**
- Chrome runtime messaging for inter-component communication
- Message types follow pattern: `{ action: 'type', data: ... }`
- Async responses with message channel kept open
- Error handling for message failures

---

*Convention analysis: 2026-04-24*