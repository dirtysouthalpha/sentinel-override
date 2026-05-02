# MediaSentinel

## What This Is

MediaSentinel is an intelligent monitoring and auto-recovery system for a home media stack. It monitors 8 services (Jellyfin, Jellyseerr, Radarr, Sonarr, Shoko, Prowlarr, Cloudflare Tunnels, qBittorrent), automatically detects failures, and recovers them using a dependency-aware 7-level escalation hierarchy. It enforces VPN-gated torrent downloading — qBittorrent runs continuously but only downloads when IPVanish VPN is verified connected with no DNS/IP leaks.

## Core Value

24/7 autonomous uptime for the entire media stack with zero-tolerance VPN enforcement for torrent downloads. If a service goes down, it recovers itself. If VPN drops, downloads pause instantly.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Monitor 8 media stack services via HTTP health checks with dependency-aware polling intervals
- [ ] 7-level auto-recovery hierarchy (self-heal → soft restart → dependency recovery → stack reset → VPN recovery → network recovery → operator escalation)
- [ ] IPVanish VPN monitoring with DNS leak test, IP leak test, latency checks every 10 seconds
- [ ] qBittorrent WebAPI integration — VPN-dependent download state machine (pause on VPN down, resume on VPN verified)
- [ ] qBittorrent speed optimization — auto-profile based on ISP speed (4 profiles: 10/50/100/100+ Mbps)
- [ ] Cloudflare tunnel monitoring and recovery (TunnelGuard agent)
- [ ] Dependency tree startup/recovery ordering (VPN → Tunnels → qBittorrent paused → Jellyfin → Prowlarr → Radarr/Sonarr → Jellyseerr → Shoko)
- [ ] Real-time TUI dashboard showing all services, VPN status, download speeds, uptime stats
- [ ] Alerting with 4 severity levels (INFO/WARNING/CRITICAL/EMERGENCY) — log, email, SMS, webhook
- [ ] State snapshots before every recovery attempt
- [ ] Metrics collection (uptime %, MTTR, failure patterns, download speeds, VPN stability)
- [ ] Structured JSON logging with audit trail
- [ ] Docker Compose configuration with health checks, restart policies, VPN network binding
- [ ] Health check wrapper scripts for each service returning standardized JSON
- [ ] Bandwidth monitoring with throttling detection and auto-scaling

### Out of Scope

- Mobile application — CLI/TUI and web dashboard sufficient
- Multi-user access control — single operator system
- Prometheus/Grafana integration — defer to v2, SQLite metrics sufficient for v1
- Kill switch at firewall level — qBittorrent interface binding sufficient for v1
- Automatic ISP speed testing — manual configuration with speed profiles
- Multi-VPN provider support — IPVanish only for v1

## Context

- Runs on SENTINEL-CORE (Windows homeserver, Administrator) and can coordinate with SENTINEL-EDGE (Hackbox) via SSH/Tailscale
- All services are Docker containers except cloudflared and VPN daemon (systemd/host)
- Hybrid deployment: Docker for media services, host for VPN daemon and cloudflared
- Python 3.10+ as primary language — requests, APScheduler, click, dnspython, rich (TUI)
- SQLite for metrics storage, JSON for configuration and snapshots
- REST API for inter-agent communication and qBittorrent WebAPI
- VPN interface: tun0 (OpenVPN) or wg0 (WireGuard) depending on IPVanish protocol

## Constraints

- **Platform**: Windows Server 2025 host — PowerShell and bash available, Docker Desktop for containers
- **VPN**: IPVanish subscription required — supports OpenVPN and WireGuard protocols
- **Network**: qBittorrent MUST bind to VPN interface only — zero tolerance for IP leaks
- **Resource**: Must run 24/7 alongside media services — minimize CPU/memory footprint
- **Recovery Speed**: Critical services (Jellyfin, VPN) must recover within 60 seconds
- **State Preservation**: Recovery must preserve download queues, configurations, and databases

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Python 3.10+ over Node.js | Rich ecosystem for monitoring (requests, dnspython), better cross-platform support, APScheduler for cron-like scheduling | — Pending |
| Hybrid deployment (Docker + host) | VPN daemon and cloudflared need host network access; media services isolated in Docker | — Pending |
| SQLite for metrics | Lightweight, no external DB dependency, sufficient for single-node monitoring | — Pending |
| Rich library for TUI | Modern terminal UI, supports tables/live display, pure Python | — Pending |
| 4-agent architecture | Separation of concerns — MediaSentinel (orchestrator), TunnelGuard (Cloudflare), VPNGuard (IPVanish), MetricsCollector (reporting) | — Pending |

---
*Last updated: 2026-05-02 after initialization*
