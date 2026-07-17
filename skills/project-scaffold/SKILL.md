---
name: Project Scaffolding
description: Create new project structures for Python, Node.js, React, FastAPI, Flask, and full-stack apps. Includes boilerplate, configs, and CI setup. Use when creating a new project, initializing boilerplate, or setting up a development environment.
---

# Project Scaffolding

## Python Project Structure
```
project/
├── src/
│   └── package_name/
│       ├── __init__.py
│       ├── main.py
│       └── utils.py
├── tests/
│   ├── __init__.py
│   └── test_main.py
├── pyproject.toml
├── requirements.txt
├── .gitignore
└── README.md
```

### Create Python Project
```bash
mkdir -p project/src/package_name project/tests
touch project/src/package_name/__init__.py project/tests/__init__.py
```

### pyproject.toml Template
```toml
[project]
name = "package-name"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = []

[project.optional-dependencies]
dev = ["pytest", "black", "flake8", "mypy", "isort"]
```

## Node.js / TypeScript Project
```bash
mkdir project && cd project
npm init -y
npm install typescript tsx @types/node --save-dev
npx tsc --init --target es2022 --module nodenext --moduleResolution nodenext --strict
```

## FastAPI Project
```bash
pip install fastapi uvicorn[standard]
# main.py with FastAPI app boilerplate
```

## Standard .gitignore
```
__pycache__/
*.pyc
.env
venv/
node_modules/
dist/
build/
*.egg-info/
.pytest_cache/
.mypy_cache/
.coverage
```

## Git Init
```bash
git init
git add -A
git commit -m "feat: initial project setup"
gh repo create project-name --private --source=. --push
```

