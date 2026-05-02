# Project Research Summary

**Project:** MediaSentinel
**Domain:** Home media stack monitoring, auto-recovery, and VPN-gated torrent management
**Researched:** 2026-05-02
**Confidence:** HIGH

## Executive Summary

MediaSentinel is a single-node, purpose-built monitoring and auto-recovery system for a home media stack (Jellyfin, Jellyseerr, Radarr, Sonarr, Shoko, Prowlarr, qBittorrent) running on Docker Desktop/WSL2 on Windows Server 2025, with VPN-gated torrent downloads through IPVanish and external access via Cloudflare Tunnels. No existing tool combines media-stack-aware dependency ordering, a 7-level graduated recovery hierarchy, VPN-verified download gating with DNS leak testing, and a real-time TUI dashboard into a single system. MediaSentinel fills this gap by synthesizing patterns from generic container health monitors (Docker Autoheal), VPN gateway containers (Gluetun), and media stack deployment templates into a cohesive Python application.

The recommended approach is a Supervisor-Worker architecture with an in-process event bus. A single Python process runs four agents: the Orchestrator (brain -- scheduling, recovery, dependency tree), VPNGuard (VPN verification with IP and DNS leak testing), TunnelGuard (Cloudflare tunnel health), and MetricsCollector (uptime, MTTR, trend analysis). Agents communicate through SQLite (durable state) and asyncio queues (real-time events), avoiding the overhead of network message brokers. The Textual framework provides a full interactive TUI dashboard rather than a static Rich Live display, enabling CSS-based layouts, reactive widgets, and live polling via `set_interval()`.

Key risks center on three areas: (1) the Windows/WSL2 hosting environment, which differs fundamentally from the Linux environments that most VPN and Docker tooling targets -- VPN interface detection must use PowerShell adapter enumeration, not Linux interface names; (2) qBittorrent API versioning, where v5.0 renamed pause/resume to stop/start, requiring version-aware wrappers; and (3) the critical VPN kill switch, where a superficial implementation that checks interface existence without DNS leak testing would leave the operator's traffic metadata exposed to the ISP. Each of these has a clear mitigation strategy documented in PITFALLS.md.

## Key Findings

### Recommended Stack

The stack is Python-centric, async-first, and single-node optimized. Every dependency was verified against PyPI with specific version pins. The core runtime is Python 3.11+ for TaskGroups and exception groups. Textual 8.2.5 provides the full TUI framework (not just Rich, which Textual bundles). httpx 0.28.1 replaces requests for async health checks. qbittorrent-api 2025.11.1 provides typed access to the qBittorrent WebAPI. APScheduler 3.11.2 handles scheduling (not 4.x, which is explicitly marked pre-release by upstream). The docker SDK 7.1.0 manages containers programmatically. SQLite (stdlib) with WAL mode handles all persistence without external database infrastructure.

**Core technologies:**
- **Python 3.11+:** Language runtime -- TaskGroups, exception groups, performance gains over 3.10
- **Textual 8.2.5:** TUI dashboard framework -- CSS layouts, widgets, async workers, reactive properties, live polling
- **httpx 0.28.1:** Async HTTP client -- non-blocking health checks against 8 services
- **qbittorrent-api 2025.11.1:** qBittorrent WebAPI client -- pause/resume, speed profiles, interface binding
- **APScheduler 3.11.2:** Task scheduling -- interval/cron triggers, coalesce, misfire handling (NOT 4.x)
- **docker 7.1.0:** Container management -- inspect health, restart containers, read logs
- **SQLite (stdlib) + WAL:** Persistence -- metrics, state snapshots, audit trail, zero external dependencies
- **dnspython 2.8.0:** DNS leak testing -- custom resolver queries to verify VPN DNS routing
- **psutil 7.2.2:** Network interface detection -- enumerate VPN adapters on Windows
- **pydantic 2.13.3:** Data validation -- config models, health check results, state snapshots
- **loguru 0.7.3:** Structured logging -- JSON output, rotation, retention policies
- **click 8.3.3:** CLI framework -- subcommands, options, help generation

**Version note:** STACK.md and ARCHITECTURE.md conflict on APScheduler version. STACK.md recommends 3.11.2 with HIGH confidence, citing official docs that explicitly state 4.x "do NOT use this release in production." ARCHITECTURE.md references 4.x API patterns. The 3.11.x recommendation wins -- use its API (BackgroundScheduler, add_job), not the 4.x API (Scheduler, add_schedule). Adapt the architecture patterns accordingly.

### Expected Features

Research identified 9 table-stakes features, 8 differentiators, and 10 explicit anti-features. The competitive landscape analysis confirms no single existing tool covers monitoring + recovery + VPN gating + dependency management. MediaSentinel's value is integration, not any single feature.

**Must have (table stakes):**
- **TS-1: HTTP health checks for all 8 services** -- the absolute minimum for any monitoring tool
- **TS-2: Automatic restart of unhealthy services** -- Docker restart policy only handles process crashes, not health check failures
- **TS-3: VPN connection monitoring** -- interface detection, IP verification, DNS leak testing
- **TS-4: Kill switch / download pause on VPN drop** -- non-negotiable for torrent safety; both interface binding AND API pause
- **TS-5: Service dependency ordering** -- VPN -> Tunnels -> qBittorrent -> Jellyfin -> Prowlarr -> Radarr/Sonarr -> Jellyseerr -> Shoko
- **TS-6: Real-time status display** -- Textual TUI with live-updating service status table
- **TS-7: Structured logging with audit trail** -- JSON logs with timestamp, severity, component, action, result
- **TS-8: Alerting on critical failures** -- 4 severity levels: INFO, WARNING, CRITICAL, EMERGENCY
- **TS-9: State preservation during recovery** -- snapshots before recovery, never destructive operations

**Should have (differentiators):**
- **D-1: 7-level escalation hierarchy** -- the core innovation; no existing tool has graduated recovery
- **D-2: Dependency-aware recovery** -- understands cascade effects (Prowlarr down degrades Radarr)
- **D-3: VPN verification with leak testing** -- IP leak + DNS leak, not just connectivity
- **D-4: VPN-gated download state machine** -- downloads paused until VPN fully verified
- **D-5: Speed profile auto-tuning** -- 4 profiles mapped to qBittorrent limits with 75-80% overhead factor
- **D-6: Metrics collection and trend analysis** -- uptime %, MTTR, failure patterns, VPN stability
- **D-7: TunnelGuard** -- Cloudflare tunnel health with round-trip URL verification
- **D-8: Bandwidth throttling detection** -- alert when sustained throughput drops below profile threshold

**Defer (v2+):**
- Prometheus/Grafana exporter (design metrics schema to support it)
- Multi-VPN provider support
- Web dashboard (REST API first)
- Automatic ISP speed testing
- Mobile application

### Architecture Approach

Supervisor-Worker pattern with an in-process event bus. The Orchestrator is the single authority for recovery decisions, preventing race conditions from concurrent agent actions. Workers (VPNGuard, TunnelGuard, MetricsCollector) detect and report; the Orchestrator decides and acts. Communication flows through SQLite (durable state) and asyncio queues (real-time events), not direct RPC calls between agents. All four agents run in the same Python process -- no network overhead, no message broker dependency.

**Major components:**
1. **Orchestrator (MediaSentinel Core)** -- schedules health checks via APScheduler, runs the 7-level escalation hierarchy, manages the dependency tree, dispatches alerts, renders the TUI, executes Docker/API recovery commands
2. **VPNGuard** -- detects VPN interface (Windows adapter enumeration via psutil), verifies public IP, runs DNS leak tests via dnspython, measures latency; polls every 10 seconds; does NOT restart VPN (Orchestrator's job)
3. **TunnelGuard** -- monitors Cloudflare tunnel via round-trip URL check (not /ready alone, since cloudflared has no native readiness endpoint); verifies tunnel status via Cloudflare API; polls every 30 seconds
4. **MetricsCollector** -- aggregates uptime %, MTTR, failure patterns, download speeds, VPN stability from SQLite; runs on a slower 60-second cycle; intentionally off the critical monitoring path

**Key architecture patterns:**
- **Safe default (fail closed):** If VPN status is uncertain, treat as DOWN and pause downloads. False negatives are acceptable; false positives expose the real IP.
- **Snapshot before recovery:** Capture full system state to JSON before any Level 2+ recovery action.
- **Dependency-ordered recovery:** Restart services in tree order (VPN -> Tunnels -> qBittorrent -> ...), never in isolation.
- **Write on state change only:** Do not write to SQLite on every 10-second check when nothing changed. Write on transitions and periodic samples.

### Critical Pitfalls

Top pitfalls ranked by severity and likelihood of encounter:

1. **qBittorrent v5.0 API breaking changes (Pitfall 1)** -- v5 renamed pause/resume to stop/start. If MediaSentinel uses v4 endpoint names against a v5 server, the pause call returns 404, torrents continue downloading over clear network, and no error is raised. Prevention: query `/api/v2/app/version` on startup, branch logic by major version, pin Docker image tag.

2. **Docker HEALTHCHECK does not auto-restart (Pitfall 2)** -- Adding HEALTHCHECK to Docker Compose does not cause unhealthy containers to restart. Docker restart policies only trigger on process exit codes. Prevention: implement health-check-triggered restart in MediaSentinel itself, or deploy autoheal sidecar.

3. **VPN kill switch is NOT DNS leak protection (Pitfall 3)** -- Binding qBittorrent to the VPN interface stops data traffic on VPN drop, but DNS queries may still resolve through ISP DNS servers, exposing tracker and indexer hostnames. Prevention: configure qBittorrent to use IPVanish DNS resolvers, implement DNS leak test as part of VPN health check using dnspython.

4. **Windows VPN interface detection differs from Linux (Pitfall 4)** -- Looking for `tun0` or `wg0` fails on Windows. OpenVPN creates "TAP-Windows Adapter V9", WireGuard creates "Wintun" adapters. Interface names are user-defined. Prevention: use psutil to enumerate adapters and match on InterfaceDescription patterns, not names. Cache discovered adapter but re-verify each cycle.

5. **qBittorrent session management eats itself (Pitfall 5)** -- Cookie-based sessions expire after configurable timeout (default 1 hour). Stale sessions cause silent API failures where pause/resume calls return login page HTML instead of acting. Prevention: proactive re-authentication before timeout, dedicated MediaSentinel WebUI credentials, response checking for auth redirects, CSRF header handling.

**Secondary pitfalls to track:**
- **Thundering herd during stack recovery (Pitfall 6):** Concurrent recovery of all services overwhelms the system. Prevention: dependency-ordered recovery with staggered delays, recovery locks, stabilization periods.
- **APScheduler job overlap (Pitfall 11):** Health check fires while previous recovery is still in progress. Prevention: `max_instances=1`, per-service locks, "recovery in progress" state tracking.
- **SQLite locking on Windows (Pitfall 13):** Concurrent writes fail with "database is locked." Prevention: WAL mode, batch writes, single connection with threading lock.

## Implications for Roadmap

Based on combined research from all four dimensions, the following phase structure is recommended:

### Phase 1: Foundation and Infrastructure
**Rationale:** Everything depends on state storage, scheduling, configuration, and logging. No monitoring or recovery can exist without this layer. Building it first gives the project its data backbone.
**Delivers:** SQLite schema with WAL mode, config loader with pydantic validation, structured JSON logging via loguru, APScheduler 3.11.2 setup with BackgroundScheduler, CLI entry point via click.
**Addresses:** TS-7 (structured logging), partial TS-5 (dependency tree data structure).
**Avoids:** Pitfall 13 (SQLite locking -- WAL mode from day one), Pitfall 11 (scheduler setup with coalesce and max_instances from the start).
**Stack used:** SQLite, pydantic, loguru, APScheduler, click, python-dotenv.

### Phase 2: Monitoring Core
**Rationale:** You cannot recover what you cannot detect. Health checks for all 8 services plus VPN and tunnel monitoring must be operational before any recovery logic. This phase builds the three worker agents and the Orchestrator's scheduling loop.
**Delivers:** VPNGuard (VPN interface detection, IP check, DNS leak test), TunnelGuard (round-trip URL check, Cloudflare API), Orchestrator health check scheduling loop, service health check functions for all 8 services, basic status output.
**Addresses:** TS-1 (health checks), TS-3 (VPN monitoring), D-3 (leak testing), D-7 (TunnelGuard).
**Avoids:** Pitfall 4 (Windows adapter detection from the start), Pitfall 9 (round-trip URL check instead of relying on non-existent readiness endpoint), Pitfall 3 (DNS leak test built into VPN monitoring from the start).
**Stack used:** httpx, psutil, dnspython, docker SDK, APScheduler.

### Phase 3: Recovery Engine
**Rationale:** With monitoring detecting failures, the recovery engine provides the response. This is MediaSentinel's primary differentiator. The 7-level escalation hierarchy must be built after monitoring is stable because recovery actions depend on accurate health status.
**Delivers:** Snapshot mechanism (JSON state capture before recovery), 7-level escalation hierarchy with clear triggers/timeouts/retry counts, dependency-ordered recovery following the service tree, Docker container restart via docker SDK, VPN daemon restart capability, recovery event logging.
**Addresses:** TS-2 (auto-restart), TS-5 (dependency ordering), TS-9 (state preservation), D-1 (escalation hierarchy), D-2 (dependency-aware recovery).
**Avoids:** Pitfall 6 (thundering herd -- staggered delays and recovery locks), Pitfall 2 (explicit health-check-triggered restart, not relying on Docker), Pitfall 8 (append-only snapshots, never restore from them).
**Stack used:** docker SDK, pydantic (state models), loguru.

### Phase 4: VPN-Gated Downloads
**Rationale:** The most critical safety feature. qBittorrent integration with VPN-gated state management must come after both VPN monitoring (Phase 2) and recovery (Phase 3) are working, because download pause/resume depends on accurate VPN status and the ability to recover VPN failures.
**Delivers:** qBittorrent WebAPI client via qbittorrent-api, VPN-gated download state machine (INIT -> VPN_VERIFIED -> VPN_DOWN -> VPN_RECOVERING), immediate PAUSE_ALL on VPN drop, RESUME_ALL only after full VPN verification (IP + DNS + latency), speed profile management (4 profiles with overhead factor), interface binding verification.
**Addresses:** TS-4 (kill switch), D-4 (download state machine), D-5 (speed profiles).
**Avoids:** Pitfall 1 (version-aware API wrapper for v4/v5), Pitfall 5 (session manager with proactive re-auth), Pitfall 15 (75-80% overhead factor on speed profiles).
**Stack used:** qbittorrent-api, pydantic (state machine models).

### Phase 5: TUI Dashboard
**Rationale:** With monitoring, recovery, and VPN gating operational, the Textual TUI provides the operator-facing interface. Deferred until Phase 5 because a dashboard that displays incorrect state (from broken monitoring) or cannot trigger recovery (from broken escalation) is worse than no dashboard. The TUI is a read-only view of working subsystems.
**Delivers:** Textual application with service status table, VPN status panel with state indicator, download speed display, recovery event log, live refresh via `set_interval()`, in-terminal charts via textual-plotext for bandwidth/latency trends.
**Addresses:** TS-6 (real-time status display), partial D-6 (visual metrics).
**Avoids:** Pitfall 12 (Textual's async event loop prevents blocking, unlike raw Rich Live).
**Stack used:** Textual, textual-plotext.

### Phase 6: Alerting and Metrics
**Rationale:** Alerting and long-term metrics analysis add intelligence on top of the working monitoring and recovery system. Basic logging handles alerting needs in earlier phases. Full multi-channel alerting and historical trend analysis can be built once the core system proves stable.
**Delivers:** MetricsCollector agent (uptime %, MTTR, failure patterns, download speed history, VPN stability scores), alert dispatcher with 4 severity levels, multi-channel notifications (email SMTP, webhook for Discord/Slack/Gotify, log output), bandwidth throttling detection.
**Addresses:** TS-8 (alerting), D-6 (metrics collection), D-8 (throttling detection).
**Avoids:** Pitfall 16 (log rotation and reduced verbosity during extended outages).
**Stack used:** SQLite (metrics queries), httpx (webhook calls), pydantic (alert models).

### Phase 7: Hardening and Deployment
**Rationale:** The final phase makes MediaSentinel production-ready: Windows service registration, crash recovery, graceful shutdown, Docker Compose integration with health checks, and self-monitoring.
**Delivers:** MediaSentinel as a Windows service (survives Docker Desktop restarts), graceful shutdown (pause downloads, save state, flush logs), crash recovery (resume from last snapshot), Docker Compose health check definitions for all services, self-watchdog (MediaSentinel monitors its own process health), configuration validation and documentation.
**Avoids:** Pitfall 14 (Windows service ensures MediaSentinel survives WSL2 restarts and orchestrates recovery), Pitfall 10 (depends_on with service_healthy conditions in Compose).
**Stack used:** docker SDK, click, pydantic.

### Phase Ordering Rationale

- **Foundation first** because every other phase writes to SQLite, reads config, and logs via loguru. No exceptions.
- **Monitoring before recovery** because escalation decisions require accurate health data. Building recovery first would mean testing against fake data.
- **Recovery before qBittorrent** because qBittorrent's state machine depends on VPN recovery working. If VPN goes down and cannot be recovered, downloads must stay paused.
- **TUI after core is working** because the dashboard is a read-only view. Building it first creates the temptation to mock data and never replace the mocks.
- **Metrics last among feature phases** because basic logging covers the need until the system stabilizes. Historical trends are valuable only after the system has been running.
- **Hardening is the capstone** because crash recovery and service registration only matter once the system is worth running.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 2 (Monitoring Core):** VPN interface detection on Windows Server 2025 needs hands-on validation with the actual IPVanish installation. Adapter names and descriptions may differ from documented examples. The cloudflared `/ready` endpoint port and availability should be verified against the actual running instance.
- **Phase 4 (VPN-Gated Downloads):** The qBittorrent version deployed in Docker needs to be checked. If it is v5.x, the API wrapper must use stop/start terminology. Session timeout behavior should be tested empirically. Interface binding behavior on Windows Docker may differ from Linux documentation.
- **Phase 7 (Hardening):** Windows service registration for a Python application requires specific tooling (pywin32, NSSM, or pythoncom). The exact approach needs validation against Windows Server 2025.

Phases with standard patterns (skip research-phase):
- **Phase 1 (Foundation):** SQLite schema design, pydantic models, loguru setup, APScheduler configuration -- all well-documented with established patterns.
- **Phase 3 (Recovery Engine):** Dependency-ordered restart is a straightforward implementation of the tree from FEATURES.md. Escalation levels are clearly defined.
- **Phase 5 (TUI Dashboard):** Textual provides extensive documentation with working examples for tables, panels, and live refresh.
- **Phase 6 (Alerting):** SMTP email and webhook notifications are standard integrations.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All 12 dependencies verified on PyPI with specific version pins. Version conflicts resolved (APScheduler 3.x over 4.x). Every alternative considered and rejected with documented rationale. |
| Features | HIGH | 9 table-stakes features sourced from competitive analysis (Autoheal, Uptime Kuma, Gluetun). 8 differentiators mapped to specific API endpoints and libraries. 10 anti-features prevent scope creep. Feature dependency graph is clean (linear, no DAGs). |
| Architecture | HIGH | Supervisor-Worker with event bus is a proven pattern. Component boundaries are clear with single-responsibility agents. The architecture is opinionated (Orchestrator is the brain, workers only report) which avoids coordination complexity. One gap: ARCHITECTURE.md references APScheduler 4.x API which contradicts STACK.md's 3.x recommendation. |
| Pitfalls | HIGH | 16 pitfalls identified with specific prevention strategies. 6 critical pitfalls address the most dangerous failure modes (silent VPN failure, API version mismatch, session expiration). Phase-specific warnings map directly to the suggested roadmap phases. |

**Overall confidence:** HIGH

### Gaps to Address

- **APScheduler API version mismatch:** STACK.md (v3.11.2, HIGH confidence, verified production-ready) conflicts with ARCHITECTURE.md (v4.x patterns). Resolution: use APScheduler 3.11.2 with BackgroundScheduler/add_job API, not the 4.x Scheduler/add_schedule API. Adapt architecture code examples during implementation.
- **Windows-specific VPN adapter behavior:** Research identified that OpenVPN uses "TAP-Windows Adapter V9" and WireGuard uses "Wintun" on Windows, but the exact adapter description strings on Windows Server 2025 with the specific IPVanish installation need empirical validation during Phase 2.
- **qBittorrent installed version unknown:** The Docker image tag for qBittorrent determines whether to use v4 API (pause/resume) or v5 API (stop/start). This must be checked before Phase 4 implementation. The qbittorrent-api library may handle this transparently, but the startup version detection safety check should still be implemented.
- **cloudflared metrics/ready endpoint availability:** Research indicates cloudflared may expose `/ready` on port 9100, but this needs verification against the actual running cloudflared instance. The fallback (round-trip URL check) is documented and should work regardless.
- **MediaSentinel as Windows service:** The mechanism for registering a Python application as a Windows service on Server 2025 needs investigation. Options include pywin32, NSSM, or Windows Task Scheduler. This affects Phase 7 only.

## Sources

### Primary (HIGH confidence)
- Context7 /textualize/textual -- Textual framework capabilities, worker API, reactive properties, set_interval
- Context7 /rmartin16/qbittorrent-api -- Full WebAPI coverage, pause/resume, speed limits, interface binding
- Context7 /agronholm/apscheduler -- APScheduler 3.x API, production version guidance (4.x pre-release warning)
- PyPI verification for all 12 dependencies with specific version numbers
- qBittorrent WebUI API official GitHub Wiki -- endpoint documentation
- Docker SDK official documentation (docker-py.readthedocs.io) -- container management API
- Docker Compose v2 specification -- depends_on with health conditions
- Cloudflare Tunnel official documentation -- monitoring patterns
- Docker HEALTHCHECK documentation -- gap between health status and restart policy

### Secondary (MEDIUM confidence)
- Gluetun GitHub/Context7 -- VPN health check patterns, DNS leak testing approaches
- Docker Autoheal documentation -- container restart on unhealthy patterns
- qBittorrent interface binding community guides -- kill switch implementation
- Cloudflare community/Reddit -- cloudflared /ready endpoint verification
- Windows Get-NetAdapter documentation -- VPN adapter enumeration approach
- Reddit r/selfhosted -- homelab monitoring patterns and tool combinations
- Rich/Textual documentation -- TUI dashboard rendering approaches

### Tertiary (LOW confidence)
- Reddit r/VPN -- automated DNS leak testing scripts (community pattern, needs validation)
- VPN leak testing via ipleak.net -- approach for IP/DNS verification (external service dependency)
- Docker Desktop WSL2 restart behavior -- community reports, varies by version

---
*Research completed: 2026-05-02*
*Ready for roadmap: yes*
