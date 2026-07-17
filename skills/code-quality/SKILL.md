---
name: Code Quality & Linting
description: Run code quality checks: Python linting (flake8, black, mypy, isort), TypeScript/JS linting (eslint, prettier, tsc), and test execution (pytest). Use when checking code quality, formatting code, running tests, or setting up linting.
---

# Code Quality & Linting

## Python Tools

### Formatting
```bash
# Format Python files
black --line-length 120 path/to/file.py
black --line-length 120 .

# Sort imports
isort --profile black path/to/file.py
isort --profile black .
```

### Linting
```bash
# Flake8 (style + basic errors)
flake8 --max-line-length 120 --extend-ignore E203,W503 path/to/

# MyPy (type checking)
mypy --ignore-missing-imports path/to/file.py
```

### Testing
```bash
# Run all tests
pytest

# Run with verbose output
pytest -v

# Run specific test file
pytest tests/test_file.py -v

# Run with coverage
pytest --cov=src --cov-report=term-missing

# Run async tests
pytest -v -k "async"
```

## JavaScript/TypeScript Tools

### Formatting
```bash
# Prettier
npx prettier --write "src/**/*.{js,ts,jsx,tsx,json,css,md}"
npx prettier --check "src/**/*.{js,ts,jsx,tsx}"
```

### Linting
```bash
# ESLint
npx eslint src/ --ext .js,.ts,.jsx,.tsx
npx eslint src/ --ext .js,.ts,.jsx,.tsx --fix

# TypeScript type checking
npx tsc --noEmit
```

## Quality Checklist
Before committing code:
1. Run `black .` and `isort .` for Python formatting
2. Run `flake8 .` to catch style issues
3. Run `mypy .` for type safety
4. Run `pytest -v` to verify tests pass
5. Run `npx prettier --write .` for JS/TS formatting
6. Run `npx eslint . --fix` for JS/TS linting

