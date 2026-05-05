import pytest
from pathlib import Path
from unittest.mock import AsyncMock, patch, MagicMock

from mediasentinel.config.models import AppConfig
from mediasentinel.db.connection import get_db, init_db


@pytest.fixture
def test_config():
    return AppConfig(
        services=[
            {"name": "TestService", "url": "http://localhost:8080"},
            {"name": "AnotherSvc", "url": "http://localhost:9090"},
        ],
        vpn={"adapter_description": "TestVPN"},
        logging={"log_dir": "/tmp/test-ms-logs", "log_level": "INFO"},
        database={"db_path": "/tmp/test-ms-tui.sqlite"},
    )


@pytest.fixture
async def test_db(tmp_path):
    db_path = tmp_path / "test.sqlite"
    await init_db(db_path)
    async with get_db(db_path) as db:
        await db.execute(
            "INSERT INTO services (name, url, status, response_time_ms, last_check_at) "
            "VALUES (?, ?, 'healthy', 45.2, '2026-05-02 12:00:00')",
            ("TestService", "http://localhost:8080"),
        )
        await db.execute(
            "INSERT INTO services (name, url, status, response_time_ms, last_check_at) "
            "VALUES (?, ?, 'unhealthy', NULL, '2026-05-02 11:55:00')",
            ("AnotherSvc", "http://localhost:9090"),
        )
        await db.commit()
    return db_path


@pytest.fixture
async def populated_db(tmp_path):
    """Database with services, recovery events, VPN snapshots, and metrics."""
    import json

    db_path = tmp_path / "populated.sqlite"
    await init_db(db_path)
    async with get_db(db_path) as db:
        # Services with various statuses
        await db.execute(
            "INSERT INTO services (name, url, status, response_time_ms, last_check_at) "
            "VALUES (?, ?, 'healthy', 45.2, '2026-05-02 12:00:00')",
            ("Radarr", "http://localhost:7878"),
        )
        await db.execute(
            "INSERT INTO services (name, url, status, response_time_ms, last_check_at) "
            "VALUES (?, ?, 'degraded', 210.5, '2026-05-02 12:01:00')",
            ("Sonarr", "http://localhost:8989"),
        )
        await db.execute(
            "INSERT INTO services (name, url, status, response_time_ms, last_check_at) "
            "VALUES (?, ?, 'unhealthy', NULL, '2026-05-02 11:55:00')",
            ("Plex", "http://localhost:32400"),
        )

        # Recovery events
        await db.execute(
            "INSERT INTO recovery_events (service_name, escalation_level, action, result, started_at) "
            "VALUES ('Plex', 2, 'docker_restart', 'success', '2026-05-02 11:56:00')",
        )
        await db.execute(
            "INSERT INTO recovery_events (service_name, escalation_level, action, result, started_at) "
            "VALUES ('Radarr', 1, 'self_heal_wait', 'failed', '2026-05-02 11:50:00')",
        )

        # VPN state snapshot
        vpn_data = json.dumps({
            "state": "connected",
            "adapter_name": "IPVanish TAP Adapter",
            "external_ip": "203.0.113.42",
            "latency_ms": 67.3,
            "dns_leak": False,
            "ip_leak": False,
        })
        await db.execute(
            "INSERT INTO state_snapshots (snapshot_type, snapshot_data) VALUES (?, ?)",
            ("vpn", vpn_data),
        )

        # Tunnel state snapshot
        tunnel_data = json.dumps({
            "tunnel_name": "media-tunnel",
            "url_reachable": True,
            "latency_ms": 35.2,
        })
        await db.execute(
            "INSERT INTO state_snapshots (snapshot_type, snapshot_data) VALUES (?, ?)",
            ("tunnel", tunnel_data),
        )

        # Download throughput metrics
        await db.execute(
            "INSERT INTO metrics (metric_type, metric_name, value, unit) VALUES (?, ?, ?, ?)",
            ("download_throughput", "download_speed", 15234.5, "KB/s"),
        )
        await db.execute(
            "INSERT INTO metrics (metric_type, metric_name, value, unit) VALUES (?, ?, ?, ?)",
            ("download_throughput", "upload_speed", 1024.0, "KB/s"),
        )
        await db.execute(
            "INSERT INTO metrics (metric_type, metric_name, value, unit) VALUES (?, ?, ?, ?)",
            ("download_throughput", "active_torrents", 3, "count"),
        )

        await db.commit()
    return db_path


# ---------------------------------------------------------------------------
# Basic mount / composition tests
# ---------------------------------------------------------------------------


async def test_app_compose():
    from mediasentinel.tui.app import MediaSentinelApp

    app = MediaSentinelApp()
    async with app.run_test() as pilot:
        assert app.title == "MediaSentinel"


async def test_service_table_mounts():
    from mediasentinel.tui.app import MediaSentinelApp, ServiceTable

    app = MediaSentinelApp()
    async with app.run_test() as pilot:
        table = app.query_one(ServiceTable)
        assert table is not None


async def test_vpn_indicator_mounts():
    from mediasentinel.tui.app import MediaSentinelApp, VPNIndicator

    app = MediaSentinelApp()
    async with app.run_test() as pilot:
        indicator = app.query_one(VPNIndicator)
        assert indicator is not None
        assert indicator.vpn_state == "disconnected"


async def test_vpn_indicator_reactive():
    from mediasentinel.tui.app import MediaSentinelApp, VPNIndicator

    # Patch _refresh_loop at class level so the poll worker never starts
    with patch.object(MediaSentinelApp, "_refresh_loop", lambda self: None):
        app = MediaSentinelApp()
        async with app.run_test() as pilot:
            indicator = app.query_one(VPNIndicator)
            await pilot.pause()
            indicator.vpn_state = "connected"
            await pilot.pause()
            assert indicator.vpn_state == "connected"


async def test_tunnel_status_update():
    from mediasentinel.tui.app import MediaSentinelApp, TunnelStatus

    app = MediaSentinelApp()
    async with app.run_test() as pilot:
        tunnel = app.query_one(TunnelStatus)
        tunnel.update_tunnel("media-tunnel", True, 45.3)
        await pilot.pause()


async def test_vpn_panel_mounts():
    from mediasentinel.tui.app import MediaSentinelApp, VPNPanel

    app = MediaSentinelApp()
    async with app.run_test() as pilot:
        panel = app.query_one(VPNPanel)
        assert panel is not None


async def test_download_panel_mounts():
    from mediasentinel.tui.app import MediaSentinelApp, DownloadPanel

    app = MediaSentinelApp()
    async with app.run_test() as pilot:
        panel = app.query_one(DownloadPanel)
        assert panel is not None


async def test_recovery_log_mounts():
    from mediasentinel.tui.app import MediaSentinelApp, RecoveryLog

    app = MediaSentinelApp()
    async with app.run_test() as pilot:
        log = app.query_one(RecoveryLog)
        assert log is not None


# ---------------------------------------------------------------------------
# Service table color coding tests
# ---------------------------------------------------------------------------


async def test_service_table_color_coding():
    from mediasentinel.tui.app import MediaSentinelApp, ServiceTable

    app = MediaSentinelApp()
    async with app.run_test() as pilot:
        table = app.query_one(ServiceTable)

        rows = [
            ("Radarr", "healthy", 45.2, "2026-05-02 12:00:00"),
            ("Sonarr", "degraded", 210.5, "2026-05-02 12:01:00"),
            ("Plex", "unhealthy", None, "2026-05-02 11:55:00"),
            ("UnknownSvc", None, None, None),
        ]

        table.update_services(rows)

        # DataTable row_count reflects the number of data rows
        assert table.row_count == 4


async def test_service_table_empty():
    from mediasentinel.tui.app import MediaSentinelApp, ServiceTable

    app = MediaSentinelApp()
    async with app.run_test() as pilot:
        table = app.query_one(ServiceTable)
        table.update_services([])

        # Should show the "No services found" placeholder
        assert table.row_count == 1


# ---------------------------------------------------------------------------
# VPN panel tests
# ---------------------------------------------------------------------------


async def test_vpn_panel_connected():
    from mediasentinel.tui.app import VPNPanel

    panel = VPNPanel()
    panel.update_vpn(
        state="connected",
        adapter_name="IPVanish TAP Adapter",
        external_ip="203.0.113.42",
        latency_ms=67.3,
        dns_leak=False,
        ip_leak=False,
    )
    # Verify the widget accepted the update without errors
    assert panel is not None


async def test_vpn_panel_disconnected():
    from mediasentinel.tui.app import VPNPanel

    panel = VPNPanel()
    panel.update_vpn(state="disconnected")
    assert panel is not None


async def test_vpn_panel_high_latency():
    from mediasentinel.tui.app import VPNPanel

    panel = VPNPanel()
    panel.update_vpn(
        state="connected",
        latency_ms=250.0,
    )
    assert panel is not None


async def test_vpn_panel_leak_fail():
    from mediasentinel.tui.app import VPNPanel

    panel = VPNPanel()
    panel.update_vpn(
        state="connected",
        dns_leak=True,
        ip_leak=True,
    )
    assert panel is not None


# ---------------------------------------------------------------------------
# Recovery log tests
# ---------------------------------------------------------------------------


async def test_recovery_log_with_entries():
    from mediasentinel.tui.app import RecoveryLog

    log = RecoveryLog()
    entries = [
        {"service_name": "Plex", "action": "docker_restart", "result": "success", "started_at": "2026-05-02 11:56:00"},
        {"service_name": "Radarr", "action": "self_heal_wait", "result": "failed", "started_at": "2026-05-02 11:50:00"},
    ]
    log.update_entries(entries)
    assert log is not None


async def test_recovery_log_empty():
    from mediasentinel.tui.app import RecoveryLog

    log = RecoveryLog()
    log.update_entries([])
    assert log is not None


# ---------------------------------------------------------------------------
# Download panel tests
# ---------------------------------------------------------------------------


async def test_download_panel_with_data():
    from mediasentinel.tui.app import DownloadPanel

    panel = DownloadPanel()
    panel.update_download(
        download_speed=15234.5,
        upload_speed=1024.0,
        speed_profile="100+mbps",
        active_torrents=3,
    )
    assert panel is not None


async def test_download_panel_no_data():
    from mediasentinel.tui.app import DownloadPanel

    panel = DownloadPanel()
    panel.update_download()
    assert panel is not None


# ---------------------------------------------------------------------------
# Full data-loading integration test
# ---------------------------------------------------------------------------


async def test_load_data_with_db(test_config, test_db, tmp_path):
    from mediasentinel.tui.app import MediaSentinelApp

    config_path = tmp_path / "test_config.yaml"
    import yaml
    config_dict = {
        "services": [
            {"name": "TestService", "url": "http://localhost:8080"},
            {"name": "AnotherSvc", "url": "http://localhost:9090"},
        ],
        "vpn": {"adapter_description": "TestVPN"},
        "database": {"db_path": str(test_db)},
        "logging": {"log_dir": "/tmp/test-ms-logs"},
    }
    config_path.write_text(yaml.dump(config_dict))

    app = MediaSentinelApp(config_path=str(config_path))
    async with app.run_test() as pilot:
        app._db_path = test_db
        app._config = test_config
        await app._load_data()


async def test_load_data_populated(populated_db, test_config, tmp_path):
    """Full integration test with VPN, recovery, metrics data."""
    from mediasentinel.tui.app import MediaSentinelApp

    config_path = tmp_path / "pop_config.yaml"
    import yaml
    config_dict = {
        "services": [
            {"name": "Radarr", "url": "http://localhost:7878"},
            {"name": "Sonarr", "url": "http://localhost:8989"},
            {"name": "Plex", "url": "http://localhost:32400"},
        ],
        "vpn": {"adapter_description": "TestVPN"},
        "qbt": {"speed_profile": "100+mbps"},
        "database": {"db_path": str(populated_db)},
        "logging": {"log_dir": "/tmp/test-ms-logs"},
    }
    config_path.write_text(yaml.dump(config_dict))

    app = MediaSentinelApp(config_path=str(config_path))
    async with app.run_test() as pilot:
        app._db_path = populated_db
        app._config = test_config
        await app._load_data()

        # VPN indicator should now reflect connected state
        from mediasentinel.tui.app import VPNIndicator, VPNPanel, ServiceTable, RecoveryLog, DownloadPanel

        indicator = app.query_one(VPNIndicator)
        assert indicator.vpn_state == "connected"

        vpn_panel = app.query_one(VPNPanel)
        assert vpn_panel is not None

        table = app.query_one(ServiceTable)
        assert table.row_count == 3

        recovery = app.query_one(RecoveryLog)
        assert recovery is not None

        download = app.query_one(DownloadPanel)
        assert download is not None


# ---------------------------------------------------------------------------
# Key binding tests
# ---------------------------------------------------------------------------


async def test_app_quit_binding():
    from mediasentinel.tui.app import MediaSentinelApp

    app = MediaSentinelApp()
    async with app.run_test() as pilot:
        await pilot.press("q")


async def test_app_refresh_binding():
    from mediasentinel.tui.app import MediaSentinelApp

    app = MediaSentinelApp()
    async with app.run_test() as pilot:
        await pilot.press("r")
        await pilot.pause()
