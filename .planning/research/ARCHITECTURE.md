# Architecture Patterns

**Domain:** Multi-agent service monitoring for home media stack (MediaSentinel)
**Researched:** 2026-05-02

## Recommended Architecture: Supervisor-Worker with Event Bus

MediaSentinel uses a **Supervisor-Worker pattern** with an internal event bus. The Orchestrator agent is the supervisor, and the three specialist agents (TunnelGuard, VPNGuard, MetricsCollector) are workers. They communicate through a shared event bus backed by a central state store (SQLite), not through direct RPC calls. This avoids the fragility of point-to-point agent communication while keeping the system simple enough for a single-node deployment.

```
                        +-----------------------+
                        |    Rich TUI Dashboard |
                        |   (Live read-only)    |
                        +----------+------------+
                                   |
                                   v
+-----------+        +------------------------+        +----------------+
|  Config   |------->|                        |<-------|  SQLite Store  |
|  (JSON)   |        |     Orchestrator       |        |  (metrics,     |
+-----------+        |     (MediaSentinel)    |        |   snapshots,   |
                     |                        |        |   state)       |
                     |  - Scheduler (APSched) |        +-------+--------+
                     |  - Recovery Engine     |                ^
                     |  - Dependency Tree     |                |
                     |  - Alert Dispatcher    |                |
                     +----+------+-----+------+                |
                          |      |     |                       |
              +-----------+  +---+   +-+----------+            |
              v              v         v            v           |
     +---------------+ +----------+ +----------------+          |
     |  TunnelGuard  | | VPNGuard | | MetricsCollector|----------+
     +---------------+ +----------+ +----------------+
     | - Cloudflare  | | - IP leak | | - Uptime %     |
     |   tunnel      | | - DNS leak| | - MTTR         |
     |   monitoring  | | - Latency | | - Failure      |
     | - /ready      | | - tun0/   | |   patterns     |
     |   endpoint    | |   wg0     | | - Download     |
     | - CF API      | | - VPN     | |   speeds       |
     +-------+-------+ |   connect | | - VPN stability|
             |         +-----+------+ +--------+------+
             |               |                  |
             v               v                  v
     +---------------+ +----------+ +------------------+
     | Cloudflare    | | IPVanish | | qBittorrent      |
     | Tunnel API    | | OpenVPN/ | | WebAPI           |
     | /ready check  | | WireGuard| | (pause/resume/   |
     +---------------+ +----------+ |  speed limits)   |
                                    +------------------+
```

### Why Supervisor-Worker, Not Peer-to-Peer

| Approach | Pros | Cons | Verdict |
|----------|------|------|---------|
| **Supervisor-Worker** | Single authority for recovery ordering, avoids race conditions, simpler state management | Single point of failure (mitigated by watchdog) | RECOMMENDED |
| Peer-to-Peer | No single point of failure | Race conditions in recovery, complex coordination, overkill for single node | Too complex |
| Pipeline/Sequential | Simple to understand | Cannot run checks in parallel, slow response times | Too slow |

The Orchestrator is the single source of truth for "what recovery is happening right now." Workers report status; the Orchestrator decides actions. This prevents the classic problem of two agents both trying to restart the same service simultaneously.

### Why Event Bus, Not Direct RPC

Agents do not call each other's methods directly. Instead:

1. Workers write status to SQLite (e.g., `vpn_status = CONNECTED, ip=1.2.3.4`)
2. Workers can also post events to a simple in-process event queue
3. The Orchestrator reads state and events, makes decisions
4. The Orchestrator dispatches commands back to workers

This is an in-process event bus (a Python `queue.Queue` or `asyncio.Queue`), not a network message broker. Since all four agents run in the same Python process, there is no need for Redis/RabbitMQ overhead. If MediaSentinel ever expands to multi-node (e.g., monitoring SENTINEL-EDGE), the event bus abstraction makes it straightforward to swap in ZeroMQ or an HTTP API.

---

## Component Boundaries

### Component 1: Orchestrator (MediaSentinel Core)

**Responsibility:** The brain. Schedules health checks, receives status, runs the 7-level recovery hierarchy, dispatches alerts, manages the dependency tree.

| Concern | Owner |
|---------|-------|
| Scheduling health check intervals | Orchestrator (via APScheduler) |
| Determining which service is unhealthy | Orchestrator (reads worker results) |
| Deciding recovery action | Orchestrator (escalation engine) |
| Executing recovery (restart container) | Orchestrator (calls Docker CLI/API) |
| Sending alerts | Orchestrator (alert dispatcher) |
| Managing dependency tree | Orchestrator |
| TUI rendering | Orchestrator (Rich Live display) |

**Communicates with:**
- SQLite Store (read/write state, metrics)
- VPNGuard (reads VPN status, sends VPN recovery commands)
- TunnelGuard (reads tunnel status, sends tunnel recovery commands)
- MetricsCollector (reads metrics for TUI display)
- Docker API (restart/start/stop containers)
- qBittorrent WebAPI (pause/resume, speed profiles)
- Alert channels (email, webhook, log)

### Component 2: VPNGuard (VPN Monitor Agent)

**Responsibility:** Verify IPVanish VPN is connected, has no IP leaks, no DNS leaks, acceptable latency. This is the most critical agent because VPN state gates qBittorrent downloads.

| Concern | Owner |
|---------|-------|
| Detect VPN interface (tun0/wg0) exists | VPNGuard |
| Verify public IP differs from real IP | VPNGuard |
| DNS leak test (compare DNS resolver IPs) | VPNGuard |
| Latency measurement to VPN gateway | VPNGuard |
| Report VPN status to SQLite | VPNGuard |

**Does NOT own:** Restarting VPN daemon (that is Orchestrator's recovery action). VPNGuard only detects and reports.

**Communicates with:**
- SQLite Store (writes VPN status)
- External APIs (ipify.org for IP check, DNS resolvers for leak test)
- System (reads network interface state)

**Polling interval:** 10 seconds (project requirement). This is aggressive but necessary for zero-tolerance VPN enforcement.

### Component 3: TunnelGuard (Cloudflare Tunnel Agent)

**Responsibility:** Monitor Cloudflare tunnel connectivity and health. Detect tunnel disconnections before they cause external-facing service outages.

| Concern | Owner |
|---------|-------|
| Check cloudflared `/ready` endpoint | TunnelGuard |
| Query Cloudflare API for tunnel status | TunnelGuard |
| Report tunnel status to SQLite | TunnelGuard |

**Does NOT own:** Restarting cloudflared (Orchestrator's job).

**Communicates with:**
- SQLite Store (writes tunnel status)
- cloudflared `/ready` endpoint (localhost health check)
- Cloudflare API (tunnel status verification)

**Polling interval:** 30 seconds. Tunnel issues are less time-critical than VPN but still important.

### Component 4: MetricsCollector (Reporting Agent)

**Responsibility:** Aggregate monitoring data into long-term metrics. Calculate uptime percentages, MTTR, failure patterns, download speed trends, VPN stability scores.

| Concern | Owner |
|---------|-------|
| Calculate uptime % per service | MetricsCollector |
| Calculate MTTR (Mean Time To Recovery) | MetricsCollector |
| Track failure patterns (time-of-day, frequency) | MetricsCollector |
| Download speed history | MetricsCollector |
| VPN stability scoring | MetricsCollector |
| Report metrics for TUI and alerts | MetricsCollector |

**Communicates with:**
- SQLite Store (reads raw events, writes aggregated metrics)
- qBittorrent WebAPI (reads transfer speeds for history)

**Runs on:** A slower schedule (every 60 seconds for aggregation, hourly for pattern analysis). This agent is intentionally lightweight and does not participate in the critical monitoring path.

---

## Data Flow

### Primary Monitoring Loop (every cycle)

```
1. APScheduler fires health check jobs in parallel
   |
   +--> VPNGuard.check()         --> writes vpn_status to SQLite
   +--> TunnelGuard.check()      --> writes tunnel_status to SQLite
   +--> Orchestrator.check_service(jellyfin)   --> writes service_status to SQLite
   +--> Orchestrator.check_service(radarr)     --> writes service_status to SQLite
   +--> ... (all 8 services)
   |
2. Orchestrator reads all statuses from SQLite
   |
3. If any status is UNHEALTHY:
   |
   +--> Orchestrator snapshots current state to JSON file
   +--> Orchestrator enters recovery hierarchy (7 levels)
   |    |
   |    +--> Level 1: Self-heal (retry health check)
   |    +--> Level 2: Soft restart (restart container)
   |    +--> Level 3: Dependency recovery (restart dependencies first)
   |    +--> Level 4: Stack reset (restart entire dependency chain)
   |    +--> Level 5: VPN recovery (restart VPN daemon + chain)
   |    +--> Level 6: Network recovery (restart network stack)
   |    +--> Level 7: Operator escalation (send EMERGENCY alert)
   |         |
   |         Each level has a max wait + re-check before escalating
   |
4. Special VPN flow:
   |
   +--> VPNGuard reports VPN_DOWN
   +--> Orchestrator sends PAUSE_ALL to qBittorrent IMMEDIATELY
   +--> Orchestrator initiates VPN recovery (Level 5)
   +--> VPNGuard reports VPN_UP with no leaks
   +--> Orchestrator sends RESUME_ALL to qBittorrent
   |
5. MetricsCollector reads new events (runs on its own schedule)
   |
6. Rich TUI reads SQLite state for live display (refreshes 1/sec)
```

### VPN-Gated Download State Machine

This is the most critical data flow in the system. qBittorrent downloads are gated by VPN verification.

```
                    +-------------------+
                    |  VPN_CONNECTED     |
                    |  (downloading OK)  |
                    +--+--------+-------+
                       |        ^
              VPN down |        | VPN verified
                       v        |
                    +--+--------+-------+
                    |  VPN_DOWN         |
                    |  (downloads       |
                    |   paused)         |
                    +--+--------+-------+
                       |        ^
              recovery |        | recovery
              failed   |        | succeeded
                       v        |
                    +--+--------+-------+
                    |  VPN_RECOVERING   |
                    |  (paused, waiting)|
                    +-------------------+

Transitions:
  VPN_CONNECTED -> VPN_DOWN:      VPNGuard detects leak/disconnect
  VPN_DOWN -> VPN_RECOVERING:     Orchestrator starts VPN recovery
  VPN_RECOVERING -> VPN_DOWN:     Recovery failed, retry or escalate
  VPN_RECOVERING -> VPN_CONNECTED: VPNGuard verifies no leaks
  VPN_CONNECTED: qBittorrent RESUME_ALL
  VPN_DOWN: qBittorrent PAUSE_ALL (immediate, before recovery)
```

The state machine is owned by the Orchestrator, not VPNGuard. VPNGuard provides the data (VPN is up/down, leaked), but the Orchestrator makes the decision to pause/resume. This separation matters: if VPNGuard crashes, qBittorrent stays paused (safe default), and the Orchestrator can detect VPNGuard is not reporting and escalate.

### Data Storage Schema (SQLite)

```
Tables:
  service_status      - service_name, status, last_check, last_healthy, response_time
  vpn_status          - connected, public_ip, vpn_ip, interface, dns_leak, ip_leak, latency_ms
  tunnel_status       - tunnel_id, connected, last_check, cloudflare_status
  recovery_events     - timestamp, service, level, action, result, snapshot_path
  metrics_uptime      - service_name, hour, uptime_pct, check_count, fail_count
  metrics_speed       - timestamp, dl_speed, ul_speed, active_torrents
  metrics_vpn         - timestamp, connected, latency, leak_events
  alerts              - timestamp, severity, service, message, channel, sent
  config              - key, value (runtime configuration)
```

### Inter-Agent Communication Protocol

Since all agents run in the same Python process, communication is through:

1. **SQLite database** - Durable state. Any agent can read any table. Workers write their status; Orchestrator reads everything.
2. **asyncio.Queue** - Real-time events. Workers post events; Orchestrator consumes them.
3. **Shared Python objects** - For fast access to current state (e.g., a dict of current VPN status).

No HTTP, no sockets, no message broker. The process is the boundary.

---

## Patterns to Follow

### Pattern 1: Dependency-Ordered Recovery

**What:** When recovering services, respect the dependency tree. Restart VPN first, then tunnels, then qBittorrent (paused), then media services in order.

**When:** Every recovery action that involves multiple services.

**Dependency tree (from PROJECT.md):**
```
VPN (tun0/wg0)
  -> Cloudflare Tunnels
    -> qBittorrent (paused state)
      -> Jellyfin
        -> Prowlarr
          -> Radarr
            -> Jellyseerr
          -> Sonarr
            -> Jellyseerr
      -> Shoko
```

**Example:**
```python
RECOVERY_ORDER = [
    "vpn",           # Must be first - gates everything
    "cloudflare",    # External access depends on tunnel
    "qbittorrent",   # Start paused, will resume when VPN verified
    "jellyfin",      # Media server core
    "prowlarr",      # Indexer - Radarr/Sonarr depend on it
    "radarr",        # Movies
    "sonarr",        # TV shows
    "jellyseerr",    # Request management - depends on Radarr/Sonarr
    "shoko",         # Anime - depends on Jellyfin
]

def recover_stack(failed_services: list[str]) -> None:
    # Only restart services in dependency order, even if only
    # one service failed -- its dependencies must be healthy first
    for service in RECOVERY_ORDER:
        if not is_healthy(service):
            restart_service(service)
            wait_for_healthy(service, timeout=30)
```

### Pattern 2: Snapshot Before Recovery

**What:** Before any recovery action, capture the current state of all services and save it as a JSON snapshot. This enables rollback and debugging.

**When:** Before every recovery attempt (Level 2+).

**Example:**
```python
def snapshot_state() -> str:
    """Capture full system state before recovery. Returns path to snapshot."""
    snapshot = {
        "timestamp": datetime.utcnow().isoformat(),
        "services": {s: get_service_state(s) for s in ALL_SERVICES},
        "vpn": get_vpn_state(),
        "tunnels": get_tunnel_state(),
        "qbittorrent": get_qbit_state(),
    }
    path = SNAPSHOTS_DIR / f"snapshot_{snapshot['timestamp']}.json"
    path.write_text(json.dumps(snapshot, indent=2))
    return str(path)
```

### Pattern 3: Safe Default (Fail Closed)

**What:** If any component is uncertain about VPN status, default to "VPN is down" and pause downloads. Never assume VPN is connected.

**When:** VPNGuard timeout, VPNGuard crash, ambiguous health check result.

**Rationale:** A single false negative (thinking VPN is down when it is up) causes a temporary download pause. A single false positive (thinking VPN is up when it is down) exposes the real IP. The former is a minor inconvenience; the latter is a privacy violation.

### Pattern 4: APScheduler with Coalesce and Jitter

**What:** Use APScheduler's `coalesce=latest` and `max_jitter` to prevent check storms when the system was asleep or behind.

**When:** All scheduled health checks.

**Example:**
```python
from apscheduler import Scheduler, CoalescePolicy
from apscheduler.triggers.interval import IntervalTrigger

scheduler.add_schedule(
    check_vpn,
    IntervalTrigger(seconds=10),
    coalesce=CoalescePolicy.latest,  # Don't pile up missed checks
    misfire_grace_time=30,           # Skip if too late
    max_jitter=timedelta(seconds=2),  # Randomize to avoid thundering herd
)
```

### Pattern 5: Rich Live Dashboard with Separate Render Loop

**What:** The TUI dashboard reads from SQLite on its own refresh cycle (1/sec), independent of the monitoring loop. This decouples display from monitoring.

**When:** Always. The dashboard is a read-only view.

**Example:**
```python
from rich.live import Live
from rich.table import Table

def build_dashboard(state: dict) -> Table:
    table = Table(title="MediaSentinel Dashboard")
    table.add_column("Service")
    table.add_column("Status")
    table.add_column("Uptime")
    table.add_column("Last Check")
    for svc, data in state["services"].items():
        status = "[green]HEALTHY" if data["healthy"] else "[red]UNHEALTHY"
        table.add_row(svc, status, f"{data['uptime_pct']:.1f}%", data["last_check"])
    return table

with Live(build_dashboard(load_state()), refresh_per_second=1) as live:
    while running:
        time.sleep(1)
        live.update(build_dashboard(load_state()))
```

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Agents Calling Agents Directly

**What:** VPNGuard calling Orchestrator's `handle_vpn_down()` method directly.
**Why bad:** Tight coupling. If Orchestrator is busy with a recovery, the call may block or fail. Creates hidden dependencies between agents.
**Instead:** Workers write to SQLite and/or post to event queue. Orchestrator reads and acts.

### Anti-Pattern 2: Recovery Without Snapshot

**What:** Restarting a container without saving current state first.
**Why bad:** If recovery makes things worse, you cannot roll back. If the recovery itself fails in a partial state, you lose the ability to debug what went wrong.
**Instead:** Always snapshot before Level 2+ recovery.

### Anti-Pattern 3: qBittorrent Resume on VPN "Probably Up"

**What:** Resuming downloads because the VPN interface exists, without verifying no IP/DNS leaks.
**Why bad:** VPN interface can exist while routing is broken, DNS is leaking, or the tunnel has stalled. Interface existence is necessary but not sufficient.
**Instead:** Full verification chain: interface exists AND public IP is VPN IP AND DNS resolvers are VPN DNS AND latency is acceptable.

### Anti-Pattern 4: Global Retry Without Service Context

**What:** Same retry count and timeout for all services regardless of type.
**Why bad:** VPN recovery takes longer than Jellyfin restart. Radarr depends on Prowlarr but Jellyfin does not. One-size-fits-all recovery does not respect the dependency tree.
**Instead:** Per-service recovery profiles with dependency-aware ordering and service-specific timeouts.

### Anti-Pattern 5: SQLite Writes on Every Check (Write Amplification)

**What:** Writing a new row to SQLite for every 10-second VPN check when nothing changed.
**Why bad:** 8,640 rows/day per metric for no new information. Wears SSD, slows queries, bloats database.
**Instead:** Only write to SQLite on state change (VPN_UP -> VPN_DOWN) and periodic samples (e.g., every 60 seconds for ongoing metrics, not every 10 seconds).

---

## Scalability Considerations

| Concern | At 1 node (current) | At 2 nodes (SENTINEL-CORE + SENTINEL-EDGE) | At 5+ nodes |
|---------|---------------------|---------------------------------------------|-------------|
| Inter-agent comms | In-process (Queue + SQLite) | SSH + Tailscale, remote agents post to central SQLite via HTTP | Migrate to message broker (ZeroMQ or Redis Pub/Sub) |
| State storage | Single SQLite file | Central SQLite on CORE, EDGE reads via API | PostgreSQL or TimescaleDB for metrics |
| Monitoring scale | 8 services + VPN + tunnel | 16-20 services + 2 VPNs + 2 tunnels | Per-node agents, central orchestrator |
| Alerting | Single operator (email, webhook) | Same, but per-node severity | Alert routing by node/team |
| Metrics retention | SQLite, prune after 90 days | Same, with cross-node queries | Dedicated metrics store (TimescaleDB or Prometheus) |

For the current single-node scope, SQLite + in-process queues are the correct choice. The architecture is designed so that swapping SQLite for PostgreSQL or swapping in-process queues for ZeroMQ is a configuration change, not a rewrite.

---

## Build Order Implications

Based on component dependencies, the recommended build order is:

```
Phase 1: Foundation
  - SQLite schema and state store
  - Configuration loader (JSON)
  - Logging infrastructure (structured JSON)
  - APScheduler setup

Phase 2: Monitoring Core (no recovery yet)
  - Service health check functions (HTTP checks for 8 services)
  - VPNGuard (VPN interface detection, IP check, DNS leak test)
  - TunnelGuard (cloudflared /ready, Cloudflare API)
  - Orchestrator scheduling loop (fire checks, read results)

Phase 3: Recovery Engine
  - Snapshot mechanism
  - 7-level escalation hierarchy
  - Dependency tree and ordered restart
  - Docker container restart commands
  - VPN daemon restart

Phase 4: qBittorrent Integration
  - WebAPI client (qbittorrent-api library)
  - VPN-gated state machine (pause on VPN down, resume on verified)
  - Speed profile management (4 profiles)
  - Interface binding verification

Phase 5: Observability
  - MetricsCollector agent
  - Uptime/MTTR calculation
  - Alert dispatcher (4 severity levels)
  - Structured alert formatting

Phase 6: TUI Dashboard
  - Rich Live display
  - Service status table
  - VPN status panel
  - Download speed panel
  - Recovery event log

Phase 7: Docker Integration
  - Docker Compose with health checks
  - Container restart policies
  - VPN network binding for qBittorrent container
  - Health check wrapper scripts

Phase 8: Hardening
  - Watchdog for MediaSentinel process itself
  - Configuration validation
  - Graceful shutdown (pause downloads, save state)
  - Recovery from MediaSentinel crash (resume from last snapshot)
```

**Rationale for this order:**
- Phase 1 must come first because everything depends on state storage and scheduling.
- Phase 2 (monitoring) comes before recovery because you cannot recover what you cannot detect.
- Phase 3 (recovery) comes after monitoring but before qBittorrent integration because recovery is needed for all services, not just qBittorrent.
- Phase 4 (qBittorrent) depends on VPNGuard being complete and recovery working, because qBittorrent's behavior is gated by VPN status.
- Phases 5-8 are additive and can be partially parallelized, but each depends on the core monitoring loop being functional.

---

## Technology-Specific Architecture Notes

### qbittorrent-api (Python library)

Use the `qbittorrent-api` package (not `python-qbittorrent`). The `qbittorrent-api` library is actively maintained, has 428 code snippets in documentation, and provides complete coverage of qBittorrent v4.1+ WebAPI endpoints. Key methods for MediaSentinel:

- `client.torrents_pause(torrent_hashes='all')` -- Pause all downloads when VPN drops
- `client.torrents_resume(torrent_hashes='all')` -- Resume when VPN verified
- `client.transfer_download_limit()` / `client.transfer_set_download_limit(limit=N)` -- Speed profiles
- `client.application.preferences` -- Read/verify network interface binding setting
- `client.transfer.info` -- Current download/upload speeds for metrics

Note: In qBittorrent v5.0+, "pause/resume" terminology changed to "stop/start" in the UI, but the API endpoints remain backward-compatible. The `qbittorrent-api` library handles this version difference.

### Rich (TUI library)

Use Rich's `Live` display with `refresh_per_second=1` for the dashboard. The `Live` context manager handles terminal refresh without flickering. Tables are rebuilt each second from SQLite state. Use `live.console.print()` for logging recovery events above the dashboard.

### APScheduler 4.x

Use APScheduler 4.x (not 3.x). Version 4 uses `Scheduler` (not `BackgroundScheduler`), supports `add_schedule()` with trigger objects, and has built-in coalesce/jitter support. Run with `scheduler.run_until_stopped()` in the main thread.

### VPN Interface Detection

On Windows with OpenVPN (IPVanish), the VPN interface appears as a TAP/TUN adapter. On WireGuard, it appears as a `wg0`-like interface. Use Python's `netifaces` or `psutil` to enumerate network interfaces and detect VPN-specific adapters. The interface name should be configurable (not hardcoded).

### cloudflared Health Check

The `cloudflared` daemon exposes a `/ready` endpoint on localhost (default port 9100 or configured metrics port). This is the fastest and most reliable way to check tunnel health. For verification, also query the Cloudflare API for tunnel status using the account API token.

---

## Sources

- [Docker Compose dependency ordering](https://docs.docker.com/compose/how-tos/startup-order/) -- HIGH confidence (official Docker docs)
- [qBittorrent API Python client](https://github.com/rmartin16/qbittorrent-api) -- HIGH confidence (Context7 verified, 428 code snippets)
- [APScheduler 4 documentation](https://github.com/agronholm/apscheduler) -- HIGH confidence (Context7 verified)
- [Rich Live display documentation](https://github.com/textualize/rich) -- HIGH confidence (Context7 verified)
- [Cloudflare tunnel monitoring](https://developers.cloudflare.com/tunnel/monitoring/) -- HIGH confidence (official Cloudflare docs)
- [Cloudflare /ready endpoint](https://www.reddit.com/r/selfhosted/comments/1979t4e/question_about_cloudflared_tunnel/) -- MEDIUM confidence (community-verified, confirmed by multiple sources)
- [Multi-agent supervisor pattern](https://www.langchain.com/blog/choosing-the-right-multi-agent-architecture) -- MEDIUM confidence (LangChain, applicable pattern)
- [Self-healing system patterns](https://oneuptime.com/blog/post/2026-01-30-self-healing-systems/view) -- MEDIUM confidence (practical guide, not academic)
- [qBittorrent VPN binding](https://www.astrill.com/blog/how-to-bind-qbittorrent-to-vpn/) -- MEDIUM confidence (community best practice)
- [Escalation and retry patterns](https://blog.bytebytego.com/p/a-guide-to-retry-pattern-in-distributed) -- MEDIUM confidence (established pattern reference)
