---
name: Action Type Proposal
about: Propose a new browser action type for Sentinel Override
title: '[ACTION] '
labels: action-type
assignees: ''
---

## Action Name

<!-- e.g., drag_and_drop, file_upload, iframe_interact -->

## Description

A clear description of what this action does and when it would be used.

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| | | | |

## Example Usage

Describe a real-world scenario where this action would be used:

```
Task: "Upload a CSV file to the admin dashboard"
Step 1: Navigate to the upload page
Step 2: [NEW ACTION] — file_upload with selector="#file-input" and file="data.csv"
Step 3: Click the submit button
```

## Implementation Notes

How would this action be implemented in the browser?

- **DOM API needed:** [e.g., `element.dragDrop()`, `input.files = ...`]
- **Permissions required:** [e.g., none, fileSystem, downloads]
- **Content script or background:** [where should this run?]

## Existing Workarounds

Is there currently a way to achieve this with existing actions? If so, what are the limitations?

## Priority

- [ ] Critical — blocks common automation workflows
- [ ] Important — would significantly improve automation quality
- [ ] Nice-to-have — enables new use cases but not blocking

## Additional Context

Add references, documentation links, or examples from other automation tools.
