# Contributing to Sentinel Override

Thank you for your interest in contributing to Sentinel Override! This guide will help you get started.

## Getting Started

1. **Fork** the repository
2. **Clone** your fork: `git clone https://github.com/<your-username>/sentinel-override.git`
3. **Create a branch** for your change: `git checkout -b feature/your-feature-name`
4. **Make your changes** and test them
5. **Submit a Pull Request**

## Development Setup

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top-right)
3. Click **Load unpacked** and select the project directory
4. The extension icon should appear in your toolbar
5. Make changes to the code and click the **Reload** button on the extension card to test

## Code Style Guidelines

### JavaScript

- Use **ES6+** syntax (const/let, arrow functions, template literals, destructuring)
- Use **camelCase** for variables and functions
- Use **PascalCase** for class names and constructors
- Add **JSDoc comments** for all public functions
- Keep functions **small and focused** — one task per function
- Use **async/await** instead of raw Promises where possible
- No semicolons at end of statements (match existing codebase style)

### File Organization

- `background.js` — Service worker, core agent loop, LLM integration
- `content.js` — Content script injected into web pages
- `popup.html` / `popup-full.js` — Extension popup UI
- `manifest.json` — Chrome extension manifest (MV3)

### Naming Conventions

- Action handler functions: `handle<ActionName>action(params, sendResponse)`
- LLM prompt functions: `build<Context>Prompt(...)` or `create<Message>Type(...)`
- State management: `get<State>()` / `set<State>(value)`

## Pull Request Process

1. **Update documentation** if your change affects user-facing behavior
2. **Test thoroughly** — manually test your changes on real websites
3. **Write a clear PR description** explaining:
   - What the change does
   - Why it's needed
   - How to test it
4. **Link related issues** using `Fixes #123` or `Relates to #456`
5. **Keep PRs focused** — one logical change per PR

### PR Title Format

Use conventional commit style:

- `feat: add new action type for drag-and-drop`
- `fix: resolve content script injection failure on SPAs`
- `docs: update README with new action examples`
- `refactor: extract LLM provider logic into separate module`
- `test: add unit tests for extract action`

## Adding New Action Types

Sentinel Override supports custom action types. To add a new one:

1. **Define the action** in the action handler section of `background.js`
2. **Add the action schema** to the LLM system prompt so it knows when to use it
3. **Implement the handler** following the pattern of existing actions:
   ```javascript
   async function handleNewAction(params, sendResponse) {
     try {
       // Validate params
       if (!params.requiredParam) {
         sendResponse({ success: false, error: 'Missing requiredParam' });
         return;
       }
       
       // Execute the action
       const result = await chrome.scripting.executeScript({
         target: { tabId: currentTab.id },
         func: newActionInPage,
         args: [params]
       });
       
       sendResponse({ success: true, data: result[0].result });
     } catch (error) {
       sendResponse({ success: false, error: error.message });
     }
   }
   ```
4. **Add the action to the action map** so it gets routed correctly
5. **Update documentation** in `USAGE.md` with examples
6. **Test on multiple websites** to ensure compatibility

### Action Handler Checklist

- [ ] Validates all required parameters
- [ ] Returns `{ success: true/false, ... }` response format
- [ ] Handles errors gracefully with descriptive messages
- [ ] Works on both simple and complex (SPA) pages
- [ ] Includes timeout handling where appropriate
- [ ] Logs meaningful debug information

## Testing Requirements

### Manual Testing

Before submitting a PR, test your changes on:

1. **Static sites** — Wikipedia, documentation pages
2. **SPAs** — React/Angular/Vue applications
3. **Forms** — Login pages, multi-step forms
4. **Dynamic content** — Infinite scroll, lazy-loaded content
5. **Multiple tabs** — Ensure tab management works correctly

### Test Scenarios

For each action type, verify:

- ✅ Happy path (normal usage)
- ✅ Missing/invalid parameters
- ✅ Element not found
- ✅ Page navigation during action
- ✅ Timeout handling
- ✅ Cross-origin restrictions

## Reporting Bugs

Use the [Bug Report template](https://github.com/dirtysouthalpha/sentinel-override/issues/new?template=bug_report.md) and include:

1. **Steps to reproduce** — exact actions to trigger the bug
2. **Expected behavior** — what should happen
3. **Actual behavior** — what actually happens
4. **Environment** — Chrome version, OS, website URL
5. **Console logs** — any error messages from the extension console

## Suggesting Features

Use the [Feature Request template](https://github.com/dirtysouthalpha/sentinel-override/issues/new?template=feature_request.md). Describe:

1. **The problem** you're trying to solve
2. **Your proposed solution**
3. **Alternatives** you've considered
4. **Use cases** — who benefits and how

## Code of Conduct

- Be respectful and constructive
- Focus on the code, not the person
- Help others learn and grow
- Welcome newcomers

## Questions?

Open a [Discussion](https://github.com/dirtysouthalpha/sentinel-override/discussions) or check existing issues for answers.

Thank you for contributing! 🚀
