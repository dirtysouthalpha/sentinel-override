import asyncio
import json
from datetime import datetime
from pathlib import Path
from typing import Optional

from rich.text import Text
from textual.app import App, ComposeResult
from textual.containers import Container, Horizontal, Vertical, VerticalScroll
from textual.reactive import reactive
from textual.widgets import Footer, Header, Label, Static, DataTable
from textual.worker import Worker, get_current_worker

from mediasentinel.config.loader import load_config
from mediasentinel.config.models import AppConfig
from mediasentinel.db.connection import get_db, init_db


class VPNIndicator(Static):
    """Compact VPN state badge shown in the header bar."""

    vpn_state = reactive("disconnected")

    def watch_vpn_state(self, new_state: str) -> None:
        colors = {
            "connected": "green",
            "disconnected": "red",
            "degraded": "yellow",
            "connecting": "yellow",
        }
        color = colors.get(new_state, "white")
        self.update(Text(f" VPN: {new_state.upper()} ", style=f"bold {color} on default"))


class VPNPanel(Static):
    """Detailed VPN information panel showing adapter, IP, latency, and leak tests."""

    def update_vpn(
        self,
        state: str,
        adapter_name: Optional[str] = None,
        external_ip: Optional[str] = None,
        latency_ms: Optional[float] = None,
        dns_leak: Optional[bool] = None,
        ip_leak: Optional[bool] = None,
    ) -> None:
        state_colors = {
            "connected": "green",
            "disconnected": "red",
            "degraded": "yellow",
            "connecting": "yellow",
        }
        color = state_colors.get(state, "white")

        lines = []
        lines.append(f"[bold {color}]State: {state.upper()}[/bold {color}]")
        lines.append(f"Adapter: {adapter_name or '-'}")
        lines.append(f"External IP: {external_ip or '-'}")

        if latency_ms is not None:
            latency_color = "green" if latency_ms < 100 else "yellow" if latency_ms < 200 else "red"
            lines.append(f"Latency: [{latency_color}]{latency_ms:.1f}ms[/{latency_color}]")
        else:
            lines.append("Latency: -")

        dns_text = self._leak_label(dns_leak)
        ip_text = self._leak_label(ip_leak)
        lines.append(f"DNS Leak: {dns_text}")
        lines.append(f"IP Leak: {ip_text}")

        self.update("\n".join(lines))

    @staticmethod
    def _leak_label(value: Optional[bool]) -> str:
        if value is None:
            return "[dim]-[/dim]"
        return "[green]PASS[/green]" if not value else "[red]FAIL[/red]"


class ServiceTable(DataTable):
    """Data table of all monitored services with color-coded health status."""

    def __init__(self):
        super().__init__()
        self.cursor_type = "none"

    def on_mount(self) -> None:
        self.add_columns("Service", "Status", "Response", "Last Check")
        self.add_row("Loading...", "", "", "")

    def update_services(self, rows: list[tuple]) -> None:
        """Replace all rows with color-coded service data.

        Each row is a tuple of (name, status, response_time_ms, last_check_at).
        """
        self.clear()
        if not rows:
            self.add_row("No services found", "", "", "")
            return

        status_colors = {
            "healthy": "green",
            "degraded": "yellow",
            "unhealthy": "red",
        }

        for name, status_val, response_time_ms, last_check_at in rows:
            color = status_colors.get(status_val, "dim white")
            name_text = Text(str(name))
            status_text = Text(str(status_val or "unknown"), style=color)

            if response_time_ms is not None:
                resp_text = Text(f"{response_time_ms:.1f}ms")
            else:
                resp_text = Text("-")

            last_text = Text(str(last_check_at or "never"))
            self.add_row(name_text, status_text, resp_text, last_text)


class TunnelStatus(Static):
    """Widget showing the reachability status of Cloudflare tunnels."""

    def update_tunnel(self, name: str, reachable: bool, latency: float) -> None:
        icon = "[green]OK[/green]" if reachable else "[red]DOWN[/red]"
        self.update(f"  {name}: {icon} ({latency:.0f}ms)")


class RecoveryLog(Static):
    """Scrollable log showing the most recent recovery events."""

    def update_entries(self, entries: list[dict]) -> None:
        """Replace the log content with a list of recovery event dicts.

        Each dict: service_name, action, result, started_at
        """
        if not entries:
            self.update("[dim]No recovery events recorded[/dim]")
            return

        lines = []
        for entry in entries:
            time_str = entry.get("started_at", "-")
            service = entry.get("service_name", "-")
            action = entry.get("action", "-")
            result = entry.get("result", "unknown")

            color = "green" if result == "success" else "red"
            lines.append(
                f"  [{time_str}] {service}: {action} -> [{color}]{result}[/{color}]"
            )

        self.update("\n".join(lines))


class DownloadPanel(Static):
    """Panel displaying current download/upload throughput and speed profile."""

    def update_download(
        self,
        download_speed: Optional[float] = None,
        upload_speed: Optional[float] = None,
        speed_profile: str = "-",
        active_torrents: int = 0,
    ) -> None:
        dl = f"{download_speed:.1f} KB/s" if download_speed is not None else "-"
        ul = f"{upload_speed:.1f} KB/s" if upload_speed is not None else "-"
        lines = [
            f"[bold]Download:[/bold] {dl}",
            f"[bold]Upload:[/bold]   {ul}",
            f"[bold]Profile:[/bold]  {speed_profile}",
            f"[bold]Active:[/bold]   {active_torrents} torrents",
        ]
        self.update("\n".join(lines))


class MediaSentinelApp(App):
    CSS = """
    Screen {
        layout: vertical;
    }

    #header-bar {
        height: 3;
        dock: top;
        background: $surface;
        padding: 0 1;
    }

    #main-content {
        layout: horizontal;
        height: 1fr;
    }

    #left-panel {
        width: 1fr;
        border: solid $primary;
        padding: 0 1;
        margin: 0 1;
    }

    #right-panel {
        width: 32;
        border: solid $primary;
        padding: 0 1;
        margin: 0 1 0 0;
    }

    #bottom-panel {
        height: auto;
        max-height: 10;
        border: solid $primary;
        padding: 0 1;
        margin: 0 1 1 1;
    }

    .panel-title {
        text-style: bold;
        margin-bottom: 1;
    }

    #vpn-detail {
        margin-bottom: 1;
    }

    #download-detail {
        margin-top: 1;
    }

    #tunnel-section {
        margin-bottom: 0;
    }

    #recovery-log {
        margin-top: 0;
    }
    """

    BINDINGS = [
        ("q", "quit", "Quit"),
        ("r", "refresh", "Refresh"),
    ]

    TITLE = "MediaSentinel"

    def __init__(self, config_path: str = "config.yaml", **kwargs):
        super().__init__(**kwargs)
        self._config_path = config_path
        self._config: Optional[AppConfig] = None
        self._db_path: Optional[Path] = None

    def compose(self) -> ComposeResult:
        yield Header(show_clock=True)
        with Horizontal(id="header-bar"):
            yield Label("MediaSentinel Dashboard", classes="panel-title")
            yield VPNIndicator()
        with Horizontal(id="main-content"):
            with Container(id="left-panel"):
                yield Label("Services", classes="panel-title")
                yield ServiceTable()
            with Vertical(id="right-panel"):
                yield Label("VPN Details", classes="panel-title")
                yield VPNPanel(id="vpn-detail")
                yield Label("Download", classes="panel-title")
                yield DownloadPanel(id="download-detail")
        with Container(id="bottom-panel"):
            with Horizontal(id="tunnel-section"):
                yield Label("Tunnels", classes="panel-title")
                yield TunnelStatus()
            yield Label("Recovery Log", classes="panel-title")
            yield RecoveryLog(id="recovery-log")
        yield Footer()

    def on_mount(self) -> None:
        try:
            self._config = load_config(Path(self._config_path))
            import os
            self._db_path = Path(os.path.expandvars(self._config.database.db_path))
        except Exception:
            self._config = None
        self._refresh_loop()

    def _refresh_loop(self) -> None:
        self.run_worker(self._poll_data, exclusive=True)

    async def _poll_data(self) -> None:
        while True:
            await self._load_data()
            await asyncio.sleep(5)

    async def _load_data(self) -> None:
        if not self._config or not self._db_path or not self._db_path.exists():
            return

        try:
            async with get_db(self._db_path) as db:
                # --- Service table rows ---
                cursor = await db.execute(
                    "SELECT name, status, response_time_ms, last_check_at "
                    "FROM services ORDER BY name"
                )
                service_rows = await cursor.fetchall()

                # --- Recovery events ---
                cursor = await db.execute(
                    "SELECT service_name, action, result, started_at "
                    "FROM recovery_events ORDER BY started_at DESC LIMIT 5"
                )
                recovery_rows = await cursor.fetchall()

                # --- VPN state snapshot ---
                cursor = await db.execute(
                    "SELECT snapshot_data FROM state_snapshots "
                    "WHERE snapshot_type = 'vpn' ORDER BY created_at DESC LIMIT 1"
                )
                vpn_row = await cursor.fetchone()

                # --- Download throughput metrics ---
                cursor = await db.execute(
                    "SELECT metric_name, value FROM metrics "
                    "WHERE metric_type = 'download_throughput' "
                    "ORDER BY recorded_at DESC LIMIT 10"
                )
                metric_rows = await cursor.fetchall()

                # --- Active torrents count ---
                cursor = await db.execute(
                    "SELECT value FROM metrics "
                    "WHERE metric_name = 'active_torrents' "
                    "ORDER BY recorded_at DESC LIMIT 1"
                )
                torrent_row = await cursor.fetchone()

                # --- Tunnel state snapshot ---
                cursor = await db.execute(
                    "SELECT snapshot_data FROM state_snapshots "
                    "WHERE snapshot_type = 'tunnel' ORDER BY created_at DESC LIMIT 1"
                )
                tunnel_row = await cursor.fetchone()

            # Update service table with color-coded rows
            table = self.query_one(ServiceTable)
            table.update_services(
                [(r["name"], r["status"], r["response_time_ms"], r["last_check_at"]) for r in service_rows]
            )

            # Update VPN indicator badge and detail panel
            vpn_indicator = self.query_one(VPNIndicator)
            vpn_panel = self.query_one(VPNPanel)
            if vpn_row:
                data = json.loads(vpn_row["snapshot_data"])
                vpn_indicator.vpn_state = data.get("state", "disconnected")
                vpn_panel.update_vpn(
                    state=data.get("state", "disconnected"),
                    adapter_name=data.get("adapter_name"),
                    external_ip=data.get("external_ip"),
                    latency_ms=data.get("latency_ms"),
                    dns_leak=data.get("dns_leak"),
                    ip_leak=data.get("ip_leak"),
                )
            else:
                vpn_indicator.vpn_state = "disconnected"
                vpn_panel.update_vpn(state="disconnected")

            # Update recovery log
            recovery_log = self.query_one(RecoveryLog)
            recovery_entries = [dict(r) for r in recovery_rows]
            recovery_log.update_entries(recovery_entries)

            # Update download panel
            download_speed = None
            upload_speed = None
            for m in metric_rows:
                if m["metric_name"] == "download_speed" and download_speed is None:
                    download_speed = m["value"]
                elif m["metric_name"] == "upload_speed" and upload_speed is None:
                    upload_speed = m["value"]

            speed_profile = "-"
            if self._config and self._config.qbt:
                speed_profile = self._config.qbt.speed_profile

            active_torrents = int(torrent_row["value"]) if torrent_row else 0

            download_panel = self.query_one(DownloadPanel)
            download_panel.update_download(
                download_speed=download_speed,
                upload_speed=upload_speed,
                speed_profile=speed_profile,
                active_torrents=active_torrents,
            )

            # Update tunnel status
            tunnel_status = self.query_one(TunnelStatus)
            if tunnel_row:
                tunnel_data = json.loads(tunnel_row["snapshot_data"])
                tunnel_name = tunnel_data.get("tunnel_name", "tunnel")
                reachable = tunnel_data.get("url_reachable", False)
                latency = tunnel_data.get("latency_ms", 0.0)
                tunnel_status.update_tunnel(tunnel_name, reachable, latency)

        except Exception as e:
            from loguru import logger as _logger
            _logger.bind(component="TUI", action="load_data").error("Failed to refresh dashboard: {}", e)

    def action_refresh(self) -> None:
        self.run_worker(self._load_data, exclusive=True)
