# Technology Stack

**Project:** MediaSentinel -- Media monitoring and auto-recovery system with VPN-gated torrent management
**Researched:** 2026-05-02
**Mode:** Ecosystem (Stack dimension)

## Recommended Stack

### Language Runtime

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Python | 3.11+ | Primary language | Best async support (3.11+ has exception groups, task groups, significant performance gains over 3.10). Windows support is first-class. Matches the project's existing constraints. |

**Confidence: HIGH** -- Verified via PyPI package compatibility matrix and project constraints.

---

### TUI Dashboard Framework

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Textual | 8.2.5 | Full TUI dashboard application | Textual is built *on top of* Rich and adds a complete application framework: CSS-based layouts, widget composition, async workers, reactive properties, `set_interval()` for live polling, and DataTable/Sparkline/ProgressBar widgets. It is purpose-built for real-time terminal dashboards. Rich alone is insufficient because it only handles output rendering, not interaction or layout management. |
| Rich | 15.0.0 (transitive) | Terminal rendering (pulled in by Textual) | Rich is a dependency of Textual. Used for formatted console output in non-TUI contexts (CLI help, log formatting, one-off status messages). Do not install separately -- Textual pulls it in. |
| textual-plotext | 1.0.1 | In-terminal charts for bandwidth/speed graphs | Official Textual widget wrapping Plotext. Use for rendering historical bandwidth graphs, VPN latency over time, and download speed trends directly in the TUI without external dependencies. |

**Confidence: HIGH** -- Textual 8.2.5 verified on PyPI (current latest). Rich 15.0.0 verified on PyPI. Context7 documentation confirms worker API, `set_interval()`, and reactive properties for live dashboards.

**Why NOT use alternatives:**
- **Rich alone:** No layout engine, no event loop, no widgets. Fine for static output but fundamentally incapable of building an interactive dashboard. The project needs live-updating service status tables, VPN state indicators, and download speed readouts that refresh every few seconds.
- **curses/urwid:** Legacy, no async support, painful cross-platform (especially Windows), no CSS layout, no widget ecosystem. Textual exists specifically to replace these.
- **asciimatics:** More suited for demos/games than production dashboards. Less maintained than Textual.

---

### HTTP Client

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| httpx | 0.28.1 | Health checks, API calls, DNS leak tests | Async-first HTTP client with HTTP/2 support. Supports async/await natively (critical for non-blocking health checks against 8 services). Connection pooling and timeouts built in. Replaces `requests` for the main monitoring loop because MediaSentinel runs in an async context (Textual event loop + health check polling). |

**Confidence: HIGH** -- httpx 0.28.1 verified on PyPI (already installed on system). Well-established library, standard choice for async Python.

**Why NOT `requests`:**
`requests` is synchronous. Using it inside Textual's async event loop would block the UI on every health check. Use `httpx` with `async/await` instead. `requests` can still be used for simple synchronous CLI utilities if needed, but the core monitoring engine must be async.

---

### qBittorrent Integration

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| qbittorrent-api | 2025.11.1 | qBittorrent WebAPI client | The only maintained, full-coverage Python client for qBittorrent Web API. Supports qBittorrent v4.1+ through v5.1.4 (Web API v2.11.4). Provides typed access to torrents (pause/resume/info), transfer settings (speed limits, interface binding), and application preferences. Handles authentication, session management, and API version negotiation automatically. |

**Confidence: HIGH** -- Version 2025.11.1 verified on PyPI. Context7 documentation confirms full endpoint coverage including `torrents_pause()`, `torrents_resume()`, `torrents_info()`, and transfer speed limit management. Supports the exact operations MediaSentinel needs for VPN-dependent download state management.

**Key capabilities for MediaSentinel:**
- `client.torrents_pause(torrent_hashes='all')` -- Pause all downloads when VPN drops
- `client.torrents_resume(torrent_hashes='all')` -- Resume when VPN verified
- `client.torrents_info()` -- Enumerate active torrents and their states
- `client.transfer_info()` -- Current download/upload speeds for dashboard
- `client.app_preferences()` -- Read/modify qBittorrent settings (interface binding, speed profiles)
- `client.transfer_set_download_limit()` / `client.transfer_set_upload_limit()` -- Speed profile switching

---

### Task Scheduling

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| APScheduler | 3.11.2 | Health check polling intervals, scheduled tasks | Production-stable cron/interval scheduler. APScheduler 3.x is the recommended production version. APScheduler 4.x is explicitly marked pre-release and NOT for production use per official docs. Provides BackgroundScheduler for running alongside Textual's event loop, interval triggers for 10-second VPN checks and variable-interval service polling, and cron triggers for daily reports/maintenance. |

**Confidence: HIGH** -- APScheduler 3.11.2 verified on PyPI. APScheduler 4.x pre-release status confirmed via official documentation: "The v4.0 series is provided as a pre-release... do NOT use this release in production."

**Why NOT APScheduler 4.x:**
Official docs explicitly warn against production use. API is subject to breaking changes with no migration path. Stick with 3.11.2.

**Why NOT alternatives:**
- **Celery:** Massive overkill for a single-node monitoring system. Requires a message broker (Redis/RabbitMQ). Adds complexity with no benefit.
- **Pure asyncio tasks:** No persistence, no cron expressions, no built-in error handling/retry. APScheduler gives structured scheduling with job stores, executors, and triggers for free.

---

### Docker Orchestration

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| docker | 7.1.0 | Programmatic container management | Official Docker SDK for Python. Inspect container health status, restart containers, manage Compose stacks, and read container logs. Key methods: `container.attrs['State']['Health']['Status']` for health inspection, `container.restart()` for recovery, `client.containers.list()` for inventory. Works with Docker Desktop on Windows. |

**Confidence: HIGH** -- docker 7.1.0 verified on PyPI. Official Docker-maintained library. Well-documented at docker-py.readthedocs.io.

**Key capabilities for MediaSentinel:**
- `client.containers.list(filters={"name": "jellyfin"})` -- Find specific service containers
- `container.attrs['State']['Health']['Status']` -- Read Docker health check results
- `container.restart()` -- Level 2 recovery (soft restart)
- `client.compose.up()` / `client.compose.restart()` -- Level 4 recovery (stack reset)
- `container.logs(tail=50)` -- Diagnostic log extraction before recovery
- `container.stats(stream=False)` -- Resource usage metrics

---

### DNS Resolution / VPN Leak Detection

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| dnspython | 2.8.0 | DNS queries for leak testing | The standard Python DNS toolkit. Used for DNS leak tests: resolve known test domains through the VPN tunnel interface and verify responses come from expected DNS servers (not ISP). Supports custom resolver configuration, timeout control, and all record types. |

**Confidence: HIGH** -- dnspython 2.8.0 verified on PyPI. Actively maintained by Bob Halley. Version 2.5+ requires Python 3.8+, compatible with project's 3.11+ requirement.

---

### Network Interface Detection

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| psutil | 7.2.2 | Network interface enumeration, process monitoring | Cross-platform system monitoring library. `psutil.net_if_addrs()` enumerates all network interfaces (including VPN tunnel adapters). `psutil.net_if_stats()` provides interface status (up/down, speed). Also used for system resource monitoring (CPU, memory, disk) to track MediaSentinel's own footprint. Already installed on this system. |

**Confidence: HIGH** -- psutil 7.2.2 verified on PyPI (already installed). Standard library for system monitoring in Python.

**Why NOT netifaces/netifaces-plus:**
On Windows, VPN adapters appear as regular network interfaces with descriptive names (e.g., "Wintun Tunnel", "OpenVPN TAP-Windows", "WireGuard Tunnel"). `psutil.net_if_addrs()` returns these with addresses, which is exactly what we need. `netifaces` is deprecated (last update 2020) and its C extension can have build issues on Windows. `netifaces2` and `netifaces-plus` are community forks with uncertain maintenance. psutil already installed, already provides this capability, and avoids adding a dependency.

---

### Data Validation / Configuration Models

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| pydantic | 2.13.3 | Configuration validation, data models | Type-safe models for service configurations, health check results, VPN status objects, recovery state snapshots, and alert definitions. Pydantic v2 provides 5-50x performance improvement over v1 with Rust core. JSON schema generation for config documentation. Already installed on this system. |

**Confidence: HIGH** -- pydantic 2.13.3 verified on PyPI (already installed). Industry standard for Python data validation.

**Why NOT dataclasses/mashumaro:**
Pydantic provides validation, serialization, and JSON schema generation out of the box. dataclasses are fine for simple cases but lack validation and serialization. For a monitoring system with many configuration files and structured state snapshots, validation at load time prevents runtime errors.

---

### Logging

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| loguru | 0.7.3 | Structured logging with rotation | Zero-configuration logging with structured output, automatic rotation, retention policies, and exception formatting. Simpler API than stdlib `logging` (no handler/formatter boilerplate). Supports JSON serialization for audit trail. Drop-in replacement that handles all log routing in one line. |

**Confidence: HIGH** -- loguru 0.7.3 verified on PyPI. Widely adopted, actively maintained.

**Why NOT stdlib `logging`:**
stdlib `logging` requires extensive configuration (handlers, formatters, filters, loggers) to achieve what loguru does by default. For a monitoring system that needs structured JSON logs, rotation, and severity-based routing, loguru eliminates boilerplate and reduces configuration errors.

---

### CLI Framework

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| click | 8.3.3 | CLI entry point and commands | Standard CLI framework for Python. Used for `mediasentinel dashboard`, `mediasentinel status`, `mediasentinel recover <service>`, `mediasentinel vpn-check`, and other operator commands. Supports subcommands, options, and help text generation. |

**Confidence: HIGH** -- click 8.3.3 verified on PyPI. Most widely used Python CLI framework.

**Why NOT argparse:**
click provides decorator-based command definition, automatic help generation, type validation, and subcommand groups. argparse requires manual argument parsing boilerplate. For a tool with multiple subcommands, click is cleaner.

**Why NOT typer:**
typer adds a dependency layer on top of click. It is fine for simple CLIs but adds no value for MediaSentinel's use case. click is more direct and has better documentation for complex command hierarchies.

---

### Database

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| SQLite (stdlib) | Python 3.11+ built-in | Metrics storage, state snapshots, audit trail | Zero-dependency embedded database. Python's `sqlite3` module is in the standard library. Sufficient for single-node monitoring data. Use with a thin wrapper for connection management and schema migrations. |

**Confidence: HIGH** -- SQLite is part of Python stdlib. No installation needed.

**Why NOT PostgreSQL/Redis:**
MediaSentinel is a single-node monitoring system. SQLite handles concurrent reads well (WAL mode) and write load is minimal (metrics every 10-60 seconds). Adding PostgreSQL or Redis would be infrastructure overhead with no benefit. The project explicitly scoped out external database dependencies.

---

### Async Runtime

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| asyncio | stdlib | Async event loop | Python 3.11+ stdlib. Textual runs on asyncio. All health checks, VPN monitoring, and qBittorrent API calls should be async to avoid blocking the TUI. Use `asyncio.TaskGroup` (3.11+) for structured concurrency in the monitoring loop. |

**Confidence: HIGH** -- Part of Python stdlib since 3.4, with major improvements in 3.11.

---

## Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| aiofiles | latest | Async file I/O | Reading/writing config files and state snapshots without blocking the event loop |
| python-dotenv | latest | Environment variable loading | Loading `.env` files for qBittorrent credentials, VPN config paths, and API keys |
| asyncio | stdlib | Task scheduling primitives | `asyncio.create_task()`, `asyncio.gather()`, `asyncio.wait_for()` for concurrent health checks |

---

## Infrastructure

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Docker Desktop | latest | Container runtime for media services | Already running on SENTINEL-CORE. Manages Jellyfin, Jellyseerr, Radarr, Sonarr, Shoko, Prowlarr, qBittorrent containers. |
| Docker Compose | v2 (bundled) | Service stack definition | Define the entire media stack with health checks, restart policies, dependency ordering, and VPN network binding. Already available with Docker Desktop. |
| IPVanish (OpenVPN/WireGuard) | N/A | VPN provider | Required by project constraints. WireGuard preferred for lower latency; OpenVPN as fallback. Daemon runs on host (not in Docker) for interface binding. |
| cloudflared | latest | Cloudflare Tunnel daemon | Runs on host for external access to Jellyfin/Jellyseerr. TunnelGuard agent monitors and recovers this. |

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| TUI Framework | Textual 8.2.5 | Rich only | No layout engine, no widgets, no event loop. Only handles output rendering. |
| TUI Framework | Textual 8.2.5 | curses/urwid | Legacy, painful Windows support, no async, no modern widget ecosystem. |
| TUI Framework | Textual 8.2.5 | asciimatics | Demo/game oriented, less maintained, no CSS layout system. |
| HTTP Client | httpx 0.28.1 | requests | Synchronous. Would block Textual's async event loop during health checks. |
| HTTP Client | httpx 0.28.1 | aiohttp 3.13.5 | Larger footprint, more complex API. httpx is simpler and sufficient for health check GET requests. aiohttp would be justified if building a web server, not a client. |
| Scheduler | APScheduler 3.11.2 | APScheduler 4.x | Official docs say "do NOT use this release in production." Pre-release status. |
| Scheduler | APScheduler 3.11.2 | Celery | Requires message broker (Redis/RabbitMQ). Massive overkill for single-node scheduling. |
| Scheduler | APScheduler 3.11.2 | Pure asyncio tasks | No persistence, no cron expressions, no structured error handling. |
| qBittorrent Client | qbittorrent-api 2025.11.1 | Raw HTTP calls to WebAPI | No typed access, no auth management, no version negotiation. Reimplementing what qbittorrent-api already provides. |
| Network Detection | psutil 7.2.2 | netifaces | Deprecated (last update 2020), C extension build issues on Windows. psutil already provides `net_if_addrs()`. |
| Network Detection | psutil 7.2.2 | netifaces2/netifaces-plus | Community forks with uncertain maintenance. psutil is battle-tested and already installed. |
| Validation | pydantic 2.13.3 | dataclasses | No validation, no serialization, no JSON schema. Fine for simple data, insufficient for validated config loading. |
| Database | SQLite (stdlib) | PostgreSQL | Infrastructure overhead, external dependency. Single-node system does not need it. |
| Database | SQLite (stdlib) | Redis | Overkill for metrics storage. No persistence requirement that Redis would solve. |
| Logging | loguru 0.7.3 | stdlib logging | Requires extensive handler/formatter configuration for structured JSON output. loguru does this by default. |
| CLI | click 8.3.3 | argparse | More boilerplate for subcommand groups and option handling. |
| CLI | click 8.3.3 | typer | Additional dependency layer on top of click. No value added for this use case. |

---

## Installation

```bash
# Core dependencies
pip install textual==8.2.5
pip install httpx==0.28.1
pip install qbittorrent-api==2025.11.1
pip install apscheduler==3.11.2
pip install docker==7.1.0
pip install dnspython==2.8.0
pip install psutil==7.2.2
pip install pydantic==2.13.3
pip install loguru==0.7.3
pip install click==8.3.3

# Supporting
pip install textual-plotext==1.0.1
pip install aiofiles
pip install python-dotenv

# Or all at once
pip install \
  textual==8.2.5 \
  httpx==0.28.1 \
  qbittorrent-api==2025.11.1 \
  apscheduler==3.11.2 \
  docker==7.1.0 \
  dnspython==2.8.0 \
  psutil==7.2.2 \
  pydantic==2.13.3 \
  loguru==0.7.3 \
  click==8.3.3 \
  textual-plotext==1.0.1 \
  aiofiles \
  python-dotenv
```

---

## Sources

- Textual: Context7 docs (/textualize/textual), PyPI verified v8.2.5 -- https://pypi.org/project/textual/
- Rich: PyPI verified v15.0.0 -- https://pypi.org/project/rich/
- textual-plotext: PyPI verified v1.0.1 -- https://pypi.org/project/textual-plotext/
- httpx: PyPI verified v0.28.1 -- https://pypi.org/project/httpx/
- qbittorrent-api: Context7 docs (/rmartin16/qbittorrent-api), PyPI verified v2025.11.1 -- https://pypi.org/project/qbittorrent-api/
- APScheduler: Context7 docs (/agronholm/apscheduler), PyPI verified v3.11.2, official docs confirm 4.x is pre-release -- https://apscheduler.readthedocs.io/
- docker: PyPI verified v7.1.0 -- https://pypi.org/project/docker/
- dnspython: PyPI verified v2.8.0 -- https://pypi.org/project/dnspython/
- psutil: PyPI verified v7.2.2 -- https://pypi.org/project/psutil/
- pydantic: PyPI verified v2.13.3 -- https://pypi.org/project/pydantic/
- loguru: PyPI verified v0.7.3 -- https://pypi.org/project/loguru/
- click: PyPI verified v8.3.3 -- https://pypi.org/project/click/
- Textual Workers guide: https://textual.textualize.io/guide/workers/
- Docker SDK docs: https://docker-py.readthedocs.io/en/stable/containers.html
- APScheduler version warning: https://apscheduler.readthedocs.io/en/master/versionhistory.html
