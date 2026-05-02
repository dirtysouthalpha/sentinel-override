# Roadmap: MediaSentinel

## Overview

MediaSentinel is built in 7 phases: foundation layer first (config, logging, SQLite, scheduling), then monitoring detection (health checks, VPN, tunnels), then the response layer (7-level recovery engine), then the critical safety feature (VPN-gated qBittorrent downloads), then the operator interface (TUI dashboard), then intelligence (alerting and metrics), and finally production hardening (Windows service, graceful shutdown, Docker Compose). Each phase delivers a coherent, independently verifiable capability and depends only on phases that precede it.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Foundation and Infrastructure** - Config, logging, SQLite, scheduling, and CLI backbone
- [ ] **Phase 2: Monitoring Core** - Health checks for 8 services, VPNGuard, TunnelGuard, health check scripts
- [ ] **Phase 3: Recovery Engine** - 7-level escalation hierarchy, dependency-ordered recovery, state snapshots, circuit breaker
- [ ] **Phase 4: VPN-Gated Downloads** - qBittorrent integration, download state machine, speed profiles, interface binding
- [ ] **Phase 5: TUI Dashboard** - Textual application with service status, VPN panel, recovery log, live refresh
- [ ] **Phase 6: Alerting and Metrics** - MetricsCollector agent, multi-channel alerts, throttling detection, historical trends
- [ ] **Phase 7: Hardening and Deployment** - Windows service, Docker Compose, graceful shutdown, self-watchdog

## Phase Details

### Phase 1: Foundation and Infrastructure
**Goal**: MediaSentinel has a working data backbone -- configuration is loaded and validated, logs flow to structured JSON files, SQLite stores state with concurrent-access safety, the scheduler runs health check jobs, and the operator can invoke the CLI
**Depends on**: Nothing (first phase)
**Requirements**: CFG-01, CFG-02, CFG-03, CFG-04, CFG-05, MET-04
**Success Criteria** (what must be TRUE):
  1. Operator can run `mediasentinel config` and see the loaded configuration validated with clear errors on misconfiguration
  2. Running `mediasentinel start` produces structured JSON log files in the configured log directory with timestamp, severity, component, action, and result fields
  3. SQLite database initializes with WAL mode enabled and all required tables (services, health_checks, recovery_events, metrics, state_snapshots) created on first run
  4. APScheduler starts and accepts scheduled jobs that fire at configured intervals without overlap (max_instances=1, coalesce=True)
  5. CLI subcommands start, status, logs, recover, and config all respond with help text and appropriate behavior
**Plans**: TBD

### Phase 2: Monitoring Core
**Goal**: MediaSentinel detects the health status of all 8 media stack services, verifies VPN connectivity with leak testing, and monitors Cloudflare tunnel health -- producing accurate status data that downstream recovery and UI phases can consume
**Depends on**: Phase 1
**Requirements**: MON-01, MON-02, MON-03, MON-04, VPN-01, VPN-02, VPN-03, VPN-04, VPN-05, VPN-06, TUN-01, TUN-02, TUN-03, TUN-04, DEP-04
**Success Criteria** (what must be TRUE):
  1. Each of the 8 services (Jellyfin, Jellyseerr, Radarr, Sonarr, Shoko, Prowlarr, Cloudflare Tunnels, qBittorrent) returns healthy/degraded/unhealthy status with response time and version when polled
  2. VPNGuard detects the VPN adapter via Windows adapter enumeration (not Linux interface names), verifies the external IP belongs to the VPN endpoint, and confirms DNS queries route through VPN (not ISP) via dnspython leak test
  3. TunnelGuard verifies tunnel health via round-trip URL check and Cloudflare API, and can identify when the tunnel is down vs degraded
  4. Consecutive health check failures are counted and logged, triggering a recovery-ready state after the configured threshold (default: 3)
  5. Health check wrapper scripts exist for each service and return standardized JSON output
**Plans**: TBD

### Phase 3: Recovery Engine
**Goal**: MediaSentinel can autonomously recover any failed service using the 7-level escalation hierarchy, respecting dependency ordering and preserving system state before any destructive action
**Depends on**: Phase 2
**Requirements**: REC-01, REC-02, REC-03, REC-04, REC-05, REC-06
**Success Criteria** (what must be TRUE):
  1. When a service fails its health check threshold, MediaSentinel begins at Level 1 (self-heal wait) and escalates through defined levels with configured timeouts and retry counts, reaching Level 7 (operator escalation) if all levels exhaust
  2. Recovery actions follow the dependency tree order (VPN -> Tunnels -> qBittorrent -> Jellyfin -> Prowlarr -> Radarr/Sonarr -> Jellyseerr -> Shoko), never restarting a service before its dependencies are healthy
  3. Before any Level 2+ recovery action, a JSON state snapshot is captured containing all service statuses, active downloads, and configuration state
  4. Circuit breaker prevents more than 3 recovery attempts per service within a 10-minute window
  5. Docker containers are restarted via Docker SDK and host services (cloudflared, VPN daemon) via subprocess, with both methods working correctly
**Plans**: TBD

### Phase 4: VPN-Gated Downloads
**Goal**: qBittorrent downloads run only when VPN is verified connected with no DNS or IP leaks -- downloads pause instantly on VPN drop and resume only after full verification passes
**Depends on**: Phase 3
**Requirements**: QBT-01, QBT-02, QBT-03, QBT-04, QBT-05, QBT-06, QBT-07
**Success Criteria** (what must be TRUE):
  1. qBittorrent WebAPI client connects and maintains a session with proactive re-authentication before timeout, using version-aware endpoints (v4 pause/resume vs v5 stop/start)
  2. When VPN disconnects or fails any leak test, all downloads pause immediately within one polling cycle
  3. Downloads resume only after VPN is verified connected AND both DNS leak test and IP leak test pass
  4. Speed profiles (10/50/100/100+ Mbps) can be applied with 85% bandwidth utilization and configurable connection limits
  5. On startup and periodically, qBittorrent network interface binding is verified to be the VPN adapter -- if not bound, downloads remain paused and an alert is raised
**Plans**: TBD

### Phase 5: TUI Dashboard
**Goal**: Operator has a real-time terminal dashboard showing all service statuses, VPN state, download speeds, and recovery history without leaving the terminal
**Depends on**: Phase 4
**Requirements**: TUI-01, TUI-02, TUI-03, TUI-04
**Success Criteria** (what must be TRUE):
  1. Textual TUI displays real-time status for all 8 services with color-coded health indicators (green/yellow/red) and response times, refreshing without blocking
  2. VPN status panel shows connection state, server location, current latency, and last leak test results (pass/fail) in a dedicated section
  3. Recovery event log displays timestamped entries showing what triggered recovery, what actions were taken, and what the outcome was
  4. Download speed display shows current qBittorrent throughput and active speed profile, updating in real time
**UI hint**: yes
**Plans**: TBD

### Phase 6: Alerting and Metrics
**Goal**: Operator receives timely notifications at the right severity through configured channels, and can review historical trends in service uptime, VPN stability, and download performance
**Depends on**: Phase 5
**Requirements**: ALT-01, ALT-02, ALT-03, ALT-04, MET-01, MET-02, MET-03, MET-05
**Success Criteria** (what must be TRUE):
  1. Alerts fire at 4 severity levels (INFO/WARNING/CRITICAL/EMERGENCY) with appropriate routing: INFO logs only, WARNING adds notification, CRITICAL adds recovery trigger, EMERGENCY escalates to human via all channels
  2. Multi-channel notifications deliver via SMTP email and webhook (Discord/Slack/Gotify) with diagnostic context including service state, recent recovery actions, and VPN status
  3. MetricsCollector tracks per-service uptime percentage, MTTR, failure frequency, and response time trends stored in SQLite
  4. VPN stability metrics show connection uptime, leak test result history, and latency trends over time
  5. Bandwidth throttling is detected when sustained throughput drops below 50% of the configured speed profile and an alert is raised
**Plans**: TBD

### Phase 7: Hardening and Deployment
**Goal**: MediaSentinel runs as a persistent, self-monitoring Windows service that survives restarts, shuts down gracefully, and orchestrates the entire media stack via Docker Compose with health checks
**Depends on**: Phase 6
**Requirements**: DEP-01, DEP-02, DEP-03
**Success Criteria** (what must be TRUE):
  1. MediaSentinel runs as a Windows service (or Docker container) that auto-starts with the system and survives Docker Desktop / WSL2 restarts
  2. On graceful shutdown, MediaSentinel pauses all downloads, saves a state snapshot, flushes logs, and exits cleanly -- resuming from the snapshot on next startup
  3. Docker Compose configuration includes HEALTHCHECK definitions for all containerized services with restart policies and dependency ordering
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation and Infrastructure | 0/? | Not started | - |
| 2. Monitoring Core | 0/? | Not started | - |
| 3. Recovery Engine | 0/? | Not started | - |
| 4. VPN-Gated Downloads | 0/? | Not started | - |
| 5. TUI Dashboard | 0/? | Not started | - |
| 6. Alerting and Metrics | 0/? | Not started | - |
| 7. Hardening and Deployment | 0/? | Not started | - |
