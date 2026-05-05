# MediaSentinel

## What This Is

MediaSentinel is an intelligent monitoring and auto-recovery system for a home media stack. It monitors 8 services (Jellyfin, Jellyseerr, Radarr, Sonarr, Shoko, Prowlarr, Cloudflare Tunnels, qBittorrent), automatically detects failures, and recovers them using a dependency-aware 7-level escalation hierarchy. It enforces VPN-gated torrent downloading — qBittorrent runs continuously but only downloads when IPVanish VPN is verified connected with no DNS/IP leaks.

## Core Value

24/7 autonomous uptime for the entire media stack with zero-tolerance VPN enforcement for torrent downloads. If a service goes down, it recovers itself. If VPN drops, downloads pause instantly.

## Current State

**Shipped:** v1.0 MVP — 2026-05-04
- 7 phases, 267 tests passing
- 4,291 LOC Python (src), 3,921 LOC (tests)
- Full monitoring, recovery, VPN enforcement, TUI, alerting, and deployment pipeline
- Running as Windows service via NSSM or Docker Compose

## Requirements

### Validated

- Monitor 8 media stack services via HTTP health checks with dependency-aware polling intervals — v1.0
- 7-level auto-recovery hierarchy (self-heal through operator escalation) — v1.0
- IPVanish VPN monitoring with DNS leak test, IP leak test, latency checks every 10 seconds — v1.0
- qBittorrent WebAPI integration — VPN-dependent download state machine — v1.0
- qBittorrent speed optimization — 4 profiles with 85% bandwidth utilization — v1.0
- Cloudflare tunnel monitoring and recovery (TunnelGuard agent) — v1.0
- Dependency tree startup/recovery ordering — v1.0
- Real-time TUI dashboard — v1.0
- Alerting with 4 severity levels across multiple channels — v1.0
- State snapshots before every recovery attempt — v1.0
- Metrics collection (uptime %, MTTR, failure patterns, download speeds, VPN stability) — v1.0
- Structured JSON logging with audit trail — v1.0
- Docker Compose configuration with health checks, restart policies — v1.0
- Health check wrapper scripts for each service — v1.0
- Bandwidth monitoring with throttling detection and auto-scaling — v1.0
- Windows service wrapper (NSSM + Task Scheduler fallback) — v1.0
- Graceful shutdown with state snapshot persistence — v1.0

### Active

(None — awaiting v1.1+ planning)

### Out of Scope

- Mobile application — CLI/TUI and web dashboard sufficient
- Multi-user access control — single operator system
- Prometheus/Grafana integration — defer to v2, SQLite metrics sufficient for v1
- Kill switch at firewall level — qBittorrent interface binding sufficient for v1
- Automatic ISP speed testing — manual configuration with speed profiles
- Multi-VPN provider support — IPVanish only for v1
- Auto-update services — Watchtower handles this
- Web GUI / full dashboard — TUI sufficient for v1
- Log aggregation / SIEM — structured logs consumable by external tools

## Context

- Shipped v1.0 with 4,291 LOC Python across 59 files
- Tech stack: Python 3.10+, Pydantic 2.x, Textual 8.2.5, APScheduler 3.11.2, SQLite WAL, loguru, click, qbittorrent-api, dnspython, Docker SDK
- Runs on Windows Server 2025 (SENTINEL-CORE) alongside Docker media stack
- Hybrid deployment: Docker for media services, host for VPN daemon and cloudflared

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Python 3.10+ over Node.js | Rich monitoring ecosystem, async support, APScheduler | Good |
| SQLite with WAL mode | Lightweight, concurrent, no external DB | Good |
| APScheduler 3.11.2 (not 4.x) | 4.x is pre-release, 3.x is stable | Good |
| Pydantic 2.x with extra='forbid' | Strict config validation | Good |
| Textual for TUI | Modern terminal UI, reactive updates | Good |
| NSSM for Windows service | Simpler than pywin32, auto-download | Good |
| Hybrid deployment (Docker + host) | VPN/cloudflared need host network access | Good |
| 4-agent architecture | MediaSentinel, TunnelGuard, VPNGuard, MetricsCollector | Good |
| Single-use shutdown snapshots | Prevent stale state on restore | Good |

---
*Last updated: 2026-05-04 after v1.0 milestone*
