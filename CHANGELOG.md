# Changelog

All notable changes to Sentinel Override will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.4.0] - 2026-04-27

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
