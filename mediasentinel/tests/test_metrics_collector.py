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
        ],
        vpn={"adapter_description": "TestVPN"},
        logging={"log_dir": "/tmp/test-ms-logs"},
        database={"db_path": "/tmp/test-metrics.sqlite"},
    )


@pytest.fixture
async def test_db(tmp_path):
    db_path = tmp_path / "metrics_test.sqlite"
    await init_db(db_path)
    return db_path


@pytest.fixture
async def collector(test_config, test_db):
    from mediasentinel.agents.metrics_collector import MetricsCollector

    mc = MetricsCollector(test_config, test_db)
    yield mc


async def test_record_metric(collector, test_db):
    await collector.record("test_type", "test_name", 42.5, "ms")

    async with get_db(test_db) as db:
        cursor = await db.execute(
            "SELECT * FROM metrics WHERE metric_type = 'test_type' AND metric_name = 'test_name'"
        )
        rows = await cursor.fetchall()
    assert len(rows) == 1
    assert rows[0]["value"] == 42.5
    assert rows[0]["unit"] == "ms"


async def test_record_service_response(collector, test_db):
    await collector.record_service_response("Radarr", 123.4)

    async with get_db(test_db) as db:
        cursor = await db.execute(
            "SELECT value, unit FROM metrics WHERE metric_type = 'response_time' AND metric_name = 'Radarr'"
        )
        rows = await cursor.fetchall()
    assert len(rows) == 1
    assert rows[0]["value"] == 123.4
    assert rows[0]["unit"] == "ms"


async def test_record_service_status_healthy(collector, test_db):
    await collector.record_service_status("Radarr", "healthy")

    async with get_db(test_db) as db:
        cursor = await db.execute(
            "SELECT value FROM metrics WHERE metric_type = 'service_status' AND metric_name = 'Radarr'"
        )
        rows = await cursor.fetchall()
    assert rows[0]["value"] == 1.0


async def test_record_service_status_unhealthy(collector, test_db):
    await collector.record_service_status("Radarr", "unhealthy")

    async with get_db(test_db) as db:
        cursor = await db.execute(
            "SELECT value FROM metrics WHERE metric_type = 'service_status' AND metric_name = 'Radarr'"
        )
        rows = await cursor.fetchall()
    assert rows[0]["value"] == 0.0


async def test_record_vpn_state(collector, test_db):
    await collector.record_vpn_state("connected")

    async with get_db(test_db) as db:
        cursor = await db.execute(
            "SELECT value FROM metrics WHERE metric_type = 'vpn_state'"
        )
        rows = await cursor.fetchall()
    assert len(rows) == 1
    assert rows[0]["value"] == 1.0


async def test_record_vpn_state_dedup(collector, test_db):
    await collector.record_vpn_state("connected")
    await collector.record_vpn_state("connected")

    async with get_db(test_db) as db:
        cursor = await db.execute(
            "SELECT value FROM metrics WHERE metric_type = 'vpn_state'"
        )
        rows = await cursor.fetchall()
    # Only 1 entry because state didn't change
    assert len(rows) == 1


async def test_record_vpn_state_change(collector, test_db):
    await collector.record_vpn_state("connected")
    await collector.record_vpn_state("disconnected")

    async with get_db(test_db) as db:
        cursor = await db.execute(
            "SELECT value FROM metrics WHERE metric_type = 'vpn_state' ORDER BY recorded_at"
        )
        rows = await cursor.fetchall()
    assert len(rows) == 2
    assert rows[0]["value"] == 1.0
    assert rows[1]["value"] == 0.0


async def test_record_recovery(collector, test_db):
    await collector.record_recovery("Radarr", True)
    await collector.record_recovery("Sonarr", False)

    async with get_db(test_db) as db:
        cursor = await db.execute(
            "SELECT metric_name, value FROM metrics WHERE metric_type = 'recovery' ORDER BY metric_name"
        )
        rows = await cursor.fetchall()
    assert len(rows) == 2
    assert rows[0]["value"] == 1.0  # Radarr success
    assert rows[1]["value"] == 0.0  # Sonarr failure


async def test_get_latest(collector, test_db):
    await collector.record("test", "foo", 1.0)
    await collector.record("test", "foo", 2.0)
    await collector.record("test", "foo", 3.0)

    results = await collector.get_latest("test", "foo", limit=2)
    assert len(results) == 2
    assert results[0]["value"] == 3.0
    assert results[1]["value"] == 2.0


async def test_get_latest_empty(collector, test_db):
    results = await collector.get_latest("nonexistent", "metric")
    assert results == []


async def test_collect_system_metrics(collector, test_db):
    mock_cpu = MagicMock(return_value=45.0)
    mock_mem = MagicMock()
    mock_mem.percent = 60.0
    mock_mem.available = 8 * 1024**3
    mock_disk = MagicMock()
    mock_disk.percent = 70.0
    mock_disk.free = 100 * 1024**3

    with patch("psutil.cpu_percent", mock_cpu), \
         patch("psutil.virtual_memory", return_value=mock_mem), \
         patch("psutil.disk_usage", return_value=mock_disk):
        metrics = await collector.collect_system_metrics()

    assert metrics["cpu_percent"] == 45.0
    assert metrics["memory_percent"] == 60.0
    assert metrics["disk_percent"] == 70.0

    async with get_db(test_db) as db:
        cursor = await db.execute(
            "SELECT COUNT(*) as cnt FROM metrics WHERE metric_type = 'system'"
        )
        row = await cursor.fetchone()
    assert row["cnt"] == 5


async def test_get_service_uptime_no_data(collector, test_db):
    uptime = await collector.get_service_uptime("NonExistent", hours=24)
    assert uptime == 0.0


async def test_get_service_uptime_all_healthy(collector, test_db):
    for _ in range(5):
        await collector.record_service_status("Radarr", "healthy")

    uptime = await collector.get_service_uptime("Radarr", hours=24)
    assert uptime == 100.0


async def test_get_service_uptime_mixed(collector, test_db):
    for _ in range(3):
        await collector.record_service_status("Radarr", "healthy")
    for _ in range(2):
        await collector.record_service_status("Radarr", "unhealthy")

    uptime = await collector.get_service_uptime("Radarr", hours=24)
    assert uptime == 60.0


# --- New tests for download throughput tracking (MET-03) ---

async def test_record_download_throughput(collector, test_db):
    """record_download_throughput should store three metrics."""
    await collector.record_download_throughput(
        download_bytes_per_sec=5_000_000.0,
        upload_bytes_per_sec=500_000.0,
        active_torrents=7,
    )

    async with get_db(test_db) as db:
        # Check download speed
        cursor = await db.execute(
            "SELECT value, unit FROM metrics WHERE metric_type = 'download_throughput' AND metric_name = 'download_speed'"
        )
        dl = await cursor.fetchone()
        assert dl["value"] == 5_000_000.0
        assert dl["unit"] == "bytes/s"

        # Check upload speed
        cursor = await db.execute(
            "SELECT value, unit FROM metrics WHERE metric_type = 'download_throughput' AND metric_name = 'upload_speed'"
        )
        ul = await cursor.fetchone()
        assert ul["value"] == 500_000.0

        # Check active torrents
        cursor = await db.execute(
            "SELECT value FROM metrics WHERE metric_type = 'download_throughput' AND metric_name = 'active_torrents'"
        )
        at = await cursor.fetchone()
        assert at["value"] == 7.0


async def test_record_download_throughput_multiple(collector, test_db):
    """Multiple throughput recordings should all be stored."""
    for i in range(5):
        await collector.record_download_throughput(
            download_bytes_per_sec=float(i * 1_000_000),
            upload_bytes_per_sec=float(i * 100_000),
            active_torrents=i,
        )

    async with get_db(test_db) as db:
        cursor = await db.execute(
            "SELECT COUNT(*) as cnt FROM metrics WHERE metric_type = 'download_throughput' AND metric_name = 'download_speed'"
        )
        row = await cursor.fetchone()
    assert row["cnt"] == 5


async def test_get_throughput_history(collector, test_db):
    """get_throughput_history should return historical download speeds."""
    for i in range(3):
        await collector.record_download_throughput(
            download_bytes_per_sec=float(i * 1_000_000),
            upload_bytes_per_sec=float(i * 100_000),
            active_torrents=i,
        )

    history = await collector.get_throughput_history(hours=1)
    assert len(history) == 3
    # Most recent first
    assert history[0]["download_speed"] == 2_000_000.0
    assert history[0]["upload_speed"] == 200_000.0
    assert history[0]["active_torrents"] == 2


async def test_get_throughput_history_empty(collector, test_db):
    """get_throughput_history with no data should return empty list."""
    history = await collector.get_throughput_history(hours=24)
    assert history == []


# --- New tests for bandwidth throttling detection (MET-05) ---

async def test_detect_throttling_insufficient_data(collector, test_db):
    """With fewer than window readings, throttling should not be detected."""
    # Default window is 10, only insert 5
    for i in range(5):
        await collector.record_download_throughput(
            download_bytes_per_sec=100.0,
            upload_bytes_per_sec=10.0,
            active_torrents=1,
        )

    result = await collector.detect_throttling(speed_profile_bytes=1_000_000)
    assert result is None


async def test_detect_throttling_not_throttled(collector, test_db):
    """When throughput is above 50% of profile, should return None."""
    # Record 10 readings at 60% of profile
    profile_speed = 1_000_000
    for _ in range(10):
        await collector.record_download_throughput(
            download_bytes_per_sec=profile_speed * 0.6,
            upload_bytes_per_sec=100_000.0,
            active_torrents=5,
        )

    result = await collector.detect_throttling(profile_speed)
    assert result is None


async def test_detect_throttling_detected(collector, test_db):
    """When throughput is below 50% of profile, should return throttle percentage."""
    # Record 10 readings at 30% of profile (well below 50% threshold)
    profile_speed = 1_000_000
    for _ in range(10):
        await collector.record_download_throughput(
            download_bytes_per_sec=profile_speed * 0.3,
            upload_bytes_per_sec=100_000.0,
            active_torrents=5,
        )

    result = await collector.detect_throttling(profile_speed)
    assert result is not None
    assert result < 50.0  # Should be around 30.0
    assert result == 30.0


async def test_detect_throttling_zero_profile(collector, test_db):
    """Zero speed profile should return None (no throttling check)."""
    for _ in range(10):
        await collector.record_download_throughput(
            download_bytes_per_sec=500_000.0,
            upload_bytes_per_sec=50_000.0,
            active_torrents=1,
        )

    result = await collector.detect_throttling(speed_profile_bytes=0)
    assert result is None


async def test_detect_throttling_exactly_at_threshold(collector, test_db):
    """Throughput exactly at 50% threshold should NOT trigger (must be below)."""
    profile_speed = 1_000_000
    for _ in range(10):
        await collector.record_download_throughput(
            download_bytes_per_sec=profile_speed * 0.50,
            upload_bytes_per_sec=50_000.0,
            active_torrents=3,
        )

    result = await collector.detect_throttling(profile_speed)
    # 50% is not below 50%, so should be None
    assert result is None


async def test_detect_throttling_custom_window(test_config, test_db):
    """Throttling detection should respect the configured window size."""
    from mediasentinel.agents.metrics_collector import MetricsCollector

    # Override the window to 3 for this test
    test_config.alerts.throttle_detection_window = 3
    mc = MetricsCollector(test_config, test_db)

    # Only 3 readings at 20% of profile (below 50%)
    profile_speed = 1_000_000
    for _ in range(3):
        await mc.record_download_throughput(
            download_bytes_per_sec=profile_speed * 0.2,
            upload_bytes_per_sec=50_000.0,
            active_torrents=1,
        )

    result = await mc.detect_throttling(profile_speed)
    assert result is not None
    assert result == 20.0
