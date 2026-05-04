import os
from dataclasses import dataclass
from enum import Enum
from typing import Optional

from loguru import logger

from mediasentinel.agents.models import VPNState
from mediasentinel.config.models import QBittorrentConfig


class TorrentAction(str, Enum):
    PAUSED = "paused"
    RESUMED = "resumed"
    NONE = "none"


@dataclass(frozen=True)
class SpeedProfile:
    """Predefined speed profile with 85% bandwidth utilization."""
    name: str
    max_download_bytes: int
    max_upload_bytes: int
    max_connections: int


SPEED_PROFILES: dict[str, SpeedProfile] = {
    "10mbps": SpeedProfile(
        name="10mbps",
        max_download_bytes=1075200,   # 85% of 10 Mbps
        max_upload_bytes=256000,
        max_connections=50,
    ),
    "50mbps": SpeedProfile(
        name="50mbps",
        max_download_bytes=5376000,   # 85% of 50 Mbps
        max_upload_bytes=512000,
        max_connections=100,
    ),
    "100mbps": SpeedProfile(
        name="100mbps",
        max_download_bytes=10752000,  # 85% of 100 Mbps
        max_upload_bytes=1024000,
        max_connections=200,
    ),
    "100+mbps": SpeedProfile(
        name="100+mbps",
        max_download_bytes=21401600,  # ~170 Mbps cap at 85%
        max_upload_bytes=2048000,
        max_connections=300,
    ),
}


class QBittorrentController:
    def __init__(self, config: QBittorrentConfig):
        self.config = config
        self._client = None
        self._version: Optional[str] = None
        self._is_v5: Optional[bool] = None
        self._last_action: TorrentAction = TorrentAction.NONE

    def _get_client(self):
        if self._client is None:
            import qbittorrentapi

            password = os.environ.get(self.config.password_env, "")
            self._client = qbittorrentapi.Client(
                host=self.config.host,
                username=self.config.username,
                password=password,
            )
        return self._client

    def _detect_version(self) -> None:
        if self._is_v5 is not None:
            return
        try:
            client = self._get_client()
            client.auth_log_in()
            version_str = client.app_version()
            self._version = version_str
            # v5 starts with "5.", v4 with "4."
            major = version_str.lstrip("v").split(".")[0]
            self._is_v5 = int(major) >= 5
            logger.bind(component="QBTController").info(
                "qBittorrent version: {} (v5={})", version_str, self._is_v5
            )
        except Exception as e:
            logger.bind(component="QBTController").error("Version detection failed: {}", e)
            self._is_v5 = False

    def _pause_all(self) -> bool:
        client = self._get_client()
        try:
            client.auth_log_in()
            if self._is_v5:
                # v5: stop
                client.torrents_stop.all()
            else:
                # v4: pause
                client.torrents_pause.all()
            return True
        except Exception as e:
            logger.bind(component="QBTController").error("Failed to pause torrents: {}", e)
            return False

    def _resume_all(self) -> bool:
        client = self._get_client()
        try:
            client.auth_log_in()
            if self._is_v5:
                client.torrents_start.all()
            else:
                client.torrents_resume.all()
            return True
        except Exception as e:
            logger.bind(component="QBTController").error("Failed to resume torrents: {}", e)
            return False

    def enforce_vpn_gate(self, vpn_state: VPNState) -> TorrentAction:
        log = logger.bind(component="QBTController", action="vpn_gate")

        # Fail-closed: if VPN is not confirmed CONNECTED, pause everything
        if vpn_state == VPNState.CONNECTED:
            if self._last_action == TorrentAction.PAUSED or self._last_action == TorrentAction.NONE:
                log.info("VPN connected — resuming all torrents")
                self._detect_version()
                if self._resume_all():
                    self._last_action = TorrentAction.RESUMED
                    return TorrentAction.RESUMED
                return TorrentAction.NONE
            return TorrentAction.NONE
        else:
            # DISCONNECTED, DEGRADED, CONNECTING — all treated as "not safe"
            if self._last_action != TorrentAction.PAUSED:
                log.warning("VPN not connected (state={}) — pausing all torrents", vpn_state.value)
                self._detect_version()
                if self._pause_all():
                    self._last_action = TorrentAction.PAUSED
                    return TorrentAction.PAUSED
                return TorrentAction.NONE
            return TorrentAction.NONE

    @property
    def last_action(self) -> TorrentAction:
        return self._last_action

    def apply_speed_profile(self, profile_name: str) -> bool:
        """Apply a predefined speed profile to qBittorrent.

        Sets download/upload limits and connection counts via the API.
        Returns True if applied successfully, False otherwise.
        """
        log = logger.bind(component="QBTController", action="speed_profile")

        profile = SPEED_PROFILES.get(profile_name)
        if profile is None:
            log.error("Unknown speed profile: '{}'. Available: {}", profile_name, list(SPEED_PROFILES.keys()))
            return False

        try:
            client = self._get_client()
            client.auth_log_in()
            self._detect_version()

            client.transfer_set_download_limit(profile.max_download_bytes)
            client.transfer_set_upload_limit(profile.max_upload_bytes)
            client.app_set_preferences({
                "max_connec": profile.max_connections,
                "max_connec_per_torrent": profile.max_connections // 2,
            })

            log.info(
                "Applied speed profile '{}': down={} bytes/s, up={} bytes/s, connections={}",
                profile.name,
                profile.max_download_bytes,
                profile.max_upload_bytes,
                profile.max_connections,
            )
            return True
        except Exception as e:
            log.error("Failed to apply speed profile '{}': {}", profile_name, e)
            return False

    def get_current_speed_profile(self) -> Optional[str]:
        """Read current speed limits and match to a known profile.

        Returns the profile name if matched, None if no match or error.
        """
        log = logger.bind(component="QBTController", action="speed_profile_query")

        try:
            client = self._get_client()
            client.auth_log_in()

            download_limit = client.transfer_info().get("dl_limit", 0)
            upload_limit = client.transfer_info().get("up_limit", 0)

            prefs = client.app_preferences()
            max_connec = prefs.get("max_connec", -1)

            for name, profile in SPEED_PROFILES.items():
                if (
                    download_limit == profile.max_download_bytes
                    and upload_limit == profile.max_upload_bytes
                    and max_connec == profile.max_connections
                ):
                    return name

            log.debug("Current limits do not match any known profile (dl={}, up={}, conn={})", download_limit, upload_limit, max_connec)
            return None
        except Exception as e:
            log.error("Failed to query current speed profile: {}", e)
            return None

    def get_download_stats(self) -> dict:
        """Return current download/upload speeds, active torrent count, and totals.

        Returns dict with keys: download_speed, upload_speed, active_torrents,
        total_downloaded_bytes, total_uploaded_bytes. Returns empty dict on error.
        """
        log = logger.bind(component="QBTController", action="download_stats")

        try:
            client = self._get_client()
            client.auth_log_in()

            transfer = client.transfer_info()
            download_speed = transfer.get("dl_info_speed", 0)
            upload_speed = transfer.get("up_info_speed", 0)
            total_downloaded = transfer.get("dl_info_data", 0)
            total_uploaded = transfer.get("up_info_data", 0)

            torrents = client.torrents_info()
            active_count = sum(
                1 for t in torrents
                if t.get("state", "") in ("downloading", "stalledDL", "uploading", "stalledUP", "forcedDL", "forcedUP", "metaDL", "forcedMetaDL")
            )

            return {
                "download_speed": download_speed,
                "upload_speed": upload_speed,
                "active_torrents": active_count,
                "total_torrents": len(torrents),
                "total_downloaded_bytes": total_downloaded,
                "total_uploaded_bytes": total_uploaded,
            }
        except Exception as e:
            log.error("Failed to get download stats: {}", e)
            return {}

    def verify_interface_binding(self, vpn_adapter_name: str) -> bool:
        """Check if qBittorrent is bound to the VPN network adapter.

        Returns True if bound to vpn_adapter_name or set to empty (auto-detect).
        If bound to a different interface: pauses downloads and returns False.
        """
        log = logger.bind(component="QBTController", action="interface_binding")

        try:
            client = self._get_client()
            client.auth_log_in()

            prefs = client.app_preferences()
            bound_interface = prefs.get("connection_interface", "")

            # Empty interface means auto-detect which is acceptable when VPN is active
            if bound_interface == "" or bound_interface is None:
                log.debug("qBittorrent interface binding set to auto-detect (empty)")
                return True

            if bound_interface == vpn_adapter_name:
                log.debug("qBittorrent bound to VPN adapter: '{}'", vpn_adapter_name)
                return True

            # Bound to a different interface -- fail-closed: pause all downloads
            log.warning(
                "qBittorrent bound to '{}' instead of VPN adapter '{}'. Pausing downloads.",
                bound_interface,
                vpn_adapter_name,
            )
            self._detect_version()
            self._pause_all()
            return False
        except Exception as e:
            log.error("Failed to verify interface binding: {}", e)
            # Fail-closed: if we cannot verify, treat as unsafe
            return False

    def set_interface_binding(self, adapter_name: str) -> bool:
        """Force qBittorrent to use the specified network adapter.

        Returns True if set successfully, False otherwise.
        """
        log = logger.bind(component="QBTController", action="interface_binding")

        try:
            client = self._get_client()
            client.auth_log_in()

            client.app_set_preferences({"connection_interface": adapter_name})
            log.info("Set qBittorrent interface binding to: '{}'", adapter_name)
            return True
        except Exception as e:
            log.error("Failed to set interface binding to '{}': {}", adapter_name, e)
            return False

    def close(self) -> None:
        if self._client:
            try:
                self._client.auth_log_out()
            except Exception:
                pass
