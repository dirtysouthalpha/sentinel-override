import pytest
from unittest.mock import MagicMock, patch, PropertyMock

from mediasentinel.agents.models import VPNState
from mediasentinel.agents.qbt_controller import (
    QBittorrentController,
    SpeedProfile,
    SPEED_PROFILES,
    TorrentAction,
)
from mediasentinel.config.models import QBittorrentConfig


@pytest.fixture
def qbt_config():
    return QBittorrentConfig(
        host="http://localhost:8080",
        username="admin",
        password_env="QBIT_TEST_PASSWORD",
    )


@pytest.fixture
def controller(qbt_config):
    return QBittorrentController(qbt_config)


def _make_mock_client():
    """Create a mock qbittorrent-api client with all needed methods."""
    client = MagicMock()
    client.auth_log_in.return_value = None
    client.auth_log_out.return_value = None
    client.app_version.return_value = "v4.6.3"
    client.transfer_set_download_limit.return_value = None
    client.transfer_set_upload_limit.return_value = None
    client.app_set_preferences.return_value = None
    client.torrents_pause = MagicMock()
    client.torrents_resume = MagicMock()
    client.torrents_stop = MagicMock()
    client.torrents_start = MagicMock()
    return client


# --- Existing VPN gate tests (preserved) ---


def test_enforce_vpn_gate_connected_resumes(controller):
    controller._last_action = TorrentAction.PAUSED
    controller._is_v5 = False

    with patch.object(controller, "_resume_all", return_value=True):
        action = controller.enforce_vpn_gate(VPNState.CONNECTED)

    assert action == TorrentAction.RESUMED
    assert controller.last_action == TorrentAction.RESUMED


def test_enforce_vpn_gate_disconnected_pauses(controller):
    controller._last_action = TorrentAction.NONE
    controller._is_v5 = False

    with patch.object(controller, "_pause_all", return_value=True):
        action = controller.enforce_vpn_gate(VPNState.DISCONNECTED)

    assert action == TorrentAction.PAUSED
    assert controller.last_action == TorrentAction.PAUSED


def test_enforce_vpn_gate_degraded_pauses(controller):
    controller._last_action = TorrentAction.NONE
    controller._is_v5 = False

    with patch.object(controller, "_pause_all", return_value=True):
        action = controller.enforce_vpn_gate(VPNState.DEGRADED)

    assert action == TorrentAction.PAUSED


def test_enforce_vpn_gate_already_paused_no_action(controller):
    controller._last_action = TorrentAction.PAUSED
    controller._is_v5 = False

    action = controller.enforce_vpn_gate(VPNState.DISCONNECTED)
    assert action == TorrentAction.NONE


def test_enforce_vpn_gate_already_resumed_no_action(controller):
    controller._last_action = TorrentAction.RESUMED
    controller._is_v5 = False

    action = controller.enforce_vpn_gate(VPNState.CONNECTED)
    assert action == TorrentAction.NONE


def test_enforce_vpn_gate_connecting_pauses(controller):
    """Fail-closed: CONNECTING is not CONNECTED, so pause."""
    controller._last_action = TorrentAction.NONE
    controller._is_v5 = False

    with patch.object(controller, "_pause_all", return_value=True):
        action = controller.enforce_vpn_gate(VPNState.CONNECTING)

    assert action == TorrentAction.PAUSED


# --- Version-aware API call tests ---


def test_pause_v4_uses_pause(controller):
    mock_client = MagicMock()
    controller._client = mock_client
    controller._is_v5 = False

    result = controller._pause_all()
    mock_client.torrents_pause.assert_called_once_with(torrent_hashes="")
    assert result is True


def test_pause_v5_uses_stop(controller):
    mock_client = MagicMock()
    controller._client = mock_client
    controller._is_v5 = True

    result = controller._pause_all()
    mock_client.torrents_stop.assert_called_once_with(torrent_hashes="")
    assert result is True


def test_resume_v4_uses_resume(controller):
    mock_client = MagicMock()
    controller._client = mock_client
    controller._is_v5 = False

    result = controller._resume_all()
    mock_client.torrents_resume.assert_called_once_with(torrent_hashes="")
    assert result is True


def test_resume_v5_uses_start(controller):
    mock_client = MagicMock()
    controller._client = mock_client
    controller._is_v5 = True

    result = controller._resume_all()
    mock_client.torrents_start.assert_called_once_with(torrent_hashes="")
    assert result is True


def test_pause_failure_returns_false(controller):
    mock_client = MagicMock()
    mock_client.auth_log_in.side_effect = Exception("connection refused")
    controller._client = mock_client
    controller._is_v5 = False

    result = controller._pause_all()
    assert result is False


def test_resume_failure_returns_false(controller):
    mock_client = MagicMock()
    mock_client.auth_log_in.side_effect = Exception("connection refused")
    controller._client = mock_client
    controller._is_v5 = False

    result = controller._resume_all()
    assert result is False


def test_version_detection_v4(controller):
    mock_client = MagicMock()
    mock_client.app_version.return_value = "v4.6.3"
    controller._client = mock_client

    controller._detect_version()
    assert controller._is_v5 is False


def test_version_detection_v5(controller):
    mock_client = MagicMock()
    mock_client.app_version.return_value = "v5.0.0"
    controller._client = mock_client

    controller._detect_version()
    assert controller._is_v5 is True


def test_version_detection_cached(controller):
    controller._is_v5 = True
    controller._detect_version()
    assert controller._is_v5 is True


def test_close(controller):
    mock_client = MagicMock()
    controller._client = mock_client
    controller.close()
    mock_client.auth_log_out.assert_called_once()


def test_close_no_client(controller):
    controller._client = None
    controller.close()  # Should not raise


# --- Speed profile tests ---


def test_speed_profiles_exist():
    """All four profiles must be defined."""
    assert "10mbps" in SPEED_PROFILES
    assert "50mbps" in SPEED_PROFILES
    assert "100mbps" in SPEED_PROFILES
    assert "100+mbps" in SPEED_PROFILES


def test_speed_profile_values():
    """Verify exact byte values for 85% bandwidth utilization."""
    p = SPEED_PROFILES["10mbps"]
    assert p.max_download_bytes == 1075200
    assert p.max_upload_bytes == 256000
    assert p.max_connections == 50

    p = SPEED_PROFILES["50mbps"]
    assert p.max_download_bytes == 5376000
    assert p.max_upload_bytes == 512000
    assert p.max_connections == 100

    p = SPEED_PROFILES["100mbps"]
    assert p.max_download_bytes == 10752000
    assert p.max_upload_bytes == 1024000
    assert p.max_connections == 200

    p = SPEED_PROFILES["100+mbps"]
    assert p.max_download_bytes == 21401600
    assert p.max_upload_bytes == 2048000
    assert p.max_connections == 300


def test_apply_speed_profile_success(controller):
    mock_client = _make_mock_client()
    controller._client = mock_client
    controller._is_v5 = False

    result = controller.apply_speed_profile("100mbps")
    assert result is True

    mock_client.transfer_set_download_limit.assert_called_once_with(10752000)
    mock_client.transfer_set_upload_limit.assert_called_once_with(1024000)
    mock_client.app_set_preferences.assert_called_once_with({
        "max_connec": 200,
        "max_connec_per_torrent": 100,
    })


def test_apply_speed_profile_unknown(controller):
    result = controller.apply_speed_profile("nonexistent")
    assert result is False


def test_apply_speed_profile_api_failure(controller):
    mock_client = _make_mock_client()
    mock_client.auth_log_in.side_effect = Exception("connection refused")
    controller._client = mock_client

    result = controller.apply_speed_profile("100mbps")
    assert result is False


def test_get_current_speed_profile_matched(controller):
    mock_client = _make_mock_client()
    mock_client.transfer_info.return_value = {
        "dl_limit": 10752000,
        "up_limit": 1024000,
    }
    mock_client.app_preferences.return_value = {"max_connec": 200}
    controller._client = mock_client

    result = controller.get_current_speed_profile()
    assert result == "100mbps"


def test_get_current_speed_profile_no_match(controller):
    mock_client = _make_mock_client()
    mock_client.transfer_info.return_value = {
        "dl_limit": 9999999,
        "up_limit": 9999999,
    }
    mock_client.app_preferences.return_value = {"max_connec": 999}
    controller._client = mock_client

    result = controller.get_current_speed_profile()
    assert result is None


def test_get_current_speed_profile_error(controller):
    mock_client = _make_mock_client()
    mock_client.auth_log_in.side_effect = Exception("fail")
    controller._client = mock_client

    result = controller.get_current_speed_profile()
    assert result is None


# --- Download stats tests ---


def test_get_download_stats(controller):
    mock_client = _make_mock_client()
    mock_client.transfer_info.return_value = {
        "dl_info_speed": 1024000,
        "up_info_speed": 512000,
        "dl_info_data": 10_000_000_000,
        "up_info_data": 5_000_000_000,
    }
    mock_client.torrents_info.return_value = [
        {"state": "downloading"},
        {"state": "stalledDL"},
        {"state": "uploading"},
        {"state": "pausedUP"},
        {"state": "queuedDL"},
    ]
    controller._client = mock_client

    stats = controller.get_download_stats()
    assert stats["download_speed"] == 1024000
    assert stats["upload_speed"] == 512000
    assert stats["active_torrents"] == 3  # downloading, stalledDL, uploading
    assert stats["total_torrents"] == 5
    assert stats["total_downloaded_bytes"] == 10_000_000_000
    assert stats["total_uploaded_bytes"] == 5_000_000_000


def test_get_download_stats_empty(controller):
    mock_client = _make_mock_client()
    mock_client.transfer_info.return_value = {
        "dl_info_speed": 0,
        "up_info_speed": 0,
        "dl_info_data": 0,
        "up_info_data": 0,
    }
    mock_client.torrents_info.return_value = []
    controller._client = mock_client

    stats = controller.get_download_stats()
    assert stats["download_speed"] == 0
    assert stats["active_torrents"] == 0
    assert stats["total_torrents"] == 0


def test_get_download_stats_error(controller):
    mock_client = _make_mock_client()
    mock_client.auth_log_in.side_effect = Exception("fail")
    controller._client = mock_client

    stats = controller.get_download_stats()
    assert stats == {}


# --- Interface binding tests ---


def test_verify_interface_binding_bound_to_vpn(controller):
    mock_client = _make_mock_client()
    mock_client.app_preferences.return_value = {"connection_interface": "Tailscale"}
    controller._client = mock_client
    controller._is_v5 = False

    result = controller.verify_interface_binding("Tailscale")
    assert result is True


def test_verify_interface_binding_empty_auto_detect(controller):
    mock_client = _make_mock_client()
    mock_client.app_preferences.return_value = {"connection_interface": ""}
    controller._client = mock_client
    controller._is_v5 = False

    result = controller.verify_interface_binding("Tailscale")
    assert result is True


def test_verify_interface_binding_none_auto_detect(controller):
    mock_client = _make_mock_client()
    mock_client.app_preferences.return_value = {"connection_interface": None}
    controller._client = mock_client
    controller._is_v5 = False

    result = controller.verify_interface_binding("Tailscale")
    assert result is True


def test_verify_interface_binding_wrong_adapter_pauses(controller):
    mock_client = _make_mock_client()
    mock_client.app_preferences.return_value = {"connection_interface": "Ethernet"}
    controller._client = mock_client
    controller._is_v5 = False

    result = controller.verify_interface_binding("Tailscale")
    assert result is False
    # Should have paused torrents because bound to wrong interface
    mock_client.torrents_pause.assert_called_once_with(torrent_hashes="")


def test_verify_interface_binding_error_fail_closed(controller):
    mock_client = _make_mock_client()
    mock_client.auth_log_in.side_effect = Exception("fail")
    controller._client = mock_client

    result = controller.verify_interface_binding("Tailscale")
    assert result is False


def test_set_interface_binding_success(controller):
    mock_client = _make_mock_client()
    controller._client = mock_client

    result = controller.set_interface_binding("Tailscale")
    assert result is True
    mock_client.app_set_preferences.assert_called_once_with({"connection_interface": "Tailscale"})


def test_set_interface_binding_error(controller):
    mock_client = _make_mock_client()
    mock_client.auth_log_in.side_effect = Exception("fail")
    controller._client = mock_client

    result = controller.set_interface_binding("Tailscale")
    assert result is False


# --- Config model tests ---


def test_qbt_config_defaults():
    config = QBittorrentConfig()
    assert config.speed_profile == "100+mbps"
    assert config.verify_binding_interval == 300


def test_qbt_config_custom():
    config = QBittorrentConfig(
        host="http://192.168.1.100:8080",
        username="testuser",
        password_env="TEST_PASS",
        speed_profile="50mbps",
        verify_binding_interval=60,
    )
    assert config.speed_profile == "50mbps"
    assert config.verify_binding_interval == 60


def test_qbt_config_binding_interval_validation():
    """verify_binding_interval must be between 30 and 3600."""
    with pytest.raises(Exception):
        QBittorrentConfig(verify_binding_interval=10)
    with pytest.raises(Exception):
        QBittorrentConfig(verify_binding_interval=5000)


# --- Speed profile dataclass tests ---


def test_speed_profile_frozen():
    """SpeedProfile is frozen (immutable)."""
    profile = SPEED_PROFILES["10mbps"]
    with pytest.raises(AttributeError):
        profile.name = "changed"


def test_apply_speed_profile_all_profiles(controller):
    """Every predefined profile should apply without error."""
    mock_client = _make_mock_client()
    controller._client = mock_client
    controller._is_v5 = False

    for name, profile in SPEED_PROFILES.items():
        mock_client.reset_mock()
        result = controller.apply_speed_profile(name)
        assert result is True
        mock_client.transfer_set_download_limit.assert_called_once_with(profile.max_download_bytes)
        mock_client.transfer_set_upload_limit.assert_called_once_with(profile.max_upload_bytes)


def test_download_stats_active_states(controller):
    """Verify all active torrent states are counted."""
    active_states = ["downloading", "stalledDL", "uploading", "stalledUP", "forcedDL", "forcedUP", "metaDL", "forcedMetaDL"]
    inactive_states = ["pausedUP", "pausedDL", "queuedUP", "queuedDL", "checkingUP", "checkingDL", "error", "unknown", "missingFiles"]

    mock_client = _make_mock_client()
    mock_client.transfer_info.return_value = {
        "dl_info_speed": 0, "up_info_speed": 0,
        "dl_info_data": 0, "up_info_data": 0,
    }
    mock_client.torrents_info.return_value = [
        {"state": s} for s in active_states + inactive_states
    ]
    controller._client = mock_client

    stats = controller.get_download_stats()
    assert stats["active_torrents"] == len(active_states)
    assert stats["total_torrents"] == len(active_states) + len(inactive_states)
