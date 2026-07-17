---
name: Git Workflow & GitHub Operations
description: Complete git workflow: branching, committing, pushing, PR creation, code review, merging, conflict resolution, and release management. Use when working with git repositories, creating commits, managing branches, or interacting with GitHub via CLI.
---

# Git Workflow & GitHub Operations

## Available Tools
- `git` - Full git CLI with aliases: co (checkout), br (branch), ci (commit), st (status), last, visual
- `gh` - GitHub CLI v2.95.0 (auth as dirtysouthalpha, full scopes)

## Git Aliases Configured
- `git co` = checkout
- `git br` = branch
- `git ci` = commit
- `git st` = status
- `git last` = log -1 HEAD
- `git visual` = log --oneline --graph --all --decorate
- `git unstage` = reset HEAD --

## Standard Workflow

### 1. Branch Management
```bash
# Create and switch to feature branch
git checkout -b feat/description

# Create and switch to fix branch
git checkout -b fix/issue-description

# List branches
git branch -vv
```

### 2. Committing Changes
```bash
# Stage specific files
git add path/to/file1 path/to/file2

# Stage all changes
git add -A

# Commit with conventional format
git commit -m "feat: add user authentication module"
git commit -m "fix: resolve memory leak in connection pool"
git commit -m "docs: update API documentation"
git commit -m "refactor: extract validation logic to separate module"
git commit -m "test: add integration tests for payment flow"
git commit -m "chore: update dependencies"
git commit -m "perf: optimize database query performance"
```

### 3. GitHub Operations
```bash
# Create PR
gh pr create --title "feat: add authentication" --body "Description" --base main

# List PRs
gh pr list

# Review PR
gh pr review <number> --approve --comment "LGTM"

# Merge PR
gh pr merge <number> --squash --delete-branch

# Create release
gh release create v1.0.0 --title "Release v1.0.0" --notes "Release notes"
```

### 4. Conflict Resolution
```bash
# Rebase onto latest main
git fetch origin
git rebase origin/main

# If conflicts occur, resolve in editor then:
git add <resolved-files>
git rebase --continue

# Abort rebase if needed
git rebase --abort
```

## Conventional Commits Format
- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation
- `refactor:` Code refactoring
- `test:` Tests
- `chore:` Maintenance
- `perf:` Performance
- `ci:` CI/CD changes

