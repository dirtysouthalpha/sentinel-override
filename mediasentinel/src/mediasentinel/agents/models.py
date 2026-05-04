from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class HealthStatus(str, Enum):
    HEALTHY = "healthy"
    DEGRADED = "degraded"
    UNHEALTHY = "unhealthy"


class HealthResult(BaseModel):
    service_name: str
    status: HealthStatus
    response_time_ms: float = 0.0
    version: Optional[str] = None
    details: Optional[str] = None
    checked_at: datetime = datetime.now()


class VPNState(str, Enum):
    DISCONNECTED = "disconnected"
    CONNECTING = "connecting"
    CONNECTED = "connected"
    DEGRADED = "degraded"


class VPNStatus(BaseModel):
    state: VPNState = VPNState.DISCONNECTED
    adapter_name: Optional[str] = None
    local_ip: Optional[str] = None
    external_ip: Optional[str] = None
    latency_ms: Optional[float] = None
    dns_leak: Optional[bool] = None
    ip_leak: Optional[bool] = None


class TunnelResult(BaseModel):
    tunnel_name: str
    url_reachable: bool = False
    cf_api_status: Optional[str] = None
    dns_valid: bool = False
    latency_ms: float = 0.0
    checked_at: datetime = datetime.now()


class RecoveryAction(str, Enum):
    SELF_HEAL_WAIT = "self_heal_wait"
    DOCKER_RESTART = "docker_restart"
    DEPENDENCY_RECOVERY = "dependency_recovery"
    STACK_RESET = "stack_reset"
    VPN_RECONNECT = "vpn_reconnect"
    NETWORK_RECOVERY = "network_recovery"
    ESCALATE = "escalate"
    # Legacy aliases retained for tunnel/VPN recovery paths
    SERVICE_RESTART = "service_restart"
    TUNNEL_RESTART = "tunnel_restart"


class RecoveryResult(BaseModel):
    service_name: str
    action: RecoveryAction
    success: bool
    escalation_level: int = 0
    details: Optional[str] = None
    started_at: datetime = datetime.now()
    completed_at: Optional[datetime] = None


class RecoveryLevel(int, Enum):
    """7-level escalation hierarchy (REC-01)."""
    SELF_HEAL_WAIT = 1
    SOFT_RESTART = 2
    DEPENDENCY_RECOVERY = 3
    STACK_RESET = 4
    VPN_RECOVERY = 5
    NETWORK_RECOVERY = 6
    OPERATOR_ESCALATION = 7


class DownloadState(str, Enum):
    """State machine for download VPN gate (REC-06)."""
    INIT = "init"
    VPN_VERIFIED = "vpn_verified"
    VPN_DOWN = "vpn_down"
    VPN_RECOVERING = "vpn_recovering"


class SpeedProfile(BaseModel):
    """Bandwidth profile for speed-limited operations."""
    name: str
    max_download_kb: int = Field(ge=0, default=0)
    max_upload_kb: int = Field(ge=0, default=0)
    max_connections: int = Field(ge=0, default=0)
