# Requirements: MediaSentinel

**Defined:** 2026-05-02
**Core Value:** 24/7 autonomous uptime for the entire media stack with zero-tolerance VPN enforcement for torrent downloads

## v1 Requirements

### Health Monitoring

- [ ] **MON-01**: System polls HTTP health endpoints for all 8 services (Jellyfin, Jellyseerr, Radarr, Sonarr, Shoko, Prowlarr, Cloudflare Tunnels, qBittorrent) with configurable intervals
- [ ] **MON-02**: Each health check returns standardized status (healthy/degraded/unhealthy) with response time, version, and dependency status
- [ ] **MON-03**: Critical services (Jellyfin, VPN) polled every 15 seconds; non-critical services every 30 seconds
- [ ] **MON-04**: Health check failures trigger recovery after configurable consecutive failure threshold (default: 3)

### VPN Monitoring

- [ ] **VPN-01**: VPNGuard detects VPN interface via Windows adapter enumeration (psutil), not Linux interface names
- [ ] **VPN-02**: Verifies VPN connection by checking adapter status, assigned IP, and external IP match
- [ ] **VPN-03**: Performs DNS leak test via dnspython to verify DNS queries route through VPN, not ISP
- [ ] **VPN-04**: Performs IP leak test to verify external IP belongs to VPN endpoint, not real IP
- [ ] **VPN-05**: Measures VPN connection latency and reports degradation
- [ ] **VPN-06**: Polls VPN status every 10 seconds with state transitions logged

### Recovery Engine

- [ ] **REC-01**: Implements 7-level escalation hierarchy: self-heal, soft restart, dependency recovery, stack reset, VPN recovery, network recovery, operator escalation
- [ ] **REC-02**: Each escalation level has defined triggers, timeouts, retry counts, and automatic escalation to next level
- [ ] **REC-03**: Dependency-ordered recovery follows tree: VPN -> Tunnels -> qBittorrent -> Jellyfin -> Prowlarr -> Radarr/Sonarr -> Jellyseerr -> Shoko
- [ ] **REC-04**: State snapshot captured as JSON before every Level 2+ recovery action
- [ ] **REC-05**: Circuit breaker prevents more than 3 recovery attempts in 10 minutes per service
- [ ] **REC-06**: Recovery actions use Docker SDK for containers, subprocess for host services (cloudflared, VPN daemon)

### qBittorrent Integration

- [ ] **QBT-01**: WebAPI client connects to qBittorrent via qbittorrent-api with proactive session re-authentication
- [ ] **QBT-02**: VPN-gated download state machine: INIT -> VPN_VERIFIED -> VPN_DOWN -> VPN_RECOVERING with safe-default (fail closed)
- [ ] **QBT-03**: Immediately pauses all downloads when VPN disconnects or fails leak tests
- [ ] **QBT-04**: Resumes downloads only after VPN is verified connected AND DNS/IP leak tests pass
- [ ] **QBT-05**: Version-aware API wrapper handles qBittorrent v4 (pause/resume) and v5 (stop/start) endpoint differences
- [ ] **QBT-06**: 4 speed profiles (10/50/100/100+ Mbps) with 85% bandwidth utilization and configurable connection limits
- [ ] **QBT-07**: Verifies qBittorrent network interface binding to VPN adapter on startup and periodically

### Cloudflare Tunnel Monitoring

- [ ] **TUN-01**: TunnelGuard monitors tunnel health via round-trip URL verification (not /ready endpoint alone)
- [ ] **TUN-02**: Verifies tunnel status via Cloudflare API v4
- [ ] **TUN-03**: Restarts cloudflared daemon on tunnel failure and verifies reconnection within 30 seconds
- [ ] **TUN-04**: DNS validation confirms CNAME records point to active tunnel

### Dashboard

- [ ] **TUI-01**: Textual TUI dashboard displays real-time status for all services, VPN state, and download speeds
- [ ] **TUI-02**: Dashboard auto-refreshes via Textual's set_interval with no blocking operations
- [ ] **TUI-03**: Displays recovery event log with timestamps, actions taken, and outcomes
- [ ] **TUI-04**: Shows VPN status panel with connection state, server location, latency, and leak test results

### Alerting

- [ ] **ALT-01**: 4 severity levels: INFO (log), WARNING (log + notification), CRITICAL (log + notification + recovery), EMERGENCY (all channels + human escalation)
- [ ] **ALT-02**: Multi-channel notifications: email (SMTP), webhook (Discord/Slack/Gotify), structured log output
- [ ] **ALT-03**: Alert includes diagnostic context: service state, recent recovery actions, resource usage, VPN status
- [ ] **ALT-04**: Configurable escalation rules per severity level with recipient routing

### Metrics and Observability

- [ ] **MET-01**: MetricsCollector agent tracks per-service uptime %, MTTR, failure frequency, response time trends
- [ ] **MET-02**: Tracks VPN connection stability: uptime, leak test results over time, latency trends
- [ ] **MET-03**: Tracks qBittorrent download throughput over time and speed profile effectiveness
- [ ] **MET-04**: Stores all metrics in SQLite with WAL mode for concurrent access
- [ ] **MET-05**: Detects bandwidth throttling when sustained throughput drops below 50% of configured speed profile

### Configuration and Logging

- [ ] **CFG-01**: YAML configuration file defines service URLs, API keys, check intervals, recovery thresholds, alert recipients
- [ ] **CFG-02**: Pydantic-validated config models with clear error messages on misconfiguration
- [ ] **CFG-03**: Structured JSON logging via loguru with timestamp, severity, component, action, result fields
- [ ] **CFG-04**: All health checks logged to /var/log/mediasentinel/health.log, recoveries to recovery.log
- [ ] **CFG-05**: CLI entry point via click with subcommands: start, status, logs, recover, config

### Deployment

- [ ] **DEP-01**: Docker Compose configuration with HEALTHCHECK definitions for all containerized services
- [ ] **DEP-02**: MediaSentinel runs as persistent process (Windows service or Docker container) with auto-restart
- [ ] **DEP-03**: Graceful shutdown preserves state: pauses downloads, saves snapshot, flushes logs
- [ ] **DEP-04**: Health check wrapper scripts in /opt/healthchecks/ for each service returning standardized JSON

## v2 Requirements

### Advanced Monitoring

- **MON-05**: Prometheus metrics exporter on /metrics endpoint for Grafana integration
- **MET-06**: Daily/weekly health reports generated automatically
- **MET-07**: Predictive maintenance alerts (e.g., "memory trending up, restart likely needed in 6 hours")

### Advanced VPN

- **VPN-07**: Multi-VPN provider support via provider interface abstraction
- **QBT-08**: Automatic ISP speed test integration for dynamic profile selection
- **QBT-09**: Automatic VPN server selection based on latency testing

### Advanced Deployment

- **DEP-05**: Web REST API for integration with external dashboards (Homepage, Homarr)
- **DEP-06**: Firewall-level kill switch via Windows Firewall rules (defense in depth beyond interface binding)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Web GUI / full dashboard | Uptime Kuma, Homepage, Homarr already do this. TUI sufficient for v1. |
| Multi-user access control | Single-operator homeserver. RBAC is unnecessary complexity. |
| Mobile application | Webhook-based notifications to mobile push services (Gotify, ntfy.sh) cover alerting needs. |
| Auto-update services | Watchtower exists for this. Monitoring tools should not be update managers. |
| Log aggregation / SIEM | Loki, ELK, Graylog exist. Structured logs should be consumable by them, not replace them. |
| Media library management | Radarr, Sonarr, Jellyseerr handle this. MediaSentinel monitors, not manages. |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| MON-01 | Phase 2 | Pending |
| MON-02 | Phase 2 | Pending |
| MON-03 | Phase 2 | Pending |
| MON-04 | Phase 2 | Pending |
| VPN-01 | Phase 2 | Pending |
| VPN-02 | Phase 2 | Pending |
| VPN-03 | Phase 2 | Pending |
| VPN-04 | Phase 2 | Pending |
| VPN-05 | Phase 2 | Pending |
| VPN-06 | Phase 2 | Pending |
| REC-01 | Phase 3 | Pending |
| REC-02 | Phase 3 | Pending |
| REC-03 | Phase 3 | Pending |
| REC-04 | Phase 3 | Pending |
| REC-05 | Phase 3 | Pending |
| REC-06 | Phase 3 | Pending |
| QBT-01 | Phase 4 | Pending |
| QBT-02 | Phase 4 | Pending |
| QBT-03 | Phase 4 | Pending |
| QBT-04 | Phase 4 | Pending |
| QBT-05 | Phase 4 | Pending |
| QBT-06 | Phase 4 | Pending |
| QBT-07 | Phase 4 | Pending |
| TUN-01 | Phase 2 | Pending |
| TUN-02 | Phase 2 | Pending |
| TUN-03 | Phase 2 | Pending |
| TUN-04 | Phase 2 | Pending |
| TUI-01 | Phase 5 | Pending |
| TUI-02 | Phase 5 | Pending |
| TUI-03 | Phase 5 | Pending |
| TUI-04 | Phase 5 | Pending |
| ALT-01 | Phase 6 | Pending |
| ALT-02 | Phase 6 | Pending |
| ALT-03 | Phase 6 | Pending |
| ALT-04 | Phase 6 | Pending |
| MET-01 | Phase 6 | Pending |
| MET-02 | Phase 6 | Pending |
| MET-03 | Phase 6 | Pending |
| MET-04 | Phase 1 | Pending |
| MET-05 | Phase 6 | Pending |
| CFG-01 | Phase 1 | Pending |
| CFG-02 | Phase 1 | Pending |
| CFG-03 | Phase 1 | Pending |
| CFG-04 | Phase 1 | Pending |
| CFG-05 | Phase 1 | Pending |
| DEP-01 | Phase 7 | Pending |
| DEP-02 | Phase 7 | Pending |
| DEP-03 | Phase 7 | Pending |
| DEP-04 | Phase 2 | Pending |

**Coverage:**
- v1 requirements: 49 total
- Mapped to phases: 49
- Unmapped: 0 ✓

---
*Requirements defined: 2026-05-02*
*Last updated: 2026-05-02 after initial definition*
