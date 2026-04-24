# Technology Stack

**Analysis Date:** 2026-04-24

## Languages

**Primary:**
- JavaScript - Core extension logic, Chrome API integration
- HTML - Popup interface (`popup.html`)
- CSS - Styling with custom properties for theming

**Secondary:**
- Markdown - Content rendering via marked.min.js

## Runtime

**Environment:**
- Google Chrome Browser Extension Manifest V3
- JavaScript ES Modules (background.js: "type": "module")

**Storage:**
- chrome.storage.local - User preferences, agent memory, history
- No external database dependencies

## Frameworks

**Core:**
- Chrome Extension APIs (chrome.tabs, chrome.scripting, chrome.storage, chrome.debugger)
- Custom agent engine with self-healing capabilities

**Testing:**
- Not detected (no test files found)

**Build/Dev:**
- Not detected (no build configuration files)

## Key Dependencies

**Critical:**
- marked v15.0.12 - Markdown parsing for content rendering (`marked.min.js`)
- Custom Chrome Extension APIs - Extension core functionality

**Infrastructure:**
- None - Self-contained extension with no external dependencies

## Configuration

**Environment:**
- Chrome Extension manifest-based permissions
- Runtime configuration via chrome.storage.local
- API endpoint, key, and model settings stored in local storage

**Build:**
- No build system - pure client-side JavaScript

## Platform Requirements

**Development:**
- Google Chrome browser
- Chrome Developer Mode for extension loading

**Production:**
- Google Chrome browser
- Manifest V3 compatibility

---

*Stack analysis: 2026-04-24*
```