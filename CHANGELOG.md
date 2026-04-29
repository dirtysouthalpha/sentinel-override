# Changelog

All notable changes to Sentinel Override will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


## [2.7.0] - 2026-04-29

### Added
- **Poolside AI Provider**: Added support for Poolside AI (https://platform.poolside.ai/)
- **Poolside Models**: mistral-small-3-24b-instruct, llama-3.3-70b-instruct, qwen2.5-72b-instruct, gemma-3-27b-instruct, phi-4
- **Poolside Endpoint**: https://api.poolside.ai/v1/chat/completions

## [2.6.0] - 2026-04-29

### Added
- **Persistent Session Memory**: Analysis history saved to chrome.storage.local, survives extension reloads
- **Analysis Templates**: Auto-detect network, server, security, database incident types with specialized prompts
- **Follow-up Suggestions**: Context-aware suggested follow-up questions after analysis
- **Collapsible Sections**: Analysis sections (H2/H3) can be expanded/collapsed for better readability
- **Export Analysis**: Download analysis as .md file with 💾 Export button
- **Typing Animation**: Smooth character-by-character reveal for analysis results
- **Screenshot Analysis**: Capture and analyze page screenshots with html2canvas integration
## [2.5.0] - 2026-04-29

### Added
- **Analysis Mode**: Claude-style incident analysis reports with professional formatting
- **Analysis System Prompt**: Structured output rules for KEY FINDINGS, ROOT CAUSE ASSESSMENT, IMMEDIATE ACTIONS
- **Conversation Memory**: Multi-turn context continuity for analysis sessions (last 10 turns)
- **Page Context Extraction**: Automatic injection of page URL, title, content, tables, and metadata
- **Rich Markdown Rendering**: Analysis results displayed with cyan accent styling and copy button
- **Analysis History Management**: Auto-clear on new chat for fresh context

### Changed
- **Prompt Routing**: New 3-tier routing (Analysis → Plan → Simple) based on keyword detection
- **Background.js**: Added `analyzeWithPage()`, `buildAnalysisMessages()`, and `runAnalysis()` functions
- **Popup-full.js**: Added `addAnalysisMessage()` for rich analysis rendering
- **Message Handling**: New `analysis_result` and `analysis_error` message actions

### Added
- **Structured Data Extraction**: `content.js` now extracts tables, metadata, and forms as structured JSON.
- **Persistent Memory**: Agent now stores structured page data in `taskContext.intermediateData` for better context retention.
- **v2.4 Growth Plan**: Updated roadmap to reflect new features.

### Changed
- **Manifest Version**: Updated to `2.4`.
- **Background Loop**: Now fetches structured data on every page read step.

### Fixed
- **Orphan Tags**: Cleaned up v3.x tags from GitHub repository.
### Added
- **Structured Data Extraction**: `content.js` now extracts tables, metadata, and forms as structured JSON.
- **Persistent Memory**: Agent now stores structured page data in `taskContext.intermediateData` for better context retention.
- **v2.4 Growth Plan**: Updated roadmap to reflect new features.

### Changed
- **Manifest Version**: Updated to `2.4`.
- **Background Loop**: Now fetches structured data on every page read step.

### Fixed
- **Orphan Tags**: Cleaned up v3.x tags from GitHub repository.

## [2.3.0] - 2026-04-27

### Added
- **Shortcut UI**: Quick access to saved agent instructions.
- **Growth Plan**: Strategic roadmap for distribution and community building.
- **Documentation**: Comprehensive README and screenshots.

## [2.2.0] - 2026-04-26

### Added
- **Lean Context Retention**: Improved context window management.
- **Auto-Tool Generation**: Agent can generate JavaScript workarounds for failed steps.

## [2.1.0] - 2026-04-25

### Added
- **Plan-Decompose UX**: Visual breakdown of agent plans.
- **OpenRouter Provider Preset**: Easy setup for OpenRouter API.

## [2.0.0] - 2026-04-24

### Added
- **Hard-coded Cost Safeguards**: Prevents runaway costs with fixed limits.
- **OpenRouter Migration**: Default provider switched to OpenRouter.
