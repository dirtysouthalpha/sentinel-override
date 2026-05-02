# Domain Pitfalls

**Domain:** Home media stack monitoring and auto-recovery with VPN-gated torrenting
**Researched:** 2026-05-02

## Critical Pitfalls

Mistakes that cause rewrites or major issues.

### Pitfall 1: qBittorrent v5.0 API Breaking Changes

**What goes wrong:** qBittorrent v5.0+ renamed `pause` and `resume` endpoints to `stop` and `start`. Any integration written against v4.x API documentation will fail silently or return 404 errors on every pause/resume call. Since VPN-gated downloading depends on pausing torrents when VPN drops, this breaks the entire zero-tolerance enforcement model.

**Why it happens:** Many tutorials, blog posts, and even library documentation still reference the v4.x API. The qBittorrent WebAPI documentation for v5.0 lists the renamed endpoints but does not prominently flag this as a breaking change. Developers copy code from older examples without checking the running version.

**Consequences:** VPN drops but torrents continue downloading over the clear network. IP is exposed. The core promise of the system ("zero-tolerance VPN enforcement") is violated without any error being raised.

**Prevention:**
- On startup, query `/api/v2/app/version` and branch logic based on major version.
- Write a version-aware wrapper that maps `pause` -> `stop` (v5+) or `pause` (v4.x) automatically.
- Pin the qBittorrent Docker image to a specific major version tag (e.g., `qbittorrent:5.*`) to avoid surprise upgrades.
- Add a startup health check that calls both the old and new endpoint patterns and logs which one works.

**Detection:**
- Log every API response code. A 404 on `/api/v2/torrents/pause` when torrents exist is an immediate red flag.
- Integration test that calls pause, verifies torrent state changed, then resumes.
- Alert if qBittorrent container image updates (watch for tag drift).

### Pitfall 2: Docker HEALTHCHECK Does Not Auto-Restart

**What goes wrong:** Developers add `HEALTHCHECK` to their Docker Compose files and assume unhealthy containers will be restarted automatically. Docker does NOT do this. `HEALTHCHECK` only sets the container's health status to "unhealthy" in metadata. The container keeps running in its broken state indefinitely unless something external reads that status and acts on it.

**Why it happens:** Docker's documentation separates health checking from restart policy, but many tutorials conflate them. The `restart: always` or `restart: on-failure` policies only trigger on process exit codes, not on health status transitions.

**Consequences:** A service returns 500s or refuses connections but its process is still alive. Docker reports "unhealthy" but never restarts it. The monitoring system sees the service as down but Docker's own recovery never kicks in, causing MediaSentinel's escalation hierarchy to fire unnecessarily for issues Docker should handle locally.

**Prevention:**
- Use `willfarrell/autoheal` or equivalent as a sidecar container that watches health status and restarts unhealthy containers. Configure with `AUTOHEAL_CONTAINER_LABEL=all` or target specific containers.
- Alternatively, implement health-check-triggered restart in MediaSentinel itself using `docker compose restart <service>` when health is unhealthy for N consecutive checks.
- Do NOT rely on Docker restart policies for application-level failures (they only catch process crashes).
- Document clearly: Docker restart policy = process crash recovery, HEALTHCHECK + autoheal = application health recovery.

**Detection:**
- `docker ps --filter "health=unhealthy"` returning results that have been unhealthy for > 60 seconds means the gap exists.
- If MediaSentinel is firing Level 2+ recovery for a service that Docker should be handling locally, the Docker health-restart pipeline is broken.

### Pitfall 3: VPN Kill Switch Is NOT DNS Leak Protection

**What goes wrong:** Implementing a network-level kill switch (binding qBittorrent to VPN interface so traffic stops if interface drops) but forgetting DNS leak protection. When VPN disconnects, torrent data stops, but the system's DNS resolver may still query the ISP's DNS servers, revealing which domains (tracker announce URLs, Radarr/Sonarr API hosts) were being accessed.

**Why it happens:** Kill switch and DNS leak protection address different threat vectors. A kill switch prevents data-plane traffic from escaping. DNS leak protection ensures DNS queries go through the VPN tunnel. They require separate configuration.

**Consequences:** Even with a "working" kill switch, ISP can see DNS queries for tracker domains, Jackett/Prowlarr search hosts, and Radarr/Sonarr API endpoints. This metadata reveals the nature of the traffic even if the payload is hidden.

**Prevention:**
- Configure qBittorrent to use DNS servers reachable only through the VPN tunnel (IPVanish's DNS: 172.20.32.1 or similar internal resolvers).
- Do NOT rely on system DNS settings alone -- they can be overridden by DHCP or other software.
- Implement a DNS leak test as part of the VPN health check: resolve a known domain and verify the resolving server is the VPN's DNS, not the ISP's.
- Use `dnspython` library to perform explicit DNS queries through specific nameservers and verify the response comes from the expected resolver.
- Test for DNS leaks using a dedicated check domain (e.g., dnsleaktest.com resolution pattern or a custom canary domain).

**Detection:**
- During VPN health checks, explicitly test DNS resolution path. If resolution goes through ISP DNS when VPN is "up", the DNS config is wrong.
- Monitor DNS server reachability -- if the configured VPN DNS becomes unreachable but general DNS still works, traffic is leaking.

### Pitfall 4: Windows/WSL2 VPN Interface Detection Is Nothing Like Linux

**What goes wrong:** Writing code that looks for `tun0` or `wg0` interface names because that is what every Linux-based tutorial uses. On Windows Server 2025 with Docker Desktop WSL2, VPN interfaces are named entirely differently. OpenVPN creates a "TAP-Windows Adapter V9" or "OpenVPN TAP-Windows" adapter. WireGuard creates a "Wintun" adapter. The actual interface name in Windows is whatever the user named it during setup, and the adapter type must be detected via `InterfaceDescription` or `AdapterType`, not the name.

**Why it happens:** 95% of VPN monitoring code and documentation targets Linux. The `network_mode: "service:vpn"` Docker Compose pattern only works on Linux. On Windows, Docker runs in a WSL2 VM with its own network namespace, completely separate from the host's network adapters.

**Consequences:** The VPN monitor cannot find the VPN interface. It reports VPN as down when it is up, or fails to detect VPN disconnection entirely. qBittorrent binding target cannot be resolved. The entire VPN enforcement chain fails.

**Prevention:**
- Use PowerShell `Get-NetAdapter` to enumerate adapters and match on `InterfaceDescription` patterns: `TAP-Windows`, `Wintun`, `OpenVPN`, `WireGuard`, `IPVanish`.
- Do NOT hardcode interface names. Match on adapter type/description patterns.
- Cache the discovered adapter name at startup but re-verify on every health check cycle (adapters can be re-created on reconnect).
- For qBittorrent binding, use the adapter's IP address, not the interface name, since qBittorrent's `current_network_interface` preference may behave differently on Windows.
- Test with both OpenVPN and WireGuard protocols since they create different adapter types.

**Detection:**
- Startup validation: enumerate adapters, verify at least one matches expected VPN adapter patterns. Fail loudly if none found.
- Log the detected adapter name and IP on every health check cycle. If it changes unexpectedly, flag it.

### Pitfall 5: qBittorrent WebAPI Session Management Eats Itself

**What goes wrong:** qBittorrent WebAPI uses cookie-based session auth (SID cookie). Sessions expire after `web_ui_session_timeout` (default 3600 seconds / 1 hour). If MediaSentinel's session expires but it tries to reuse the old SID cookie, all API calls silently fail with redirect to login page. Meanwhile, the monitoring system thinks it is successfully pausing/resuming torrents but nothing is actually happening.

**Why it happens:** The session timeout is configurable in qBittorrent settings and can be changed without MediaSentinel knowing. Multiple clients connecting to the same qBittorrent WebUI (browser, MediaSentinel, other tools) can invalidate each other's sessions depending on qBittorrent's session invalidation behavior.

**Consequences:** VPN drops, MediaSentinel "pauses" torrents via stale session, nothing actually pauses, torrents download over clear network. Same as Pitfall 1 consequences but from a completely different root cause.

**Prevention:**
- Implement a session manager that tracks SID cookie, last-authenticated timestamp, and proactively re-authenticates before the timeout expires (e.g., re-auth every 30 minutes if timeout is 60 minutes).
- Parse the `web_ui_session_timeout` value from qBittorrent preferences on startup and whenever config changes are detected.
- Every API call must check the response: if it returns a login page HTML or redirect, treat as auth failure and re-authenticate immediately before retrying.
- Use a dedicated qBittorrent WebUI username/password for MediaSentinel, separate from any human-use credentials, to prevent session conflicts.
- Add CSRF header handling: set `Referer` header to the qBittorrent WebUI URL on every request (required by qBittorrent's CSRF protection).

**Detection:**
- Log auth failures separately from API failures. If auth failures spike, session management is broken.
- Periodic "liveness" check: call `/api/v2/app/version` (lightweight, read-only). If this fails, session is dead.
- Track SID cookie age. If approaching timeout threshold, force re-auth.

### Pitfall 6: Thundering Herd During Stack Recovery

**What goes wrong:** When the VPN disconnects and reconnects, or when a core dependency like Prowlarr comes back online, every dependent service tries to recover simultaneously. All 8 services hit their health check endpoints at once, Docker restarts fire concurrently, API calls flood recovering services, and the system enters a feedback loop of failures and recovery attempts that takes longer to stabilize than the original outage.

**Why it happens:** Without coordinated recovery, each service's monitor operates independently. When VPN comes back up, qBittorrent unpauses, Jellyfin health checks resume, Radarr/Sonarr start querying Prowlarr, Prowlarr starts querying indexers -- all within seconds of each other. Each of these services is still initializing and cannot handle the load.

**Consequences:** Recovery takes 5-10 minutes instead of 60 seconds. Services that were fine get overwhelmed and appear to fail, triggering unnecessary escalation. The monitoring system itself becomes a source of load that prevents recovery.

**Prevention:**
- Implement the dependency tree startup order strictly: VPN -> Tunnels -> qBittorrent (paused) -> Jellyfin -> Prowlarr -> Radarr/Sonarr -> Jellyseerr -> Shoko.
- Add staggered delays between each level of the dependency tree (15-30 seconds between levels).
- Use exponential backoff with jitter for health check retries: `delay = min(base * 2^attempt + random_jitter, max_delay)`.
- Implement a "recovery lock" that prevents concurrent recovery operations -- only one recovery escalation at a time across the entire stack.
- After recovery, enter a "stabilization period" (2-3 minutes) with reduced health check frequency before returning to normal monitoring.
- Rate-limit API calls to recovering services (e.g., max 1 request per 5 seconds per service during recovery).

**Detection:**
- If more than 3 services are in "recovering" state simultaneously, the thundering herd is happening.
- If recovery attempts for a single incident exceed 15 total across all services, the coordination is insufficient.
- Monitor CPU/memory during recovery -- if system load spikes above 80% during recovery, services are being overwhelmed.

---

## Moderate Pitfalls

### Pitfall 7: network_mode: service:vpn Breaks Inter-Service Communication

**What goes wrong:** Using `network_mode: "service:vpn"` to force qBittorrent through the VPN container works for VPN routing but breaks qBittorrent's accessibility from other containers. When qBittorrent shares the VPN container's network namespace, its WebUI port is exposed on the VPN container, not on qBittorrent's own container. Radarr and Sonarr (which need to connect to qBittorrent's WebUI) cannot reach it by container name because qBittorrent no longer has its own network identity.

**Prevention:**
- For this hybrid deployment (VPN daemon on host, not in Docker), this is less of a concern since qBittorrent binds directly to the host's VPN interface. But if moving to containerized VPN, be aware of this trade-off.
- Alternative: Use Docker networks with routing rules instead of `network_mode: service:`. Create a dedicated `vpn_network` and add routing rules that force traffic from qBittorrent through the VPN gateway.
- Document the network architecture explicitly. Draw a diagram showing which container talks to which and on what port/host.

### Pitfall 8: State Snapshots Corrupted by Partial Service State

**What goes wrong:** Taking a "state snapshot" before recovery but the snapshot captures inconsistent state because services are in mid-failure. For example, Radarr's database shows a movie as "downloading" but qBittorrent has no record of that torrent. After recovery, the snapshot is used to "restore state" but now Radarr and qBittorrent are out of sync.

**Prevention:**
- State snapshots should capture: Docker container states (running/stopped/healthy), qBittorrent torrent list with states, service health check results, and VPN status. Do NOT capture application-internal state (databases, config files) -- those are managed by the services themselves.
- Snapshots should be append-only logs, not overwrites. Each snapshot gets a timestamp and recovery ID.
- Before using a snapshot for validation, check if all services were in a stable state when the snapshot was taken. Flag snapshots taken during active recovery as "unstable -- reference only."
- Never attempt to "restore" application state from snapshots. Use snapshots for diagnostics and audit trail only.

### Pitfall 9: Cloudflare Tunnel Has No Readiness Endpoint

**What goes wrong:** `cloudflared` does not expose a native health or readiness endpoint (GitHub issue #204 in cloudflared repo). Standard HTTP health checks against `cloudflared` return nothing useful. The tunnel can be "running" (process alive) but not actually connected to Cloudflare's edge, meaning remote access is silently broken.

**Prevention:**
- Health check cloudflared by making a round-trip request: hit a public URL that routes through the tunnel (e.g., the Jellyfin external URL) and verify it responds with expected content.
- Alternative: Check `cloudflared` logs for "Connection ... registered" or "ERR" messages.
- Alternative: Use `cloudflared tunnel info <tunnel_name>` to verify tunnel is connected (requires cloudflared CLI access).
- Since cloudflared runs on the host (not Docker), use process checks plus log monitoring plus round-trip URL checks for comprehensive coverage.

### Pitfall 10: Docker Compose depends_on Only Ensures Startup Order, Not Readiness

**What goes wrong:** Using `depends_on` in Docker Compose and assuming it means "wait until the dependency is fully ready." The basic `depends_on` only waits for the container to start, not for the application inside to be ready to accept connections. A service can start, pass initial process spawn, but still be 30+ seconds away from accepting requests.

**Prevention:**
- Use `depends_on` with `condition: service_healthy` (Compose v2.1+), which waits for the HEALTHCHECK to pass before starting dependent services.
- For services without built-in health checks, add a custom HEALTHCHECK that verifies the service is actually accepting connections (curl the HTTP endpoint, check TCP socket).
- In MediaSentinel's recovery logic, do not assume a restarted service is immediately ready. Poll its health endpoint with exponential backoff before proceeding to restart dependents.

### Pitfall 11: APScheduler Job Overlap During Slow Recovery

**What goes wrong:** APScheduler fires a health check job while the previous execution of the same job is still running (e.g., a recovery action from the previous check is still in progress). The second job sees the same "unhealthy" state and starts a duplicate recovery, leading to conflicting recovery actions.

**Prevention:**
- Use APScheduler's `misfire_grace_time` and `coalesce` options to handle overlapping executions.
- Implement a per-service lock (threading.Lock or asyncio equivalent) that prevents concurrent health checks for the same service.
- Alternatively, use `max_instances=1` on the scheduler job to prevent overlap at the framework level.
- Track "recovery in progress" state per service and skip health checks while recovery is active for that service.

---

## Minor Pitfalls

### Pitfall 12: Rich TUI Blocking the Event Loop

**What goes wrong:** Using the Rich library's Live display for the TUI dashboard but running it in the same thread as the monitoring logic. Rich's Live display refreshes the terminal, and if the monitoring thread is blocked waiting for a network response (service health check timeout), the TUI freezes.

**Prevention:**
- Run Rich Live display in a dedicated thread or use asyncio with `rich.live.Live` in async mode.
- Keep monitoring logic and display logic in separate threads with a shared state object.
- Set aggressive timeouts on all network requests (5 seconds for health checks) so they never block the display thread for long.

### Pitfall 13: SQLite Locking Under Concurrent Writes

**What goes wrong:** SQLite uses file-level locking. If multiple threads (health checker, recovery handler, metrics collector) all try to write metrics simultaneously, writes fail with "database is locked" errors. This is especially common on Windows where file locking behavior differs from Linux.

**Prevention:**
- Use a single database connection with `check_same_thread=False` and protect it with a threading lock.
- Alternatively, use SQLAlchemy's queue-based connection pool to serialize writes.
- Set WAL (Write-Ahead Logging) mode on the SQLite database: `PRAGMA journal_mode=WAL;` -- this allows concurrent reads during writes.
- Batch metric writes (accumulate in memory, flush every 30 seconds) instead of writing on every health check.

### Pitfall 14: Docker Desktop WSL2 Restart Loses Container State

**What goes wrong:** Docker Desktop on Windows runs containers inside a WSL2 VM. If WSL2 restarts (Windows update, Docker Desktop update, resource pressure), all running containers stop. Docker's `restart: always` policy will restart them, but startup order and timing are not guaranteed. The dependency tree is not respected during bulk restart.

**Prevention:**
- MediaSentinel itself must be resilient to full stack restarts. On startup, it should detect the current state of all services and perform a dependency-ordered health assessment.
- Do not assume services started in `depends_on` order after a Docker Desktop restart. Verify readiness before proceeding.
- Consider running MediaSentinel as a Windows service (not in Docker) so it survives Docker Desktop restarts and can orchestrate the recovery.

### Pitfall 15: qBittorrent Speed Profile Misconfiguration

**What goes wrong:** Setting qBittorrent speed limits based on ISP speed profile (10/50/100/100+ Mbps tiers) but not accounting for VPN overhead. A 100 Mbps ISP connection through IPVanish typically achieves 70-85 Mbps due to encryption overhead. Setting qBittorrent's global speed limit to the full ISP speed causes constant saturation, increasing latency for all other traffic on the network.

**Prevention:**
- Apply a 75-80% factor to ISP speed when setting qBittorrent limits (e.g., 100 Mbps ISP -> 80 Mbps qBittorrent limit).
- Monitor actual throughput after profile application and adjust if consistent saturation is detected.
- Leave headroom for Jellyfin streaming, Radarr/Sonarr API calls, and general network traffic.

### Pitfall 16: Log Files Filling Disk on Extended Outages

**What goes wrong:** During extended outages (ISP down for hours), every health check failure generates structured JSON log entries. With 8 services checked every 10-60 seconds, this produces thousands of log entries per hour. On a system with limited disk space, logs fill the disk, which causes services to crash, which generates more logs -- a death spiral.

**Prevention:**
- Implement log rotation with size limits (e.g., max 50MB per log file, keep 10 files).
- During extended outages, reduce logging verbosity (log every Nth failure instead of every failure).
- Separate crash/audit logs from routine health check logs. Only the latter should be aggressively rotated.
- Monitor disk space as a first-class metric and raise an alert if logs exceed a threshold.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| VPN monitoring setup | Windows interface detection (Pitfall 4) | Start with PowerShell adapter enumeration, not Linux interface names |
| qBittorrent integration | API version mismatch (Pitfall 1) and session management (Pitfall 5) | Version detection on startup, session manager with proactive re-auth |
| Docker health checks | HEALTHCHECK does not restart (Pitfall 2) | Deploy autoheal sidecar or implement Docker-level restart in MediaSentinel |
| Recovery hierarchy design | Thundering herd (Pitfall 6) | Dependency-ordered recovery with staggered delays and recovery locks |
| DNS leak protection | Kill switch is not DNS protection (Pitfall 3) | Separate DNS leak test from VPN connectivity check |
| Cloudflare tunnel monitoring | No readiness endpoint (Pitfall 9) | Round-trip URL health check, not process check |
| Metrics collection | SQLite locking (Pitfall 13) | WAL mode, batch writes, connection serialization |
| TUI dashboard | Rich blocking event loop (Pitfall 12) | Dedicated display thread, aggressive network timeouts |
| Full stack recovery after reboot | Docker Desktop WSL2 state loss (Pitfall 14) | MediaSentinel runs as Windows service, orchestrates post-reboot recovery |
| Inter-service networking | network_mode breaks DNS (Pitfall 7) | Document network topology, prefer routing rules over namespace sharing |
| State snapshots | Inconsistent partial state (Pitfall 8) | Append-only snapshots, flag unstable snapshots, never restore from them |
| Alerting system | Log disk exhaustion (Pitfall 16) | Log rotation, reduced verbosity during extended outages |

## Sources

- qBittorrent v5.0 WebAPI documentation (official, verified via webReader) -- HIGH confidence for API endpoint changes
- Docker HEALTHCHECK documentation and Moby issue #42873 (exponential backoff behavior) -- HIGH confidence
- Docker Compose v2 specification for `depends_on` with health conditions -- HIGH confidence
- cloudflared GitHub issue #204 (no native readiness endpoint) -- HIGH confidence
- Windows `Get-NetAdapter` PowerShell documentation -- HIGH confidence for interface detection approach
- `willfarrell/autoheal` Docker Hub documentation -- HIGH confidence for auto-restart on unhealthy
- APScheduler documentation for `max_instances` and `misfire_grace_time` -- HIGH confidence
- SQLite WAL mode documentation -- HIGH confidence
- Rich library documentation for Live display threading -- MEDIUM confidence (based on library patterns)
- VPN DNS leak testing patterns -- MEDIUM confidence (based on security community practices)
- Thundering herd prevention with jitter -- MEDIUM confidence (standard distributed systems pattern)
- Docker Desktop WSL2 behavior on restart -- MEDIUM confidence (based on community reports, varies by version)
