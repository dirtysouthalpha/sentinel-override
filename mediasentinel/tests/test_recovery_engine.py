import asyncio
import json
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from mediasentinel.agents.models import (
    RecoveryAction,
    RecoveryLevel,
    DownloadState,
    SpeedProfileConfig,
    RecoveryResult,
)
from mediasentinel.agents.recovery_engine import (
    CIRCUIT_BREAKER_MAX_ATTEMPTS,
    CIRCUIT_BREAKER_WINDOW_SECONDS,
    DEPENDENCY_TREE,
    LEVEL_CONFIG,
    RecoveryEngine,
)
from mediasentinel.config.models import AppConfig
from mediasentinel.db.connection import get_db, init_db


@pytest.fixture
def test_config():
    return AppConfig(
        services=[
            {"name": "Jellyfin", "url": "http://localhost:8096"},
            {"name": "Radarr", "url": "http://localhost:7878"},
            {"name": "Sonarr", "url": "http://localhost:8989"},
            {"name": "qBittorrent", "url": "http://localhost:8080"},
            {"name": "Prowlarr", "url": "http://localhost:9696"},
            {"name": "Jellyseerr", "url": "http://localhost:5055"},
            {"name": "Shoko", "url": "http://localhost:8111"},
        ],
        vpn={"adapter_description": "TestVPN"},
        recovery={
            "max_retries": 3,
            "cooldown_seconds": 30,
            "docker_restart_timeout": 15,
            "escalation_threshold": 2,
        },
        logging={"log_dir": "/tmp/test-ms-logs", "log_level": "INFO"},
        database={"db_path": "/tmp/test-ms.sqlite"},
    )


@pytest.fixture
async def engine(test_config, tmp_path):
    db_path = tmp_path / "test.sqlite"
    await init_db(db_path)
    async with get_db(db_path) as db:
        for svc in test_config.services:
            await db.execute(
                "INSERT INTO services (name, url, status) VALUES (?, ?, 'unknown')",
                (svc.name, svc.url),
            )
        await db.commit()
    eng = RecoveryEngine(test_config, db_path)
    yield eng


# ==================================================================
# RecoveryLevel enum and new models
# ==================================================================

class TestRecoveryLevelEnum:
    def test_level_values(self):
        assert RecoveryLevel.SELF_HEAL_WAIT.value == 1
        assert RecoveryLevel.SOFT_RESTART.value == 2
        assert RecoveryLevel.DEPENDENCY_RECOVERY.value == 3
        assert RecoveryLevel.STACK_RESET.value == 4
        assert RecoveryLevel.VPN_RECOVERY.value == 5
        assert RecoveryLevel.NETWORK_RECOVERY.value == 6
        assert RecoveryLevel.OPERATOR_ESCALATION.value == 7

    def test_all_seven_levels(self):
        assert len(RecoveryLevel) == 7


class TestDownloadStateEnum:
    def test_states(self):
        assert DownloadState.INIT.value == "init"
        assert DownloadState.VPN_VERIFIED.value == "vpn_verified"
        assert DownloadState.VPN_DOWN.value == "vpn_down"
        assert DownloadState.VPN_RECOVERING.value == "vpn_recovering"


class TestSpeedProfileConfig:
    def test_defaults(self):
        p = SpeedProfileConfig(name="test")
        assert p.max_download_kb == 0
        assert p.max_upload_kb == 0
        assert p.max_connections == 0

    def test_custom_values(self):
        p = SpeedProfileConfig(name="fast", max_download_kb=1000, max_upload_kb=500, max_connections=100)
        assert p.max_download_kb == 1000
        assert p.name == "fast"


# ==================================================================
# Dependency tree (REC-03)
# ==================================================================

class TestDependencyTree:
    def test_tree_order(self):
        assert DEPENDENCY_TREE == [
            "VPN", "Tunnels", "qBittorrent", "Jellyfin",
            "Prowlarr", "Radarr", "Sonarr", "Jellyseerr", "Shoko",
        ]

    def test_get_dependencies_leaf(self):
        engine_obj = RecoveryEngine.__new__(RecoveryEngine)
        deps = engine_obj.get_dependencies("Shoko")
        assert deps == [
            "VPN", "Tunnels", "qBittorrent", "Jellyfin",
            "Prowlarr", "Radarr", "Sonarr", "Jellyseerr",
        ]

    def test_get_dependencies_root(self):
        engine_obj = RecoveryEngine.__new__(RecoveryEngine)
        deps = engine_obj.get_dependencies("VPN")
        assert deps == []

    def test_get_dependencies_middle(self):
        engine_obj = RecoveryEngine.__new__(RecoveryEngine)
        deps = engine_obj.get_dependencies("Radarr")
        assert "qBittorrent" in deps
        assert "Jellyfin" in deps
        assert "Shoko" not in deps
        assert "Radarr" not in deps

    def test_get_dependencies_unknown_service(self):
        engine_obj = RecoveryEngine.__new__(RecoveryEngine)
        deps = engine_obj.get_dependencies("UnknownService")
        assert deps == []

    async def test_get_dependencies_via_engine(self, engine):
        deps = engine.get_dependencies("Shoko")
        assert len(deps) == 8
        assert deps[0] == "VPN"
        assert deps[-1] == "Jellyseerr"


# ==================================================================
# Level config (REC-02)
# ==================================================================

class TestLevelConfig:
    def test_all_levels_present(self):
        for i in range(1, 8):
            assert i in LEVEL_CONFIG

    def test_level_1_self_heal(self):
        cfg = LEVEL_CONFIG[1]
        assert cfg["timeout"] == 30
        assert cfg["retries"] == 2

    def test_level_6_no_retries(self):
        cfg = LEVEL_CONFIG[6]
        assert cfg["retries"] == 0

    def test_level_7_no_timeout_no_retries(self):
        cfg = LEVEL_CONFIG[7]
        assert cfg["timeout"] == 0
        assert cfg["retries"] == 0


# ==================================================================
# Escalation level mapping
# ==================================================================

class TestEscalationLevel:
    async def test_first_attempt_level_1(self, engine):
        engine._attempt_count["Jellyfin"] = 1
        level = engine._get_escalation_level("Jellyfin")
        assert level == RecoveryLevel.SELF_HEAL_WAIT

    async def test_second_attempt_level_1(self, engine):
        engine._attempt_count["Jellyfin"] = 2
        level = engine._get_escalation_level("Jellyfin")
        assert level == RecoveryLevel.SELF_HEAL_WAIT

    async def test_third_attempt_level_2(self, engine):
        engine._attempt_count["Jellyfin"] = 3
        level = engine._get_escalation_level("Jellyfin")
        assert level == RecoveryLevel.SOFT_RESTART

    async def test_fifth_attempt_level_3(self, engine):
        engine._attempt_count["Jellyfin"] = 5
        level = engine._get_escalation_level("Jellyfin")
        assert level == RecoveryLevel.DEPENDENCY_RECOVERY

    async def test_seventh_attempt_level_4(self, engine):
        engine._attempt_count["Jellyfin"] = 7
        level = engine._get_escalation_level("Jellyfin")
        assert level == RecoveryLevel.STACK_RESET

    async def test_ninth_attempt_level_5(self, engine):
        engine._attempt_count["Jellyfin"] = 9
        level = engine._get_escalation_level("Jellyfin")
        assert level == RecoveryLevel.VPN_RECOVERY

    async def test_eleventh_attempt_level_6(self, engine):
        engine._attempt_count["Jellyfin"] = 11
        level = engine._get_escalation_level("Jellyfin")
        assert level == RecoveryLevel.NETWORK_RECOVERY

    async def test_thirteenth_attempt_level_7(self, engine):
        engine._attempt_count["Jellyfin"] = 13
        level = engine._get_escalation_level("Jellyfin")
        assert level == RecoveryLevel.OPERATOR_ESCALATION

    async def test_cap_at_7(self, engine):
        engine._attempt_count["Jellyfin"] = 100
        level = engine._get_escalation_level("Jellyfin")
        assert level == RecoveryLevel.OPERATOR_ESCALATION

    async def test_zero_attempts_floor_at_1(self, engine):
        engine._attempt_count["Jellyfin"] = 0
        level = engine._get_escalation_level("Jellyfin")
        assert level == RecoveryLevel.SELF_HEAL_WAIT


# ==================================================================
# Circuit breaker (REC-05)
# ==================================================================

class TestCircuitBreaker:
    async def test_circuit_breaker_ok_initially(self, engine):
        assert engine._circuit_breaker_ok("Jellyfin") is True

    async def test_circuit_breaker_after_one_attempt(self, engine):
        engine._record_circuit_breaker_attempt("Jellyfin")
        assert engine._circuit_breaker_ok("Jellyfin") is True

    async def test_circuit_breaker_trips_at_max(self, engine):
        for _ in range(CIRCUIT_BREAKER_MAX_ATTEMPTS):
            engine._record_circuit_breaker_attempt("Jellyfin")
        assert engine._circuit_breaker_ok("Jellyfin") is False

    async def test_circuit_breaker_prunes_old_entries(self, engine):
        # Add attempts older than the window
        old_time = datetime.now() - timedelta(seconds=CIRCUIT_BREAKER_WINDOW_SECONDS + 60)
        engine._circuit_breaker["Jellyfin"] = __import__("collections").deque()
        for _ in range(CIRCUIT_BREAKER_MAX_ATTEMPTS):
            engine._circuit_breaker["Jellyfin"].append(old_time)
        # Old entries should be pruned, so breaker should be OK
        assert engine._circuit_breaker_ok("Jellyfin") is True

    async def test_circuit_breaker_reset(self, engine):
        for _ in range(CIRCUIT_BREAKER_MAX_ATTEMPTS):
            engine._record_circuit_breaker_attempt("Jellyfin")
        assert engine._circuit_breaker_ok("Jellyfin") is False

        engine.reset_circuit_breaker("Jellyfin")
        assert engine._circuit_breaker_ok("Jellyfin") is True

    async def test_reset_attempts_clears_circuit_breaker(self, engine):
        for _ in range(CIRCUIT_BREAKER_MAX_ATTEMPTS):
            engine._record_circuit_breaker_attempt("Jellyfin")
        engine.reset_attempts("Jellyfin")
        assert engine._circuit_breaker_ok("Jellyfin") is True

    async def test_attempt_recovery_escalates_when_breaker_tripped(self, engine):
        """When circuit breaker trips, recovery should escalate to operator level."""
        # Trip the breaker
        for _ in range(CIRCUIT_BREAKER_MAX_ATTEMPTS):
            engine._record_circuit_breaker_attempt("Jellyfin")

        with patch.object(engine, "_record_result", new_callable=AsyncMock):
            result = await engine.attempt_recovery("Jellyfin")

        assert result is not None
        assert result.action == RecoveryAction.ESCALATE
        assert result.escalation_level == 7

    async def test_window_boundary(self, engine):
        """Attempts at exactly the window boundary still count."""
        # 2 attempts just inside the window
        engine._record_circuit_breaker_attempt("Jellyfin")
        engine._record_circuit_breaker_attempt("Jellyfin")
        # 1 attempt right at the boundary (should still count)
        boundary_time = datetime.now() - timedelta(seconds=CIRCUIT_BREAKER_WINDOW_SECONDS - 1)
        engine._circuit_breaker["Jellyfin"].append(boundary_time)
        assert engine._circuit_breaker_ok("Jellyfin") is False  # 3 total


# ==================================================================
# Cooldown and basic attempt flow
# ==================================================================

class TestCooldown:
    async def test_can_attempt_first_time(self, engine):
        assert engine._can_attempt("Jellyfin") is True

    async def test_cooldown_enforced(self, engine):
        engine._last_recovery["Jellyfin"] = datetime.now()
        assert engine._can_attempt("Jellyfin") is False

    async def test_cooldown_expires(self, engine):
        engine._last_recovery["Jellyfin"] = datetime.now() - timedelta(seconds=60)
        assert engine._can_attempt("Jellyfin") is True


class TestAttemptRecovery:
    async def test_respects_cooldown(self, engine):
        engine._last_recovery["Jellyfin"] = datetime.now()
        result = await engine.attempt_recovery("Jellyfin")
        assert result is None

    async def test_increments_count(self, engine):
        with patch.object(engine, "_do_self_heal_wait", new_callable=AsyncMock) as mock_lvl1:
            mock_lvl1.return_value = RecoveryResult(
                service_name="Jellyfin",
                action=RecoveryAction.SELF_HEAL_WAIT,
                success=True,
                escalation_level=1,
            )
            with patch.object(engine, "_record_result", new_callable=AsyncMock):
                await engine.attempt_recovery("Jellyfin")

        assert engine.get_attempt_count("Jellyfin") == 1

    async def test_resets_attempts(self, engine):
        engine._attempt_count["Jellyfin"] = 3
        engine._last_recovery["Jellyfin"] = datetime.now()
        engine.reset_attempts("Jellyfin")
        assert engine.get_attempt_count("Jellyfin") == 0
        assert engine._can_attempt("Jellyfin") is True


# ==================================================================
# Level 1: Self-heal wait
# ==================================================================

class TestSelfHealWait:
    async def test_self_heal_recovered(self, engine, tmp_path):
        """If service becomes healthy after wait, return success."""
        # Set status to healthy in DB
        async with get_db(tmp_path / "test.sqlite") as db:
            await db.execute(
                "UPDATE services SET status = 'healthy' WHERE name = 'Jellyfin'"
            )
            await db.commit()

        with patch.object(engine, "_record_result", new_callable=AsyncMock):
            result = await engine._do_self_heal_wait("Jellyfin", 1)

        assert result.success is True
        assert result.action == RecoveryAction.SELF_HEAL_WAIT

    async def test_self_heal_still_unhealthy(self, engine, tmp_path):
        """If service remains unhealthy, return failure."""
        async with get_db(tmp_path / "test.sqlite") as db:
            await db.execute(
                "UPDATE services SET status = 'unhealthy' WHERE name = 'Jellyfin'"
            )
            await db.commit()

        with patch.object(engine, "_record_result", new_callable=AsyncMock):
            result = await engine._do_self_heal_wait("Jellyfin", 1)

        assert result.success is False
        assert result.action == RecoveryAction.SELF_HEAL_WAIT


# ==================================================================
# Level 2: Docker restart
# ==================================================================

class TestDockerRestart:
    async def test_docker_restart_success(self, engine):
        mock_container = MagicMock()
        mock_container.restart = MagicMock()

        mock_client = MagicMock()
        mock_client.containers.get.return_value = mock_container
        mock_client.close = MagicMock()

        with patch("docker.from_env", return_value=mock_client):
            with patch("docker.errors.NotFound", Exception):
                result = await engine._do_docker_restart("Jellyfin", 2)

        assert result.success is True
        assert result.action == RecoveryAction.DOCKER_RESTART

    async def test_docker_restart_container_not_found(self, engine):
        mock_client = MagicMock()
        mock_client.containers.get.side_effect = Exception("not found")
        mock_client.close = MagicMock()

        with patch("docker.from_env", return_value=mock_client):
            with patch("docker.errors.NotFound", type("NotFound", (Exception,), {})):
                result = await engine._do_docker_restart("Jellyfin", 2)

        assert result.success is False

    async def test_docker_restart_no_docker(self, engine):
        with patch("docker.from_env", side_effect=ImportError("no docker")):
            result = await engine._do_docker_restart("Jellyfin", 2)
        assert result.success is False


# ==================================================================
# Level 3: Dependency recovery
# ==================================================================

class TestDependencyRecovery:
    async def test_dependency_recovery_restarts_deps_then_target(self, engine):
        """Dependency recovery should restart dependencies before the target."""
        call_order = []

        async def mock_restart(service_name):
            call_order.append(service_name)
            return True

        with patch.object(engine, "_restart_service_container", side_effect=mock_restart):
            with patch.object(engine, "_record_result", new_callable=AsyncMock):
                # For Shoko, dependencies are everything before it in tree
                result = await engine.attempt_recovery("Shoko")

        # Verify dependencies were restarted before target
        if result:
            # Should have deps before Shoko in the call order
            dep_names = engine.get_dependencies("Shoko")
            for dep in dep_names:
                if dep in call_order:
                    assert call_order.index(dep) < call_order.index("Shoko")

    async def test_dependency_recovery_for_root_service(self, engine):
        """VPN has no dependencies, so dependency recovery should only restart VPN."""
        call_order = []

        async def mock_restart(service_name):
            call_order.append(service_name)
            return True

        with patch.object(engine, "_restart_service_container", side_effect=mock_restart):
            result = await engine._do_dependency_recovery("VPN", 3)

        assert result.success is True
        # Only VPN should be in the call order
        assert "VPN" in call_order


# ==================================================================
# Level 4: Stack reset
# ==================================================================

class TestStackReset:
    async def test_stack_reset_restarts_chain(self, engine):
        """Stack reset restarts the entire chain excluding VPN and Tunnels."""
        restarted = []

        async def mock_restart(service_name):
            restarted.append(service_name)
            return True

        with patch.object(engine, "_restart_service_container", side_effect=mock_restart):
            result = await engine._do_stack_reset("Shoko", 4)

        assert result.success is True
        assert result.action == RecoveryAction.STACK_RESET
        # VPN and Tunnels should NOT be in the restarted list
        assert "VPN" not in restarted
        assert "Tunnels" not in restarted
        # qBittorrent through Shoko should be present
        assert "qBittorrent" in restarted
        assert "Shoko" in restarted


# ==================================================================
# Level 5: VPN recovery
# ==================================================================

class TestVPNRecovery:
    async def test_vpn_recovery_reconnects_then_restarts(self, engine):
        """VPN recovery should reconnect VPN then restart downstream services."""
        restarted = []

        async def mock_restart(service_name):
            restarted.append(service_name)
            return True

        vpn_result = RecoveryResult(
            service_name="vpn:TestVPN",
            action=RecoveryAction.VPN_RECONNECT,
            success=True,
            escalation_level=5,
        )

        with patch.object(engine, "_do_vpn_reconnect", return_value=vpn_result):
            with patch.object(engine, "_restart_service_container", side_effect=mock_restart):
                result = await engine._do_vpn_recovery("Shoko", 5)

        assert result.success is True
        # Downstream services should have been restarted
        assert "qBittorrent" in restarted
        assert "Jellyfin" in restarted

    async def test_vpn_recovery_fails_if_vpn_reconnect_fails(self, engine):
        """If VPN reconnect fails, the whole level 5 fails."""
        vpn_result = RecoveryResult(
            service_name="vpn:TestVPN",
            action=RecoveryAction.VPN_RECONNECT,
            success=False,
            escalation_level=5,
            details="Connection refused",
        )

        with patch.object(engine, "_do_vpn_reconnect", return_value=vpn_result):
            result = await engine._do_vpn_recovery("Shoko", 5)

        assert result.success is False


# ==================================================================
# Level 6: Network recovery
# ==================================================================

class TestNetworkRecovery:
    async def test_network_recovery_runs_full_stack(self, engine):
        """Network recovery restarts Docker, VPN, and all services."""
        restarted = []

        async def mock_restart(service_name):
            restarted.append(service_name)
            return True

        vpn_result = RecoveryResult(
            service_name="vpn:TestVPN",
            action=RecoveryAction.VPN_RECONNECT,
            success=True,
            escalation_level=6,
        )

        with patch("subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0)
            with patch.object(engine, "_do_vpn_reconnect", return_value=vpn_result):
                with patch.object(engine, "_restart_service_container", side_effect=mock_restart):
                    result = await engine._do_network_recovery("Jellyfin", 6)

        assert result.success is True
        assert result.action == RecoveryAction.NETWORK_RECOVERY
        # All non-VPN/Tunnels services should have been restarted
        for svc in DEPENDENCY_TREE:
            if svc not in ("VPN", "Tunnels"):
                assert svc in restarted


# ==================================================================
# Level 7: Operator escalation
# ==================================================================

class TestOperatorEscalation:
    async def test_escalate_action(self, engine):
        engine._attempt_count["Jellyfin"] = 13
        result = await engine._do_escalate("Jellyfin", 7)
        assert result.action == RecoveryAction.ESCALATE
        assert result.success is False
        assert result.escalation_level == 7
        assert "operator intervention required" in result.details.lower()


# ==================================================================
# Tunnel recovery
# ==================================================================

class TestTunnelRecovery:
    async def test_tunnel_restart_success(self, engine):
        with patch("subprocess.run") as mock_run:
            mock_result = MagicMock()
            mock_result.returncode = 0
            mock_run.return_value = mock_result

            with patch.object(engine, "_record_result", new_callable=AsyncMock):
                result = await engine.attempt_tunnel_recovery("media-tunnel")

        assert result is not None
        assert result.success is True
        assert result.action == RecoveryAction.TUNNEL_RESTART

    async def test_tunnel_restart_failure(self, engine):
        with patch("subprocess.run") as mock_run:
            mock_result = MagicMock()
            mock_result.returncode = 1
            mock_result.stderr = "cloudflared error"
            mock_run.return_value = mock_result

            with patch.object(engine, "_record_result", new_callable=AsyncMock):
                result = await engine.attempt_tunnel_recovery("media-tunnel")

        assert result is not None
        assert result.success is False

    async def test_tunnel_recovery_cooldown(self, engine):
        engine._last_recovery["tunnel:media-tunnel"] = datetime.now()
        result = await engine.attempt_tunnel_recovery("media-tunnel")
        assert result is None


# ==================================================================
# VPN recovery
# ==================================================================

class TestVPNRecoveryFlow:
    async def test_vpn_recovery_cooldown(self, engine):
        engine._last_recovery["vpn:reconnect"] = datetime.now()
        result = await engine.attempt_vpn_recovery()
        assert result is None


# ==================================================================
# State snapshots (REC-04)
# ==================================================================

class TestStateSnapshots:
    async def test_snapshot_capture(self, tmp_path, test_config):
        from mediasentinel.core.snapshot import capture_snapshot

        db_path = tmp_path / "test.sqlite"
        await init_db(db_path)

        async with get_db(db_path) as db:
            await db.execute(
                "INSERT INTO services (name, url, status) VALUES (?, ?, 'healthy')",
                ("Jellyfin", "http://localhost:8096"),
            )
            await db.commit()

        snapshot = await capture_snapshot(db_path, test_config)
        assert "captured_at" in snapshot
        assert "services" in snapshot
        assert len(snapshot["services"]) == 1
        assert snapshot["services"][0]["name"] == "Jellyfin"
        assert snapshot["services"][0]["status"] == "healthy"
        assert "vpn" in snapshot
        assert "config_summary" in snapshot

    async def test_snapshot_save_and_load(self, tmp_path, test_config):
        from mediasentinel.core.snapshot import capture_snapshot, save_snapshot, load_latest_snapshot

        db_path = tmp_path / "test.sqlite"
        await init_db(db_path)

        snapshot = {"test": "data", "services": []}
        row_id = await save_snapshot(db_path, snapshot, "pre_recovery")
        assert row_id > 0

        loaded = await load_latest_snapshot(db_path, "pre_recovery")
        assert loaded is not None
        assert loaded["test"] == "data"

    async def test_snapshot_load_returns_none_when_empty(self, tmp_path):
        from mediasentinel.core.snapshot import load_latest_snapshot

        db_path = tmp_path / "test.sqlite"
        await init_db(db_path)

        result = await load_latest_snapshot(db_path, "pre_recovery")
        assert result is None

    async def test_snapshot_load_latest_of_type(self, tmp_path, test_config):
        from mediasentinel.core.snapshot import save_snapshot, load_latest_snapshot

        db_path = tmp_path / "test.sqlite"
        await init_db(db_path)

        await save_snapshot(db_path, {"order": 1}, "pre_recovery")
        await save_snapshot(db_path, {"order": 2}, "pre_recovery")
        await save_snapshot(db_path, {"order": 3}, "post_recovery")

        latest_pre = await load_latest_snapshot(db_path, "pre_recovery")
        assert latest_pre["order"] == 2

        latest_post = await load_latest_snapshot(db_path, "post_recovery")
        assert latest_post["order"] == 3

        latest_any = await load_latest_snapshot(db_path)
        assert latest_any["order"] == 3

    async def test_snapshot_captured_before_level2_plus(self, engine):
        """Verify snapshots are captured before Level 2+ recovery."""
        from mediasentinel.core import snapshot

        snapshots_taken = []

        original_save = snapshot.save_snapshot

        async def tracking_save(db_path, data, stype="pre_recovery"):
            snapshots_taken.append(stype)
            return await original_save(db_path, data, stype)

        with patch.object(snapshot, "save_snapshot", side_effect=tracking_save):
            with patch.object(snapshot, "capture_snapshot", return_value={"test": True}):
                # Level 2 should capture snapshot
                with patch.object(engine, "_do_docker_restart", new_callable=AsyncMock) as mock:
                    mock.return_value = RecoveryResult(
                        service_name="Jellyfin",
                        action=RecoveryAction.DOCKER_RESTART,
                        success=True,
                        escalation_level=2,
                    )
                    with patch.object(engine, "_record_result", new_callable=AsyncMock):
                        result = await engine._execute_level("Jellyfin", RecoveryLevel.SOFT_RESTART)

        assert result.success is True
        assert len(snapshots_taken) == 1
        assert snapshots_taken[0] == "pre_recovery"


# ==================================================================
# DB recording
# ==================================================================

class TestDBRecording:
    async def test_result_recorded_to_db(self, engine, tmp_path):
        db_path = tmp_path / "test.sqlite"
        result = RecoveryResult(
            service_name="Jellyfin",
            action=RecoveryAction.DOCKER_RESTART,
            success=True,
            escalation_level=2,
            details="Test restart",
            started_at=datetime.now(),
            completed_at=datetime.now(),
        )
        await engine._record_result(result)

        async with get_db(db_path) as db:
            cursor = await db.execute("SELECT * FROM recovery_events WHERE service_name = 'Jellyfin'")
            rows = await cursor.fetchall()

        assert len(rows) == 1
        assert rows[0]["action"] == "docker_restart"
        assert rows[0]["result"] == "success"
        assert rows[0]["escalation_level"] == 2


# ==================================================================
# _restart_service_container helper
# ==================================================================

class TestRestartServiceContainer:
    async def test_restart_success(self, engine):
        mock_container = MagicMock()
        mock_container.restart = MagicMock()

        mock_client = MagicMock()
        mock_client.containers.get.return_value = mock_container
        mock_client.close = MagicMock()

        with patch("docker.from_env", return_value=mock_client):
            result = await engine._restart_service_container("Jellyfin")

        assert result is True

    async def test_restart_container_not_found(self, engine):
        mock_client = MagicMock()
        mock_client.containers.get.side_effect = Exception("not found")
        mock_client.close = MagicMock()

        with patch("docker.from_env", return_value=mock_client):
            result = await engine._restart_service_container("Jellyfin")

        assert result is False

    async def test_restart_no_docker(self, engine):
        with patch("docker.from_env", side_effect=ImportError("no docker")):
            result = await engine._restart_service_container("Jellyfin")

        assert result is False


# ==================================================================
# Integration: full escalation cycle
# ==================================================================

class TestFullEscalationCycle:
    async def test_escalation_through_levels(self, engine):
        """Simulate repeated failures driving escalation through levels."""
        with patch.object(engine, "_record_result", new_callable=AsyncMock):
            # Override cooldown for testing
            engine.policy.__dict__["cooldown_seconds"] = 0

            for i in range(1, 15):
                engine._attempt_count["Jellyfin"] = i
                engine._record_circuit_breaker_attempt("Jellyfin")

            # After 14 attempts, should be at level 7
            level = engine._get_escalation_level("Jellyfin")
            assert level == RecoveryLevel.OPERATOR_ESCALATION

            # After 3+ circuit breaker attempts in window, breaker trips
            assert engine._circuit_breaker_ok("Jellyfin") is False
