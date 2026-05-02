# MediaSentinel — Project Instructions

## Project Overview
MediaSentinel is an intelligent monitoring and auto-recovery system for a home media stack. Core value: 24/7 autonomous uptime with zero-tolerance VPN enforcement for torrent downloads.

## Tech Stack
- Python 3.10+ with async (asyncio, httpx)
- Textual 8.2.5 for TUI (NOT just Rich)
- APScheduler 3.11.2 (NOT 4.x — pre-release)
- SQLite with WAL mode from day one
- Docker SDK for container management
- qbittorrent-api for torrent control
- dnspython for DNS leak testing
- psutil for Windows VPN adapter detection
- Pydantic 2.x for config validation
- loguru for structured JSON logging
- click for CLI

## Architecture
- Supervisor-Worker pattern: 4 in-process agents
- Communication via SQLite + asyncio.Queue (not HTTP/RPC)
- Agents: MediaSentinel (orchestrator), TunnelGuard, VPNGuard, MetricsCollector
- VPN state machine owned by Orchestrator for safety

## GSD Workflow
- Planning docs in `.planning/`
- Phase execution via `/gsd-plan-phase <N>` then `/gsd-execute-phase <N>`
- Requirements tracked in `.planning/REQUIREMENTS.md` with traceability IDs
- State tracked in `.planning/STATE.md`
- Roadmap in `.planning/ROADMAP.md` — 7 phases, 49 requirements

## Key Constraints
- Windows Server 2025 target (no Linux interface names like tun0/wg0)
- VPN adapter detection via psutil InterfaceDescription, not interface name
- qBittorrent may be v4 or v5 — API wrapper must be version-aware (pause/resume vs stop/start)
- Fail closed: if VPN status uncertain, treat as DOWN, pause downloads
- Docker HEALTHCHECK does NOT auto-restart — MediaSentinel handles this
- No web GUI, no multi-user auth, no auto-updates (see REQUIREMENTS.md Out of Scope)

## Current Phase
Phase 1: Foundation and Infrastructure (CFG-01-05, MET-04)
