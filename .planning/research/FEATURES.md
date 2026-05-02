# Feature Landscape: MediaSentinel

**Domain:** Media stack monitoring, service orchestration, and VPN-gated download management
**Researched:** 2026-05-02
**Overall Confidence:** HIGH (verified via Context7, official docs, and community sources)

## Overview

MediaSentinel occupies a niche that currently has no direct all-in-one competitor. The ecosystem fragments across three categories: (1) generic container health monitors like Docker Autoheal and Uptime Kuma, (2) VPN gateway containers like Gluetun, and (3) media stack deployment templates (Docker Compose files). No existing tool combines media-stack-aware dependency ordering, multi-level escalation recovery, VPN-verified download gating, and a real-time TUI dashboard into a single purpose-built system.

This is both the opportunity and the challenge: MediaSentinel must synthesize patterns from all three categories into a cohesive whole, which means feature selection must be ruthlessly prioritized to avoid scope bloat.

---

## Table Stakes

Features users expect from a "media stack watchdog." Missing any of these means the system feels incomplete or untrustworthy compared to cobbling together existing tools.

| # | Feature | Why Expected | Complexity | Notes |
|---|---------|--------------|------------|-------|
| TS-1 | **HTTP health checks for all services** | This is the absolute minimum. Every monitoring tool does this. Uptime Kuma, Autoheal, Netdata all start here. | Low | Each of the 8 services (Jellyfin, Jellyseerr, Radarr, Sonarr, Shoko, Prowlarr, Cloudflare Tunnel, qBittorrent) has a known HTTP endpoint or API to poll. qBittorrent exposes `/api/v2/app/version`, Radarr/Sonarr expose `/api/v3/system/status`, Jellyfin exposes `/health`, etc. |
| TS-2 | **Automatic restart of unhealthy services** | Docker's built-in restart policy only handles process crashes, not health check failures. Users expect monitoring tools to fill this gap -- this is literally what Docker Autoheal exists to do. | Low-Medium | Must handle Docker containers differently from host processes (cloudflared, VPN daemon). Docker API for containers, systemd/process kill for host services. |
| TS-3 | **VPN connection monitoring** | Anyone running torrents behind a VPN needs to know the VPN is up. Gluetun built its entire reputation on this. | Medium | Must verify: (1) tunnel interface exists, (2) VPN IP assigned, (3) external IP matches VPN endpoint, (4) DNS resolves through VPN, not ISP. Gluetun provides `HEALTH_TARGET_ADDRESSES` and `HEALTH_ICMP_TARGET_IPS` as reference patterns. |
| TS-4 | **Kill switch / download pause on VPN drop** | This is non-negotiable for anyone torrenting. Every VPN+torrent guide covers this. Without it, the system is actively dangerous. | Medium | qBittorrent supports interface binding (Advanced Settings -> Network Interface) which acts as an app-level kill switch. Additionally, the WebAPI provides `/api/v2/torrents/pause` and `/api/v2/torrents/resume` for programmatic control. Both should be used: binding as the safety net, API pause as the active response. |
| TS-5 | **Service dependency ordering** | The arr stack has known dependencies (Prowlarr must be up before Radarr/Sonarr can use indexers, qBittorrent must be up before downloads can happen). Users know this and expect tools to respect it. | Medium | Dependency tree from PROJECT.md: VPN -> Tunnels -> qBittorrent (paused) -> Jellyfin -> Prowlarr -> Radarr/Sonarr -> Jellyseerr -> Shoko. Both startup and recovery must follow this order. |
| TS-6 | **Real-time status display** | Users need to see what is happening. A monitoring tool without a dashboard is useless. Even Autoheal has status output. | Medium | Rich library's `Live` context manager with `Table` and `Panel` widgets. Refresh 1-2x per second. Show: service name, status (UP/DOWN/RECOVERING), uptime %, response time, VPN status, download speeds. |
| TS-7 | **Structured logging with audit trail** | When something goes wrong at 3 AM, the operator needs to reconstruct what happened. Every monitoring tool worth using produces parseable logs. | Low | JSON-structured logs. Each log entry: timestamp, severity, component, action, service affected, result, duration. This is standard practice -- cloudflared itself supports `--log-format json`. |
| TS-8 | **Alerting on critical failures** | A watchdog that fails silently is worse than no watchdog. At minimum, the operator must be notified when automated recovery fails or VPN is down. | Medium | 4 severity levels from PROJECT.md are correct: INFO (logged), WARNING (logged + notification), CRITICAL (logged + notification + recovery attempt), EMERGENCY (logged + all channels + human escalation). Support at minimum: email (SMTP), webhook (Discord/Slack/Gotify), and log output. |
| TS-9 | **State preservation during recovery** | Restarting a service that loses its queue or config is worse than leaving it down. Users expect recovery to be non-destructive. | Medium | Take state snapshots before every recovery action. For Docker containers, this means not using `docker rm` -- use `docker restart`. For qBittorrent, never clear the download queue. For Radarr/Sonarr, their SQLite databases must survive restarts. Volume mounts in Docker Compose ensure this. |

## Differentiators

Features that set MediaSentinel apart from the "cobble together Autoheal + Uptime Kuma + Gluetun" approach. These are the reasons to build MediaSentinel instead of just using existing tools.

| # | Feature | Value Proposition | Complexity | Notes |
|---|---------|-------------------|------------|-------|
| D-1 | **7-level escalation hierarchy** | No existing tool has a graduated recovery strategy. Autoheal just restarts. Gluetun restarts VPN. MediaSentinel's 7 levels (self-heal -> soft restart -> dependency recovery -> stack reset -> VPN recovery -> network recovery -> operator escalation) mean it tries progressively more aggressive interventions before waking a human. | High | This is the core innovation. Each level must have: (1) clear trigger conditions, (2) defined scope of impact, (3) maximum retry count, (4) automatic escalation timer. Level 1-3 should complete in under 30 seconds. Level 4-6 in under 5 minutes. Level 7 immediately notifies the operator. |
| D-2 | **Dependency-aware recovery** | Generic monitors restart services in isolation. MediaSentinel understands that if Prowlarr is down, Radarr and Sonarr are degraded even if they are technically "up." Recovery of Prowlarr should trigger re-check of its dependents. | Medium-High | Build an explicit dependency graph. On any recovery event, walk the graph to determine cascade effects. The graph from PROJECT.md is a linear chain which simplifies this significantly -- no complex DAG traversal needed. |
| D-3 | **VPN verification with leak testing** | Gluetun checks connectivity but does not perform DNS leak tests or IP leak tests as part of its standard health check. MediaSentinel actively verifies the VPN endpoint IP matches expectations and DNS is not leaking to ISP resolvers. | Medium | Use external APIs (ipleak.net, dnsleaktest.com patterns) or self-hosted checks. Compare: (1) detected external IP against known IPVanish IP ranges, (2) DNS resolver addresses against expected VPN DNS servers, (3) response latency to detect DNS hijacking. The Reddit r/VPN community has examples of automated hourly DNS leak scripts. |
| D-4 | **Download state machine (VPN-gated)** | Gluetun blocks traffic at the network level but does not manage qBittorrent's state. MediaSentinel actively pauses/resumes downloads based on VPN verification, not just VPN connectivity. This means: VPN up but DNS leaking -> downloads stay paused. VPN fully verified -> downloads resume. | Medium | State machine: INIT -> VPN_VERIFIED (downloads active) -> VPN_DEGRADED (downloads paused, monitoring intensifies) -> VPN_DOWN (downloads paused, recovery begins) -> VPN_VERIFIED. Use qBittorrent WebAPI: `/api/v2/torrents/pause` and `/api/v2/torrents/resume`. The `qbittorrent-api` Python library provides `client.torrents_pause()` and `client.torrents_resume()`. |
| D-5 | **Speed profile auto-tuning** | qBittorrent supports alternate speed limits via WebAPI but no tool automatically profiles and configures them based on measured ISP performance. MediaSentinel can optimize download speeds without hogging the network. | Low-Medium | 4 profiles from PROJECT.md: 10 Mbps, 50 Mbps, 100 Mbps, 100+ Mbps. Map to qBittorrent global download/upload limits. Use the WebAPI: `client.transfer_set_download_limit()` and `client.transfer_set_speed_limits_mode()`. Manual profile selection is fine for v1 (out of scope: automatic ISP speed testing). |
| D-6 | **Metrics collection and trend analysis** | Uptime Kuma tracks uptime but not media-stack-specific metrics like VPN stability over time, download throughput trends, or recovery pattern analysis. MediaSentinel collects domain-specific metrics. | Medium | SQLite storage. Track per-service: uptime %, MTTR (mean time to recovery), failure frequency, response time trends. Track VPN: connection uptime, leak test results over time, latency. Track downloads: throughput over time, profile effectiveness. |
| D-7 | **Cloudflare Tunnel agent (TunnelGuard)** | Cloudflared has built-in reconnection, but no tool monitors tunnel health from the application side and escalates when connectivity to Cloudflare edge degrades. | Medium | Monitor: tunnel connection count (cloudflared exposes Prometheus metrics), request error rate, last successful connection. Recovery: restart cloudflared service (systemd or process), verify tunnel reconnects within 30 seconds, escalate to network recovery if tunnel cannot establish. |
| D-8 | **Bandwidth monitoring with throttling detection** | ISPs throttling torrent traffic is a known problem. Detecting it automatically and alerting is not something any existing homelab tool does. | Low-Medium | Monitor qBittorrent download speeds over time. If sustained throughput drops below a threshold for the active speed profile, flag as potential throttling. Do not auto-switch VPN servers (too complex for v1) -- just alert. |

## Anti-Features

Features to explicitly NOT build. These are traps that would expand scope, increase complexity, or duplicate existing tools without adding value.

| # | Anti-Feature | Why Avoid | What to Do Instead |
|---|-------------|-----------|-------------------|
| AF-1 | **Web GUI / full dashboard** | Uptime Kuma, Homepage, Homarr, and Dashy already do this excellently. Building another web dashboard is scope creep with massive frontend investment. | Rich TUI for real-time monitoring. If a web view is needed later, expose metrics via a simple REST API that existing dashboard tools can consume. |
| AF-2 | **Prometheus/Grafana integration (v1)** | These are heavy dependencies. The project already correctly defers this. SQLite metrics are sufficient for single-node monitoring. | SQLite for v1. Design the metrics schema so a Prometheus exporter can be added in v2 without schema changes. |
| AF-3 | **Multi-user access control** | This is a single-operator homeserver system. RBAC, user management, API keys per user -- all unnecessary complexity. | Single operator. Single configuration. API authentication for inter-agent communication only. |
| AF-4 | **Mobile application** | The project already correctly excludes this. Push notifications via webhooks to mobile apps (Gotify, ntfy.sh) cover the "alert on phone" use case. | Webhook-based notifications that can target mobile push services. |
| AF-5 | **Firewall-level kill switch** | iptables/nftables manipulation on a Windows host is fragile and dangerous. qBittorrent interface binding is the correct v1 approach. | qBittorrent interface binding (Advanced Settings -> Network Interface -> tun0/wg0) combined with API-level pause/resume. This provides defense in depth without touching the host firewall. |
| AF-6 | **Multi-VPN provider support (v1)** | Supporting multiple VPN providers means handling different config formats, auth mechanisms, and API quirks. IPVanish is the specified provider. | Hardcode IPVanish support (OpenVPN + WireGuard). Design the VPN abstraction so other providers can be added later via a provider interface, but do not implement any others in v1. |
| AF-7 | **Automatic media library management** | Radarr, Sonarr, and Jellyseerr already handle this. MediaSentinel should monitor these services, not duplicate their functionality. | Monitor service health only. Do not attempt to manage media libraries, trigger searches, or handle media file operations. |
| AF-8 | **Docker image building / service deployment** | Portainer, Dockge, and Docker Compose handle deployment. MediaSentinel is a watchdog, not a deployment tool. | Expect services to be pre-deployed via Docker Compose. MediaSentinel only restarts and recovers existing containers and services. |
| AF-9 | **Log aggregation / SIEM** | Loki, ELK, and Graylog exist for this. MediaSentinel's structured logs should be consumable by these tools but not replace them. | Write structured JSON logs to stdout and a log file. Let the operator pipe them to whatever log aggregation they use. |
| AF-10 | **Auto-update services** | Updating services without testing is dangerous. A monitoring tool should not be an update manager. | Watchtower and Ouroboros exist for this. MediaSentinel should not update services -- only recover them. If a recovery requires re-pulling an image, log a recommendation but do not execute. |

---

## Feature Dependencies

Dependency ordering for implementation. An arrow means "depends on" (build the source first).

```
TS-1 (Health Checks)
  |
  +---> TS-2 (Auto-restart) -----> TS-5 (Dependency ordering)
  |                                    |
  |                                    +---> D-2 (Dependency-aware recovery)
  |                                    |
  |                                    +---> D-1 (Escalation hierarchy)
  |
  +---> TS-6 (TUI Dashboard)
  |
  +---> D-6 (Metrics collection)
  |
  +---> TS-7 (Structured logging)
           |
           +---> TS-8 (Alerting)
                    |
                    +---> D-1 (Escalation hierarchy) -- level 7 = alerting

TS-3 (VPN Monitoring)
  |
  +---> TS-4 (Kill switch / Download pause)
           |
           +---> D-4 (Download state machine)
           |
           +---> D-3 (VPN leak testing)

D-5 (Speed profiles) -- standalone, depends only on qBittorrent WebAPI access
D-7 (TunnelGuard) -- standalone, depends only on cloudflared process access
D-8 (Bandwidth monitoring) -- depends on D-6 (metrics) and TS-1 (qBittorrent health check)
```

## MVP Recommendation

### Phase 1 -- Foundation (must ship first)
1. **TS-1**: Health checks for all 8 services
2. **TS-2**: Automatic restart of unhealthy services (levels 1-2 of escalation)
3. **TS-5**: Dependency-ordered startup and recovery
4. **TS-7**: Structured JSON logging
5. **TS-6**: Rich TUI dashboard (basic -- service status table)

Rationale: Without health checks and restart, nothing else matters. Dependency ordering prevents cascading failures during recovery. Logging ensures observability from day one. The TUI gives the operator confidence the system is working.

### Phase 2 -- VPN Gating (critical differentiator)
1. **TS-3**: VPN connection monitoring (interface + IP + DNS)
2. **TS-4**: Kill switch with download pause/resume
3. **D-4**: VPN-gated download state machine
4. **D-3**: VPN leak testing (DNS + IP)

Rationale: VPN-gated downloads are the primary differentiator. This is what makes MediaSentinel uniquely valuable vs. generic monitoring tools.

### Phase 3 -- Full Recovery (graduated escalation)
1. **D-1**: Complete 7-level escalation hierarchy
2. **D-2**: Dependency-aware recovery with cascade detection
3. **D-7**: TunnelGuard (Cloudflare tunnel monitoring)
4. **TS-9**: State snapshots before recovery actions

Rationale: The escalation hierarchy is the second major differentiator but depends on Phase 1 health checks and Phase 2 VPN monitoring being stable. TunnelGuard is isolated enough to build in parallel.

### Phase 4 -- Intelligence
1. **D-6**: Metrics collection and storage (SQLite)
2. **D-5**: Speed profile auto-tuning
3. **D-8**: Bandwidth throttling detection
4. **TS-8**: Full alerting with multiple channels

Rationale: Metrics enable everything else (trend analysis, throttling detection). Speed profiles are a nice-to-have that leverages the qBittorrent WebAPI. Alerting can use basic logging in earlier phases and graduate to multi-channel in this phase.

### Defer to v2
- Prometheus exporter (design metrics schema to support it)
- Multi-VPN provider support
- Web dashboard (REST API first, then existing dashboards can consume)
- Automatic ISP speed testing for profile selection
- Mobile application

---

## Competitive Landscape

For context, here are the existing tools MediaSentinel competes with or complements:

| Tool | What It Does | What MediaSentinel Adds |
|------|-------------|------------------------|
| **Docker Autoheal** | Restarts unhealthy Docker containers | Dependency ordering, escalation levels, media-stack awareness |
| **Uptime Kuma** | HTTP health monitoring with web UI and alerting | VPN gating, service recovery (not just alerting), TUI dashboard |
| **Gluetun** | VPN container with kill switch and port forwarding | Active leak testing, download state management, non-Docker VPN support |
| **Portainer** | Docker management UI | Health monitoring, auto-recovery, VPN enforcement |
| **Homepage/Homarr** | Dashboard for homelab services | Active monitoring, recovery, VPN management |
| **Netdata** | Real-time system metrics | Media-stack-specific logic, VPN gating, service dependency management |
| **Watchtower** | Auto-updates Docker containers | Not a competitor -- complementary. Different concern entirely. |

The key insight: **no single tool combines monitoring + recovery + VPN gating + dependency management**. MediaSentinel's value is integration, not any single feature.

---

## Complexity Estimates

Summary of implementation complexity across all features:

| Complexity | Features | Estimated Effort |
|------------|----------|------------------|
| Low | TS-1, TS-7 | 1-2 days each |
| Low-Medium | TS-2, D-5, D-8 | 2-3 days each |
| Medium | TS-3, TS-4, TS-6, TS-8, TS-9, D-3, D-4, D-6, D-7 | 3-5 days each |
| Medium-High | D-2 | 5-7 days |
| High | D-1 | 7-10 days |

**Total estimated effort:** 45-65 days for full feature set.

---

## Sources

- [qBittorrent WebUI API Documentation (GitHub Wiki)](https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-%2528qBittorrent-4.1%2529) -- HIGH confidence, official docs
- [qbittorrent-api Python Library (Context7)](https://context7.com/rmartin16/qbittorrent-api/llms.txt) -- HIGH confidence, verified API capabilities
- [Gluetun Wiki (Context7)](https://context7.com/qdm12/gluetun-wiki/llms.txt) -- HIGH confidence, verified VPN features
- [Gluetun GitHub Repository](https://github.com/qdm12/gluetun) -- HIGH confidence, official source
- [Docker Autoheal Discussion (Reddit r/selfhosted)](https://www.reddit.com/r/selfhosted/comments/1pyjhog/how_to_make_your_homelab_almost_maintenance_free/) -- MEDIUM confidence, community patterns
- [Docker HEALTHCHECK + Restart Policy Gap (Stack Overflow)](https://stackoverflow.com/questions/47088261/restarting-an-unhealthy-docker-container-based-on-healthcheck) -- HIGH confidence, confirms Docker limitation
- [Docker Autoheal Without Orchestration (OneUpTime)](https://oneuptime.com/blog/post/2026-02-08-how-to-set-up-docker-container-auto-healing-without-orchestration/view) -- MEDIUM confidence, patterns reference
- [qBittorrent VPN Kill Switch (GitHub Issue #4073)](https://github.com/qbittorrent/qBittorrent/issues/4073) -- HIGH confidence, confirms interface binding capability
- [qBittorrent Interface Binding as Kill Switch (TurboGeek)](https://www.turbogeek.co.uk/binding-qbittorrent-to-your-vpn-interface/) -- MEDIUM confidence, technique verification
- [qbt-flow: Automatic Bandwidth Manager (GitHub)](https://github.com/smit-p/qbt-flow) -- MEDIUM confidence, confirms WebAPI automation patterns
- [Uptime Kuma GitHub](https://github.com/louislam/uptime-kuma) -- HIGH confidence, feature reference
- [Uptime Kuma Official Site](https://uptimekuma.org/) -- HIGH confidence, monitoring interval specs
- [Automated DNS Leak Test (Reddit r/VPN)](https://www.reddit.com/r/VPN/comments/1k8ylx9/automatic_dns_leak_test/) -- LOW confidence, community pattern reference
- [Cloudflare Tunnel Documentation](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) -- HIGH confidence, monitoring patterns
- [IBM: Microservices Orchestration](https://www.ibm.com/think/topics/microservices-orchestration) -- HIGH confidence, dependency management patterns
- [Rich Library Documentation](https://github.com/Textualize/rich) -- HIGH confidence, TUI capability verification
- [IPVanish VPN Leak Testing (ipleak.net)](https://ipleak.net/) -- MEDIUM confidence, leak detection approach
