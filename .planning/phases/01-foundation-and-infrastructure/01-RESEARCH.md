# Phase 1: Foundation and Infrastructure - Research

**Researched:** 2026-05-02
**Domain:** Python project scaffolding, configuration management, structured logging, SQLite storage, async scheduling, CLI framework
**Confidence:** HIGH

## Summary

Phase 1 establishes the data backbone for MediaSentinel: a Pydantic-validated YAML configuration system, structured JSON logging via loguru, SQLite with WAL mode for metrics persistence, APScheduler 3.x for periodic job scheduling, and a click-based CLI entry point. These are all mature, well-documented libraries with stable APIs. The primary risk is the APScheduler 3.x vs 4.x API divergence -- the project locks to 3.11.2 explicitly, and the APIs are completely different (3.x uses `add_job()`, 4.x uses `add_schedule()`). All code examples in this research target 3.x exclusively.

The Windows Server 2025 target introduces one path adaptation: CFG-04 specifies `/var/log/mediasentinel/` (Linux convention) but must use a Windows-appropriate path. The standard approach is `%PROGRAMDATA%\MediaSentinel\logs\` (typically `C:\ProgramData\MediaSentinel\logs\`), which does not require admin elevation for the Administrator user and follows Windows conventions for service data.

**Primary recommendation:** Build the `mediasentinel` package with a `src/` layout, pyproject.toml packaging, and a single `AsyncIOScheduler` instance owned by the orchestrator. Use loguru's `bind()` for component-scoped loggers and aiosqlite for all database access from the async event loop.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CFG-01 | YAML configuration file defines service URLs, API keys, check intervals, recovery thresholds, alert recipients | PyYAML 6.0.3 for parsing; Pydantic 2.x model as schema. See Architecture Patterns: Config Loading Pattern |
| CFG-02 | Pydantic-validated config models with clear error messages on misconfiguration | Pydantic 2.13.3 with `field_validator`, `model_validator`, `ConfigDict(extra='forbid')`. See Code Examples |
| CFG-03 | Structured JSON logging via loguru with timestamp, severity, component, action, result fields | Loguru 0.7.3 with `serialize=True` and `bind()` for structured fields. See Code Examples |
| CFG-04 | All health checks logged to health.log, recoveries to recovery.log | Loguru file sinks with rotation/retention; custom sink for per-component routing. Windows path: `%PROGRAMDATA%\MediaSentinel\logs\` |
| CFG-05 | CLI entry point via click with subcommands: start, status, logs, recover, config | Click 8.3.x with `@click.group()` and `[project.scripts]` entry point. See Code Examples |
| MET-04 | Stores all metrics in SQLite with WAL mode for concurrent access | aiosqlite 0.22.1 with `PRAGMA journal_mode=WAL`. See Code Examples |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| YAML config loading + Pydantic validation | Application Core | -- | Config is read once at startup, shared in-memory. No tier split needed. |
| Structured JSON logging | Application Core | -- | loguru runs in-process, writes to local filesystem. |
| SQLite metrics storage | Database / Storage | Application Core | SQLite is embedded; aiosqlite wraps it for async access. |
| APScheduler job scheduling | Application Core | -- | AsyncIOScheduler lives in the orchestrator's event loop. |
| CLI entry point | Application Core | -- | click parses args, then delegates to core. No server component. |

All Phase 1 capabilities are local to the application core. There is no client/server split, no HTTP serving, and no external service dependency. This simplifies the architecture to a single-process Python application.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| pydantic | 2.13.3 | Config validation, type-safe models | Industry standard for Python data validation. `BaseModel` with validators, `BaseSettings` for env vars. Declarative schema beats hand-written validation. [VERIFIED: pip registry] |
| apscheduler | 3.11.2 | Periodic job scheduling (health checks, VPN polls) | Mature, stable cron-like scheduler. AsyncIOScheduler integrates natively with asyncio event loop. Version-locked to 3.x -- 4.x is pre-release with incompatible API. [VERIFIED: pip registry, APScheduler user guide] |
| loguru | 0.7.3 | Structured JSON logging | Single-function API (`logger`), `serialize=True` for JSON, `bind()` for structured context. Simpler than stdlib logging config. [VERIFIED: pip registry] |
| aiosqlite | 0.22.1 | Async SQLite access | Wraps sqlite3 in a dedicated thread so database calls never block the event loop. Required for WAL mode concurrent reads. [VERIFIED: pip registry] |
| click | 8.3.3 | CLI framework | De facto standard for Python CLIs. Groups, subcommands, help generation, type-safe parameters. [VERIFIED: pip registry] |
| pyyaml | 6.0.3 | YAML config file parsing | Only maintained YAML library for Python. Required by Pydantic's YAML support or manual parsing. [VERIFIED: pip registry] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| pydantic-settings | 2.x | Env var / .env file loading with Pydantic models | When config values should be overridable via environment variables (API keys, secrets) |
| pytest | 9.0.3 | Test framework | All unit/integration tests |
| pytest-asyncio | 0.26.x | Async test support for pytest | Testing async functions (aiosqlite, APScheduler coroutines) |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| loguru | stdlib logging + structlog | stdlib is more verbose to configure; structlog is powerful but more complex. loguru is the simplest path to structured JSON output. |
| click | typer | Typer is built on click but adds type hints and less boilerplate. However, click groups are more explicit and better documented for subcommand hierarchies. |
| aiosqlite | sqlite3 in run_in_executor | aiosqlite handles connection pooling and thread management. run_in_executor requires manual thread safety. |
| pydantic-settings | os.environ directly | Pydantic-settings gives type coercion, validation, and `.env` file support for free. |

**Installation:**
```bash
pip install pydantic==2.13.3 apscheduler==3.11.2 loguru==0.7.3 aiosqlite==0.22.1 click==8.3.3 pyyaml==6.0.3 pydantic-settings
```

**Version verification (2026-05-02):**
```
pydantic      2.13.3   (latest stable)
apscheduler   3.11.2   (latest 3.x; 4.x is pre-release)
loguru        0.7.3    (latest stable)
aiosqlite     0.22.1   (latest stable)
click         8.3.3    (latest stable)
pyyaml        6.0.3    (latest stable)
```

## Architecture Patterns

### System Architecture Diagram

```
                          CLI (click)
                             |
                         start/status/logs/recover/config
                             |
                             v
                     +---------------+
                     |  Orchestrator  |<-- owns scheduler + event loop
                     +-------+-------+
                             |
              +--------------+--------------+
              |              |              |
              v              v              v
      +-------+--+   +------+------+   +--+--------+
      | Config   |   | SQLite DB  |   | loguru     |
      | Loader   |   | (aiosqlite)|   | (structured|
      | (Pydantic)|  | WAL mode   |   |  JSON)     |
      +----------+   +------------+   +------------+
           ^              ^                  ^
           |              |                  |
     config.yaml    metrics.sqlite    logs/*.log
     .env (secrets)
```

Data flow:
1. CLI parses arguments via click
2. Orchestrator loads config.yaml through Pydantic validator (fail fast on invalid config)
3. Orchestrator initializes SQLite connection with WAL mode
4. Orchestrator configures loguru sinks (console + file rotation)
5. Orchestrator creates AsyncIOScheduler, registers periodic jobs
6. Scheduler runs jobs; each job logs via bound logger, writes metrics to SQLite

### Recommended Project Structure

```
mediasentinel/
+-- pyproject.toml              # Package metadata, dependencies, entry points
+-- config.yaml                 # Default configuration template
+-- src/
|   +-- mediasentinel/
|       +-- __init__.py
|       +-- __main__.py         # python -m mediasentinel support
|       +-- cli.py              # click group + subcommands
|       +-- config/
|       |   +-- __init__.py
|       |   +-- models.py       # Pydantic config models
|       |   +-- loader.py       # YAML loading + validation
|       +-- core/
|       |   +-- __init__.py
|       |   +-- orchestrator.py # Main scheduler setup, event loop owner
|       +-- db/
|       |   +-- __init__.py
|       |   +-- connection.py   # aiosqlite connection factory, WAL setup
|       |   +-- schema.sql      # DDL for metrics tables
|       +-- logging/
|       |   +-- __init__.py
|       |   +-- setup.py        # loguru configuration, sink setup
|       +-- agents/             # Future: VPNGuard, TunnelGuard, etc. (empty for Phase 1)
+-- tests/
    +-- conftest.py             # Shared fixtures (temp config, temp DB)
    +-- test_config_models.py   # Pydantic validation tests
    +-- test_config_loader.py   # YAML loading tests
    +-- test_db_connection.py   # SQLite WAL mode tests
    +-- test_logging_setup.py   # loguru sink tests
    +-- test_cli.py             # click subcommand tests
```

### Pattern 1: Pydantic Config Model with Strict Validation

**What:** Declarative config schema with Pydantic BaseModel. Rejects unknown fields. Validates types, ranges, and inter-field dependencies.
**When to use:** All configuration structures in the project.

```python
# Source: Pydantic 2.x docs (verified via Context7 + pip)
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

class ServiceConfig(BaseModel):
    model_config = ConfigDict(extra='forbid')  # Reject unknown keys

    name: str
    url: str
    poll_interval_seconds: int = Field(ge=5, le=300, description="Polling interval")
    critical: bool = False
    failure_threshold: int = Field(ge=1, le=10, default=3)

    @field_validator('url')
    @classmethod
    def url_must_be_valid(cls, v: str) -> str:
        if not v.startswith(('http://', 'https://')):
            raise ValueError(f'URL must start with http:// or https://, got: {v}')
        return v.rstrip('/')


class AppConfig(BaseModel):
    model_config = ConfigDict(extra='forbid')

    services: list[ServiceConfig]
    vpn: VPNConfig
    logging: LoggingConfig
    database: DatabaseConfig

    @model_validator(mode='after')
    def validate_service_names_unique(self) -> 'AppConfig':
        names = [s.name for s in self.services]
        if len(names) != len(set(names)):
            raise ValueError('Service names must be unique')
        return self
```

### Pattern 2: APScheduler 3.x AsyncIOScheduler Setup

**What:** Single scheduler instance using AsyncIOScheduler with job defaults that prevent overlapping runs.
**When to use:** Scheduling all periodic health checks and monitoring jobs.

```python
# Source: APScheduler 3.x user guide (apscheduler.readthedocs.io/en/3.x/)
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger

scheduler = AsyncIOScheduler(
    job_defaults={
        'coalesce': True,      # Run only once if missed fires accumulate
        'max_instances': 1,    # Never run same job concurrently
        'misfire_grace_time': 30,  # Grace period before skipping missed job
    }
)

# Adding a job (3.x API -- NOT add_schedule which is 4.x)
scheduler.add_job(
    check_service_health,
    trigger=IntervalTrigger(seconds=15),
    id='health_jellyfin',
    name='Health check: Jellyfin',
    kwargs={'service_name': 'jellyfin'},
    replace_existing=True,
)

scheduler.start()
```

**Critical note:** APScheduler 4.x uses `add_schedule()` with `CoalescePolicy` enum. APScheduler 3.x uses `add_job()` with `coalesce=True` (bool). The project is locked to 3.11.2. [VERIFIED: APScheduler 3.x user guide at apscheduler.readthedocs.io/en/3.x/userguide.html]

### Pattern 3: Loguru Structured JSON Logging

**What:** Component-scoped loggers with structured fields, JSON serialization, and file rotation.
**When to use:** All logging throughout the application.

```python
# Source: loguru docs (verified via pip)
from loguru import logger
import sys

# Remove default handler
logger.remove()

# Console sink: human-readable format
logger.add(
    sys.stderr,
    format="<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level: <8}</level> | <cyan>{name}</cyan>:<cyan>{function}</cyan> - <level>{message}</level>",
    level="INFO",
)

# File sink: structured JSON with rotation
logger.add(
    "logs/mediasentinel.json",
    format="{time:YYYY-MM-DD HH:mm:ss} | {level} | {message}",
    serialize=True,    # JSON output
    rotation="10 MB",  # Rotate at 10MB
    retention="30 days",
    compression="gz",
    level="DEBUG",
)

# Component-scoped logger with structured fields
vpn_logger = logger.bind(component="VPNGuard", action="dns_leak_test")
vpn_logger.info("DNS leak test passed", result="pass", server="10.0.0.1")

# Per-component file routing via custom sink function
def health_sink(message):
    """Route health check logs to separate file."""
    record = message.record
    if record.get('extra', {}).get('component') == 'HealthMonitor':
        with open('logs/health.log', 'a') as f:
            f.write(str(message) + '\n')

def recovery_sink(message):
    """Route recovery logs to separate file."""
    record = message.record
    if record.get('extra', {}).get('component') == 'RecoveryEngine':
        with open('logs/recovery.log', 'a') as f:
            f.write(str(message) + '\n')

logger.add(health_sink, level="DEBUG")
logger.add(recovery_sink, level="DEBUG")
```

### Pattern 4: SQLite with WAL Mode via aiosqlite

**What:** Async SQLite connection factory that enables WAL mode on every connection.
**When to use:** All database access from the async event loop.

```python
# Source: aiosqlite docs + SQLite PRAGMA reference
import aiosqlite
from pathlib import Path

DB_PATH = Path("data/metrics.sqlite")

async def get_connection() -> aiosqlite.Connection:
    """Create a new connection with WAL mode enabled."""
    db = await aiosqlite.connect(DB_PATH)
    await db.execute("PRAGMA journal_mode=WAL;")
    await db.execute("PRAGMA synchronous=NORMAL;")  # Safe with WAL, faster writes
    await db.execute("PRAGMA foreign_keys=ON;")
    return db

async def init_schema():
    """Create tables if they don't exist."""
    db = await get_connection()
    try:
        await db.executescript("""
            CREATE TABLE IF NOT EXISTS health_checks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                service_name TEXT NOT NULL,
                status TEXT NOT NULL CHECK(status IN ('healthy', 'degraded', 'unhealthy')),
                response_time_ms REAL,
                checked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                details TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_health_service_time
                ON health_checks(service_name, checked_at);

            CREATE TABLE IF NOT EXISTS vpn_status (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                connected INTEGER NOT NULL,
                external_ip TEXT,
                vpn_server TEXT,
                latency_ms REAL,
                dns_leak INTEGER,
                ip_leak INTEGER,
                checked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_vpn_time ON vpn_status(checked_at);

            CREATE TABLE IF NOT EXISTS recovery_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                service_name TEXT NOT NULL,
                escalation_level INTEGER NOT NULL,
                action TEXT NOT NULL,
                result TEXT NOT NULL,
                snapshot TEXT,
                started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                completed_at TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_recovery_service_time
                ON recovery_events(service_name, started_at);
        """)
        await db.commit()
    finally:
        await db.close()
```

### Pattern 5: Click CLI with Subcommands

**What:** Click group with subcommands for start, status, logs, recover, config.
**When to use:** The main entry point for the application.

```python
# Source: click docs (verified via pip)
import click

@click.group()
@click.option('--config', '-c', default='config.yaml', help='Config file path')
@click.option('--verbose', '-v', is_flag=True, help='Enable verbose output')
@click.pass_context
def cli(ctx, config, verbose):
    """MediaSentinel - Media Stack Monitoring and Auto-Recovery."""
    ctx.ensure_object(dict)
    ctx.obj['config_path'] = config
    ctx.obj['verbose'] = verbose

@cli.command()
@click.pass_context
def start(ctx):
    """Start the monitoring daemon."""
    config_path = ctx.obj['config_path']
    click.echo(f"Starting MediaSentinel with config: {config_path}")
    # Orchestrator initialization goes here

@cli.command()
@click.pass_context
def status(ctx):
    """Show current status of all monitored services."""
    click.echo("Service Status:")
    # Query SQLite for latest health checks

@cli.command()
@click.pass_context
def logs(ctx):
    """View recent log entries."""
    click.echo("Recent logs:")
    # Tail log files

@cli.command()
@click.pass_context
def recover(ctx):
    """Trigger manual recovery for a service."""
    click.echo("Manual recovery:")
    # Interactive recovery trigger

@cli.command()
@click.pass_context
def config(ctx):
    """Validate and display current configuration."""
    click.echo("Configuration validation:")
    # Load and validate config, display result

if __name__ == '__main__':
    cli()
```

### Pattern 6: pyproject.toml with Entry Point

**What:** Modern Python packaging with pyproject.toml, using setuptools and console_scripts entry point.
**When to use:** Package definition.

```toml
# pyproject.toml
[build-system]
requires = ["setuptools>=68.0", "wheel"]
build-backend = "setuptools.build_meta"

[project]
name = "mediasentinel"
version = "0.1.0"
description = "Intelligent monitoring and auto-recovery for home media stacks"
requires-python = ">=3.10"
dependencies = [
    "pydantic>=2.10,<3",
    "apscheduler==3.11.2",
    "loguru>=0.7.0,<1",
    "aiosqlite>=0.20,<1",
    "click>=8.1,<9",
    "pyyaml>=6.0,<7",
    "pydantic-settings>=2.0,<3",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0",
    "pytest-asyncio>=0.23",
]

[project.scripts]
mediasentinel = "mediasentinel.cli:cli"

[tool.setuptools.packages.find]
where = ["src"]

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
```

### Anti-Patterns to Avoid

- **Using APScheduler 4.x API:** `add_schedule()`, `CoalescePolicy`, `Run` return type are all 4.x. The project uses 3.x (`add_job()`, `coalesce=True` bool). Mixing them causes AttributeError at runtime. [VERIFIED: APScheduler 3.x vs 4.x user guide comparison]
- **Reading config once and passing dicts:** Use Pydantic models everywhere. Passing raw dicts loses type safety and validation. If a config value is needed, access it through the validated model.
- **Blocking the event loop with sqlite3:** Never use synchronous sqlite3 directly in async code. Always use aiosqlite. A single blocking database call stalls all scheduled jobs.
- **Creating multiple AsyncIOScheduler instances:** One scheduler per process. Multiple schedulers cause duplicate jobs and resource leaks.
- **Using stdlib logging alongside loguru:** Mixing logging frameworks creates inconsistent output. Remove stdlib handlers and use loguru exclusively via `logger.remove()` + `logger.add()`.
- **Hardcoding Linux paths on Windows:** `/var/log/`, `/opt/`, `/etc/` do not exist on Windows Server 2025. Use `os.environ.get('PROGRAMDATA', '.')` for data paths, `Path.home()` for user configs.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Config validation | Manual if/else checks on parsed YAML | Pydantic BaseModel with validators | Pydantic handles type coercion, nested validation, error messages, and schema generation. Hand-rolled validation is error-prone and verbose. |
| Job scheduling | Custom asyncio loop with sleep() and task tracking | APScheduler AsyncIOScheduler | APScheduler handles misfire grace, coalescing, persistence, and interval/cron triggers. Hand-rolling introduces subtle timing bugs. |
| JSON logging | Custom stdlib logging Formatter subclass | loguru with `serialize=True` | loguru's JSON mode includes all context fields automatically. Custom formatters miss edge cases and are harder to maintain. |
| Async SQLite access | sqlite3 + asyncio.run_in_executor manually | aiosqlite | aiosqlite manages the thread, connection lifecycle, and async interface. Manual executor wrapping risks thread safety issues. |
| CLI argument parsing | sys.argv parsing or argparse | click | click handles type conversion, help generation, shell completion, and nested subcommands. argparse groups are less ergonomic. |
| YAML parsing | Custom string splitting/regex | PyYAML safe_load | YAML has complex spec (anchors, aliases, multiline strings). safe_load is the only safe approach. |

**Key insight:** Every one of these problems has a mature library solution. Phase 1 is the foundation -- using libraries here means every subsequent phase builds on stable, tested abstractions rather than custom code that would need debugging alongside the actual monitoring logic.

## Common Pitfalls

### Pitfall 1: APScheduler 3.x vs 4.x API Confusion
**What goes wrong:** Code uses `add_schedule()` or `CoalescePolicy` from 4.x docs/tutorials, but the installed version is 3.11.2. Runtime AttributeError.
**Why it happens:** Web search results mix 3.x and 4.x examples. The APScheduler 4.x documentation is more prominent in search results.
**How to avoid:** Pin `apscheduler==3.11.2` in pyproject.toml. All job registration uses `scheduler.add_job()`. `coalesce` is a bool, not an enum. `max_instances` is an int.
**Warning signs:** `AttributeError: 'AsyncIOScheduler' object has no attribute 'add_schedule'`

### Pitfall 2: SQLite WAL Mode Not Persisting
**What goes wrong:** WAL mode is set on one connection, but subsequent connections open in DELETE mode (the default).
**Why it happens:** WAL mode is a per-database property that persists, but only if the first connection sets it and closes cleanly. If the database file is deleted/recreated, WAL mode reverts to DELETE.
**How to avoid:** Execute `PRAGMA journal_mode=WAL;` on every new connection in the connection factory. It is a no-op if already in WAL mode, so there is no performance penalty.
**Warning signs:** Concurrent read/write errors; `database is locked` errors despite WAL mode expected.

### Pitfall 3: Loguru Serialize Missing Custom Fields
**What goes wrong:** `serialize=True` outputs JSON but fields added via `extra={}` in `logger.info()` calls are missing.
**Why it happens:** loguru's `serialize` mode includes `extra` dict contents from `bind()` but NOT from per-call `extra={}` kwargs (depending on version and config).
**How to avoid:** Use `logger.bind(component="X", action="Y")` to create a bound logger, then call `.info("message")` on the bound logger. Per-call extras via keyword arguments ARE included in serialize mode (they go into the extra dict). But `bind()` is more explicit and creates a reusable scoped logger.
**Warning signs:** JSON log output has empty `extra` dict or missing component/action fields.

### Pitfall 4: Windows Path Assumptions
**What goes wrong:** Code uses `/var/log/mediasentinel/` from CFG-04 and fails with FileNotFoundError on Windows.
**Why it happens:** Requirements were written with Linux conventions. The target is Windows Server 2025.
**How to avoid:** Use `pathlib.Path` throughout. Define log directory as `Path(os.environ.get('PROGRAMDATA', '.')) / 'MediaSentinel' / 'logs'`. Create directory on startup if it doesn't exist.
**Warning signs:** FileNotFoundError for `/var/log/...` paths.

### Pitfall 5: Pydantic Model Config Not Forbidding Extras
**What goes wrong:** Typos in config.yaml are silently ignored instead of raising validation errors.
**Why it happens:** By default, Pydantic ignores extra fields. A misspelled key like `poll_intervl_seconds` is silently dropped.
**How to avoid:** Set `model_config = ConfigDict(extra='forbid')` on all config models.
**Warning signs:** Config loads successfully but polling interval is wrong because the key was misspelled.

### Pitfall 6: Click Context Not Shared Across Subcommands
**What goes wrong:** `ctx.obj` is None in subcommands because the group did not call `ctx.ensure_object(dict)`.
**Why it happens:** click's context passing requires explicit initialization.
**How to avoid:** Always call `ctx.ensure_object(dict)` in the group function. Pass shared state (config path, verbosity) through `ctx.obj`.
**Warning signs:** `TypeError` or `AttributeError` when accessing `ctx.obj['config_path']` in a subcommand.

## Code Examples

### Complete Config Loading Pipeline

```python
# config/loader.py
from pathlib import Path
from typing import Any
import yaml
from pydantic import ValidationError
from mediasentinel.config.models import AppConfig
from loguru import logger

class ConfigLoadError(Exception):
    """Raised when config file cannot be loaded or validated."""

def load_config(config_path: Path) -> AppConfig:
    """Load and validate configuration from YAML file.

    Raises:
        ConfigLoadError: If file not found, YAML parse error, or validation fails.
    """
    if not config_path.exists():
        raise ConfigLoadError(f"Config file not found: {config_path}")

    try:
        raw: dict[str, Any] = yaml.safe_load(config_path.read_text(encoding='utf-8'))
    except yaml.YAMLError as e:
        raise ConfigLoadError(f"YAML parse error in {config_path}: {e}") from e

    if raw is None:
        raise ConfigLoadError(f"Config file is empty: {config_path}")

    try:
        config = AppConfig.model_validate(raw)
    except ValidationError as e:
        # Pydantic generates human-readable error messages
        raise ConfigLoadError(f"Config validation error:\n{e}") from e

    logger.info("Configuration loaded successfully", config_path=str(config_path))
    return config
```

### SQLite Connection Factory with Context Manager

```python
# db/connection.py
import aiosqlite
from contextlib import asynccontextmanager
from pathlib import Path
from loguru import logger

DEFAULT_DB_PATH = Path(os.environ.get('PROGRAMDATA', '.')) / 'MediaSentinel' / 'metrics.sqlite'

@asynccontextmanager
async def get_db(db_path: Path = DEFAULT_DB_PATH):
    """Async context manager for SQLite connections with WAL mode."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    db = await aiosqlite.connect(db_path)
    try:
        await db.execute("PRAGMA journal_mode=WAL;")
        await db.execute("PRAGMA synchronous=NORMAL;")
        await db.execute("PRAGMA foreign_keys=ON;")
        yield db
    finally:
        await db.close()
```

### Loguru Setup for Windows

```python
# logging/setup.py
import sys
from pathlib import Path
from loguru import logger

def setup_logging(log_dir: Path, debug: bool = False):
    """Configure loguru with console + JSON file sinks."""
    log_dir.mkdir(parents=True, exist_ok=True)

    logger.remove()  # Remove default handler

    # Console: human-readable
    logger.add(
        sys.stderr,
        format="<green>{time:YYYY-MM-DD HH:mm:ss}</green> | "
               "<level>{level: <8}</level> | "
               "<cyan>{extra.get('component', 'APP')}</cyan> - "
               "<level>{message}</level>",
        level="DEBUG" if debug else "INFO",
    )

    # All logs: structured JSON
    logger.add(
        str(log_dir / "mediasentinel.json"),
        serialize=True,
        rotation="10 MB",
        retention="30 days",
        compression="gz",
        level="DEBUG",
    )

    # Health check logs: separate file
    logger.add(
        str(log_dir / "health.log"),
        format="{time:YYYY-MM-DD HH:mm:ss} | {level} | {message}",
        filter=lambda record: record["extra"].get("component") == "HealthMonitor",
        rotation="10 MB",
        retention="14 days",
    )

    # Recovery logs: separate file
    logger.add(
        str(log_dir / "recovery.log"),
        format="{time:YYYY-MM-DD HH:mm:ss} | {level} | {message}",
        filter=lambda record: record["extra"].get("component") == "RecoveryEngine",
        rotation="10 MB",
        retention="90 days",
    )
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Pydantic 1.x `class Config` | Pydantic 2.x `model_config = ConfigDict(...)` | Pydantic 2.0 (2023-06) | Config is declarative, no inner class. Validators use decorators. |
| stdlib logging + manual JSON formatter | loguru `serialize=True` | Ongoing | Single `logger` object, no handler configuration needed. |
| argparse for CLIs | click for CLIs | click 8.x (2022+) | Decorators, groups, type-safe parameters. |
| sqlite3 synchronous in threads | aiosqlite for async access | aiosqlite 0.17+ (2021) | Native async/await API for SQLite. |
| APScheduler 4.x | APScheduler 3.11.2 (pinned) | 4.x still pre-release | 3.x is the stable release line. 4.x API is incompatible. |

**Deprecated/outdated:**
- Pydantic 1.x `@validator`: Replaced by `@field_validator` in Pydantic 2.x. [VERIFIED: Pydantic migration guide]
- APScheduler 4.x `add_schedule()`: Not stable. Project uses 3.x `add_job()`. [VERIFIED: APScheduler user guide]
- `setup.py` / `setup.cfg`: Replaced by `pyproject.toml` for all package metadata. [VERIFIED: Python Packaging User Guide]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Windows log path should be `%PROGRAMDATA%\MediaSentinel\logs\` | Architecture Patterns | If user expects a different path convention, config loader needs path override support |
| A2 | `pydantic-settings` is needed for env var overrides (API keys in .env) | Standard Stack | Minor -- could use os.environ directly if env var support is deferred |
| A3 | SQLite metrics table schema (health_checks, vpn_status, recovery_events) is sufficient for Phase 1 | Code Examples | Later phases may need additional tables; schema.sql approach allows migration |

**If this table is empty:** All claims in this research were verified or cited -- no user confirmation needed.

## Open Questions

1. **Log file path on Windows**
   - What we know: CFG-04 specifies `/var/log/mediasentinel/` which is Linux-only. Windows has no `/var/log`.
   - What's unclear: Whether the user prefers `%PROGRAMDATA%\MediaSentinel\logs\` or a path relative to the install directory.
   - Recommendation: Use `%PROGRAMDATA%` as default with a `log_dir` config option for override. This follows Windows conventions for service data.

2. **Database file location**
   - What we know: SQLite database needs a stable path. No requirement specifies location.
   - What's unclear: Same as above -- `%PROGRAMDATA%` vs install-relative vs config-relative.
   - Recommendation: Use `%PROGRAMDATA%\MediaSentinel\metrics.sqlite` with `db_path` config option.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Python 3.10+ | Runtime | Yes | 3.11.9 | -- |
| pip | Package install | Yes | (bundled) | -- |
| pytest | Test framework | Not installed | -- | Install as dev dependency |
| pytest-asyncio | Async tests | Not installed | -- | Install as dev dependency |
| Docker Desktop | Container mgmt (later phases) | -- | -- | Not needed for Phase 1 |

**Missing dependencies with no fallback:**
- None that block Phase 1 execution.

**Missing dependencies with fallback:**
- pytest / pytest-asyncio: Install via `pip install -e ".[dev]"` as Wave 0 task.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest 9.0.3 + pytest-asyncio 0.26.x |
| Config file | `pyproject.toml` `[tool.pytest.ini_options]` section |
| Quick run command | `pytest tests/ -x -q` |
| Full suite command | `pytest tests/ -v --tb=short` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CFG-01 | YAML config file loads into dict | unit | `pytest tests/test_config_loader.py -x` | Wave 0 |
| CFG-02 | Pydantic models validate valid config and reject invalid | unit | `pytest tests/test_config_models.py -x` | Wave 0 |
| CFG-02 | Extra fields in config raise validation error | unit | `pytest tests/test_config_models.py::test_extra_fields_rejected -x` | Wave 0 |
| CFG-03 | loguru produces structured JSON with expected fields | unit | `pytest tests/test_logging_setup.py -x` | Wave 0 |
| CFG-04 | Log files created at correct paths with rotation | unit | `pytest tests/test_logging_setup.py::test_file_sinks -x` | Wave 0 |
| CFG-05 | CLI subcommands parse arguments correctly | unit | `pytest tests/test_cli.py -x` | Wave 0 |
| CFG-05 | CLI --config flag passes path to subcommands | unit | `pytest tests/test_cli.py::test_config_flag -x` | Wave 0 |
| MET-04 | SQLite connection sets WAL mode | unit | `pytest tests/test_db_connection.py -x` | Wave 0 |
| MET-04 | Schema creates all expected tables | unit | `pytest tests/test_db_connection.py::test_schema_init -x` | Wave 0 |

### Sampling Rate
- **Per task commit:** `pytest tests/ -x -q`
- **Per wave merge:** `pytest tests/ -v --tb=short`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `tests/conftest.py` -- shared fixtures (temp config file, temp DB, loguru capture)
- [ ] `tests/test_config_models.py` -- covers CFG-02
- [ ] `tests/test_config_loader.py` -- covers CFG-01
- [ ] `tests/test_db_connection.py` -- covers MET-04
- [ ] `tests/test_logging_setup.py` -- covers CFG-03, CFG-04
- [ ] `tests/test_cli.py` -- covers CFG-05
- [ ] Framework install: `pip install pytest pytest-asyncio` -- dev dependency setup

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth in Phase 1 (config/logging/DB setup only) |
| V3 Session Management | no | No sessions in Phase 1 |
| V4 Access Control | no | No access control in Phase 1 |
| V5 Input Validation | yes | Pydantic BaseModel with `extra='forbid'`, field validators, type coercion |
| V6 Cryptography | no | No crypto in Phase 1 |

### Known Threat Patterns for Python Config/Logging Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Config file contains secrets in plaintext | Information Disclosure | Use `pydantic-settings` with `.env` file; reference secrets by name, not value, in config.yaml. Document that API keys should use env vars. |
| Log injection via user-controlled input | Tampering | loguru's `serialize=True` escapes JSON output. Avoid interpolating raw user input into log messages. |
| Path traversal in config/log paths | Tampering | Use `Path.resolve()` and validate paths stay within expected directories. Reject `..` in user-supplied paths. |
| SQLite injection via string formatting | Tampering | Use parameterized queries exclusively (`?` placeholders). Never f-string SQL values. |

## Sources

### Primary (HIGH confidence)
- Pydantic 2.x -- BaseModel, field_validator, model_validator, ConfigDict verified via Context7
- APScheduler 3.x user guide (apscheduler.readthedocs.io/en/3.x/) -- add_job(), AsyncIOScheduler, job_defaults
- PyYAML 6.0.3 -- safe_load API verified via pip registry
- aiosqlite 0.22.1 -- connect(), execute() API verified via pip registry
- loguru 0.7.3 -- serialize, bind, add() API verified via pip registry
- click 8.3.3 -- group, command, pass_context verified via pip registry

### Secondary (MEDIUM confidence)
- SQLite PRAGMA documentation (sqlite.org) -- journal_mode=WAL, synchronous=NORMAL behavior
- Python Packaging User Guide -- pyproject.toml format, [project.scripts] entry points

### Tertiary (LOW confidence)
- None -- all claims verified through primary or secondary sources.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all versions verified against pip registry on 2026-05-02
- Architecture: HIGH -- standard Python project patterns with src/ layout
- Pitfalls: HIGH -- APScheduler 3.x vs 4.x verified against official user guide

**Research date:** 2026-05-02
**Valid until:** 2026-06-01 (stable libraries, low churn expected)
