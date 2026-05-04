import json
import pytest
from datetime import datetime
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

from mediasentinel.config.models import AppConfig
from mediasentinel.db.connection import get_db, init_db


@pytest.fixture
def test_config():
    return AppConfig(
        services=[
            {"name": "TestService", "url": "http://localhost:8080"},
        ],
        vpn={"adapter_description": "TestVPN"},
        logging={"log_dir": "/tmp/test-ms-logs"},
        database={"db_path": "/tmp/test-ms-startup.sqlite"},
    )


async def test_check_database_success(tmp_path):
    from mediasentinel.core.startup import _check_database

    db_path = tmp_path / "test.sqlite"
    result = await _check_database(db_path)
    assert result.passed is True
    assert result.name == "database"


async def test_check_database_failure(tmp_path):
    from mediasentinel.core.startup import _check_database

    # Use an impossible path
    result = await _check_database(Path("/nonexistent/impossible/path/db.sqlite"))
    # It might pass because parent mkdir succeeds, so let's test differently
    # by mocking init_db to raise
    with patch("mediasentinel.core.startup.init_db", new_callable=AsyncMock, side_effect=PermissionError("no access")):
        result = await _check_database(Path("/some/path"))
    assert result.passed is False


def test_check_service_urls_valid(test_config):
    from mediasentinel.core.startup import _check_service_urls

    result = _check_service_urls(test_config)
    assert result.passed is True


async def test_check_docker_not_installed():
    from mediasentinel.core.startup import _check_docker

    with patch.dict("sys.modules", {"docker": None}):
        # Force import failure
        import importlib
        with patch("builtins.__import__", side_effect=ImportError("no docker")):
            result = await _check_docker()
    assert result.passed is False


async def test_check_docker_available():
    from mediasentinel.core.startup import _check_docker

    mock_client = MagicMock()
    mock_client.ping.return_value = True

    with patch("docker.from_env", return_value=mock_client):
        result = await _check_docker()
    assert result.passed is True
    mock_client.close.assert_called_once()


async def test_run_startup_checks(test_config, tmp_path):
    from mediasentinel.core.startup import run_startup_checks

    db_path = tmp_path / "startup_test.sqlite"
    results = await run_startup_checks(test_config, db_path)

    names = [r.name for r in results]
    assert "database" in names
    assert "service_urls" in names
    assert "docker" in names

    db_result = next(r for r in results if r.name == "database")
    assert db_result.passed is True


# ======================================================================
# Graceful shutdown tests (DEP-03)
# ======================================================================


async def test_graceful_shutdown_saves_snapshot(tmp_path):
    """Verify that shutdown() saves a 'shutdown' type snapshot to the database."""
    from mediasentinel.core.orchestrator import Orchestrator
    from mediasentinel.db.connection import get_db, init_db

    config = AppConfig(
        services=[
            {"name": "TestService", "url": "http://localhost:8080"},
        ],
        vpn={"adapter_description": "TestVPN"},
        logging={"log_dir": str(tmp_path / "logs")},
        database={"db_path": str(tmp_path / "shutdown_test.sqlite")},
    )

    db_path = tmp_path / "shutdown_test.sqlite"

    orch = Orchestrator(config)

    # Initialize orchestrator to set up DB
    await orch.initialize()

    # Mock the qbt_controller AFTER initialize (which creates a real one)
    mock_qbt = MagicMock()
    mock_qbt.enforce_vpn_gate = MagicMock()
    mock_qbt.close = MagicMock()
    orch.qbt_controller = mock_qbt

    # Run shutdown
    await orch.shutdown()

    # Verify shutdown snapshot was saved
    async with get_db(db_path) as db:
        cursor = await db.execute(
            "SELECT snapshot_type, snapshot_data FROM state_snapshots WHERE snapshot_type = 'shutdown'"
        )
        rows = await cursor.fetchall()

    assert len(rows) == 1
    snapshot = json.loads(rows[0]["snapshot_data"])
    assert snapshot["shutdown_reason"] == "graceful"
    assert "shutdown_at" in snapshot
    assert "services" in snapshot
    assert snapshot["vpn"]["state"] in ("disconnected", "connected", "connecting", "degraded")

    # Verify qBittorrent was paused
    mock_qbt.enforce_vpn_gate.assert_called_once()


async def test_shutdown_closes_all_agents(tmp_path):
    """Verify that shutdown() calls close() on all agent instances."""
    from mediasentinel.core.orchestrator import Orchestrator
    from mediasentinel.agents.models import VPNState

    config = AppConfig(
        services=[
            {"name": "TestService", "url": "http://localhost:8080"},
        ],
        vpn={"adapter_description": "TestVPN"},
        logging={"log_dir": str(tmp_path / "logs")},
        database={"db_path": str(tmp_path / "shutdown_agents_test.sqlite")},
    )

    orch = Orchestrator(config)

    # Mock all agents
    mock_health = AsyncMock()
    mock_vpn = AsyncMock()
    mock_tunnel = AsyncMock()
    mock_qbt = MagicMock()
    mock_alert = AsyncMock()
    mock_recovery = MagicMock()

    orch.health_monitor = mock_health
    orch.vpn_guard = mock_vpn
    orch.tunnel_guard = mock_tunnel
    orch.qbt_controller = mock_qbt
    orch.alert_dispatcher = mock_alert
    orch.recovery_engine = mock_recovery
    orch._vpn_state = VPNState.CONNECTED
    orch._db_path = tmp_path / "test.sqlite"

    # Need DB initialized for snapshot save
    db_path = tmp_path / "shutdown_agents_test.sqlite"
    await init_db(db_path)
    orch._db_path = db_path

    await orch.shutdown()

    mock_health.close.assert_called_once()
    mock_vpn.close.assert_called_once()
    mock_tunnel.close.assert_called_once()
    mock_qbt.close.assert_called_once()
    mock_alert.close.assert_called_once()


async def test_shutdown_sets_shutdown_event(tmp_path):
    """Verify that shutdown() sets the shutdown event."""
    from mediasentinel.core.orchestrator import Orchestrator

    config = AppConfig(
        services=[
            {"name": "TestService", "url": "http://localhost:8080"},
        ],
        vpn={"adapter_description": "TestVPN"},
        logging={"log_dir": str(tmp_path / "logs")},
        database={"db_path": str(tmp_path / "shutdown_event_test.sqlite")},
    )

    orch = Orchestrator(config)
    orch._db_path = tmp_path / "test.sqlite"

    # Initialize DB for snapshot save
    db_path = tmp_path / "shutdown_event_test.sqlite"
    await init_db(db_path)
    orch._db_path = db_path

    assert not orch._shutdown_event.is_set()
    await orch.shutdown()
    assert orch._shutdown_event.is_set()


# ======================================================================
# Snapshot restore on startup tests (DEP-03)
# ======================================================================


async def test_restore_shutdown_snapshot_restores_service_status(tmp_path):
    """Verify that _restore_shutdown_snapshot updates DB service statuses from snapshot."""
    from mediasentinel.core.orchestrator import Orchestrator
    from mediasentinel.db.connection import get_db, init_db

    config = AppConfig(
        services=[
            {"name": "Jellyfin", "url": "http://localhost:8096"},
            {"name": "Radarr", "url": "http://localhost:7878"},
        ],
        vpn={"adapter_description": "TestVPN"},
        logging={"log_dir": str(tmp_path / "logs")},
        database={"db_path": str(tmp_path / "restore_test.sqlite")},
    )

    db_path = tmp_path / "restore_test.sqlite"
    await init_db(db_path)

    # Seed initial services with 'unknown' status
    async with get_db(db_path) as db:
        await db.execute(
            "INSERT OR REPLACE INTO services (name, url, status, critical, poll_interval_seconds, failure_threshold, consecutive_failures) "
            "VALUES ('Jellyfin', 'http://localhost:8096', 'unknown', 0, 30, 3, 0)"
        )
        await db.execute(
            "INSERT OR REPLACE INTO services (name, url, status, critical, poll_interval_seconds, failure_threshold, consecutive_failures) "
            "VALUES ('Radarr', 'http://localhost:7878', 'unknown', 0, 30, 3, 0)"
        )
        await db.commit()

    # Insert a shutdown snapshot with known service statuses
    snapshot_data = json.dumps({
        "captured_at": datetime.now().isoformat(),
        "services": [
            {"name": "Jellyfin", "status": "healthy", "consecutive_failures": 0},
            {"name": "Radarr", "status": "unhealthy", "consecutive_failures": 5},
        ],
        "vpn": {"state": "connected"},
    })
    async with get_db(db_path) as db:
        await db.execute(
            "INSERT INTO state_snapshots (snapshot_type, snapshot_data, created_at) VALUES (?, ?, ?)",
            ("shutdown", snapshot_data, datetime.now().isoformat()),
        )
        await db.commit()

    orch = Orchestrator(config)
    orch._db_path = db_path

    await orch._restore_shutdown_snapshot()

    # Verify service statuses were restored
    async with get_db(db_path) as db:
        cursor = await db.execute("SELECT name, status, consecutive_failures FROM services ORDER BY name")
        rows = await cursor.fetchall()

    row_map = {r["name"]: r for r in rows}
    assert row_map["Jellyfin"]["status"] == "healthy"
    assert row_map["Jellyfin"]["consecutive_failures"] == 0
    assert row_map["Radarr"]["status"] == "unhealthy"
    assert row_map["Radarr"]["consecutive_failures"] == 5

    # Verify shutdown snapshot was deleted
    async with get_db(db_path) as db:
        cursor = await db.execute(
            "SELECT COUNT(*) FROM state_snapshots WHERE snapshot_type = 'shutdown'"
        )
        count = (await cursor.fetchone())[0]
    assert count == 0


async def test_restore_shutdown_snapshot_restores_vpn_state(tmp_path):
    """Verify that _restore_shutdown_snapshot sets the VPN state from snapshot."""
    from mediasentinel.core.orchestrator import Orchestrator
    from mediasentinel.agents.models import VPNState
    from mediasentinel.db.connection import get_db, init_db

    config = AppConfig(
        services=[
            {"name": "TestService", "url": "http://localhost:8080"},
        ],
        vpn={"adapter_description": "TestVPN"},
        logging={"log_dir": str(tmp_path / "logs")},
        database={"db_path": str(tmp_path / "vpn_restore_test.sqlite")},
    )

    db_path = tmp_path / "vpn_restore_test.sqlite"
    await init_db(db_path)

    # Insert a shutdown snapshot with VPN connected state
    snapshot_data = json.dumps({
        "captured_at": datetime.now().isoformat(),
        "services": [],
        "vpn": {"state": "connected"},
    })
    async with get_db(db_path) as db:
        await db.execute(
            "INSERT INTO state_snapshots (snapshot_type, snapshot_data, created_at) VALUES (?, ?, ?)",
            ("shutdown", snapshot_data, datetime.now().isoformat()),
        )
        await db.commit()

    orch = Orchestrator(config)
    orch._db_path = db_path

    # Default VPN state should be DISCONNECTED
    assert orch._vpn_state == VPNState.DISCONNECTED

    await orch._restore_shutdown_snapshot()

    # Should now be CONNECTED from the snapshot
    assert orch._vpn_state == VPNState.CONNECTED


async def test_restore_shutdown_snapshot_no_snapshot(tmp_path):
    """Verify that _restore_shutdown_snapshot is a no-op when no snapshot exists."""
    from mediasentinel.core.orchestrator import Orchestrator
    from mediasentinel.agents.models import VPNState

    config = AppConfig(
        services=[
            {"name": "TestService", "url": "http://localhost:8080"},
        ],
        vpn={"adapter_description": "TestVPN"},
        logging={"log_dir": str(tmp_path / "logs")},
        database={"db_path": str(tmp_path / "no_snapshot_test.sqlite")},
    )

    db_path = tmp_path / "no_snapshot_test.sqlite"
    from mediasentinel.db.connection import init_db
    await init_db(db_path)

    orch = Orchestrator(config)
    orch._db_path = db_path

    assert orch._vpn_state == VPNState.DISCONNECTED
    await orch._restore_shutdown_snapshot()
    # Should still be DISCONNECTED (no snapshot to restore)
    assert orch._vpn_state == VPNState.DISCONNECTED


async def test_full_shutdown_then_restore_cycle(tmp_path):
    """End-to-end test: initialize, set state, shutdown, re-initialize, verify restored."""
    from mediasentinel.core.orchestrator import Orchestrator
    from mediasentinel.agents.models import VPNState
    from mediasentinel.db.connection import get_db, init_db

    config = AppConfig(
        services=[
            {"name": "TestService", "url": "http://localhost:8080"},
        ],
        vpn={"adapter_description": "TestVPN"},
        logging={"log_dir": str(tmp_path / "logs")},
        database={"db_path": str(tmp_path / "cycle_test.sqlite")},
    )

    db_path = tmp_path / "cycle_test.sqlite"

    # First orchestrator: initialize, set state, shutdown
    orch1 = Orchestrator(config)
    await orch1.initialize()

    # Simulate a connected VPN state
    orch1._vpn_state = VPNState.CONNECTED

    await orch1.shutdown()

    # Verify snapshot was saved
    async with get_db(db_path) as db:
        cursor = await db.execute(
            "SELECT snapshot_data FROM state_snapshots WHERE snapshot_type = 'shutdown'"
        )
        rows = await cursor.fetchall()
    assert len(rows) == 1

    # Second orchestrator: initialize and verify restore
    orch2 = Orchestrator(config)
    await orch2.initialize()

    # VPN state should have been restored to CONNECTED
    assert orch2._vpn_state == VPNState.CONNECTED

    # Shutdown snapshot should have been consumed
    async with get_db(db_path) as db:
        cursor = await db.execute(
            "SELECT COUNT(*) FROM state_snapshots WHERE snapshot_type = 'shutdown'"
        )
        count = (await cursor.fetchone())[0]
    assert count == 0
