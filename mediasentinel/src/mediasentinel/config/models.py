from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class ServiceConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    url: str
    poll_interval_seconds: int = Field(ge=5, le=300, default=30)
    critical: bool = False
    failure_threshold: int = Field(ge=1, le=10, default=3)

    @field_validator("url")
    @classmethod
    def validate_url(cls, v: str) -> str:
        v = v.strip()
        if not v.startswith(("http://", "https://")):
            raise ValueError("URL must start with http:// or https://")
        return v.rstrip("/")


class VPNConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    adapter_description: str
    poll_interval_seconds: int = Field(ge=5, le=60, default=10)
    expected_endpoint: str = ""


class QBittorrentConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    host: str = "http://localhost:8080"
    username: str = "admin"
    password_env: str = "QBITTORRENT_PASSWORD"
    speed_profile: str = "100+mbps"
    verify_binding_interval: int = Field(ge=30, le=3600, default=300)

    @field_validator("speed_profile")
    @classmethod
    def validate_speed_profile(cls, v: str) -> str:
        valid = ("10mbps", "50mbps", "100mbps", "100+mbps")
        if v not in valid:
            raise ValueError(f"speed_profile must be one of {valid}, got '{v}'")
        return v


class TunnelConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tunnel_name: str
    health_check_url: str
    poll_interval_seconds: int = Field(ge=5, le=300, default=30)
    cf_api_token_env: str = "CLOUDFLARE_API_TOKEN"


class LoggingConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    log_dir: str = r"%PROGRAMDATA%\MediaSentinel\logs"
    log_level: str = "INFO"
    rotation_size: str = "10 MB"
    retention_days: str = "30 days"

    @field_validator("log_level")
    @classmethod
    def validate_log_level(cls, v: str) -> str:
        allowed = ("DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL")
        if v not in allowed:
            raise ValueError(f"log_level must be one of {allowed}")
        return v


class DatabaseConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    db_path: str = r"%PROGRAMDATA%\MediaSentinel\metrics.sqlite"


class AlertConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    smtp_host: str = ""
    smtp_port: int = Field(ge=1, le=65535, default=587)
    smtp_user: str = ""
    smtp_password_env: str = ""
    from_address: str = ""
    to_addresses: list[str] = []
    webhook_urls: list[str] = []
    emergency_repeat_interval_seconds: int = Field(ge=30, le=3600, default=300)
    throttle_detection_window: int = Field(ge=3, le=50, default=10)


class RecoveryPolicy(BaseModel):
    model_config = ConfigDict(extra="forbid")

    max_retries: int = Field(ge=1, le=10, default=3)
    cooldown_seconds: int = Field(ge=30, le=3600, default=300)
    docker_restart_timeout: int = Field(ge=10, le=120, default=30)
    escalation_threshold: int = Field(ge=1, le=5, default=2)


class AppConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    services: list[ServiceConfig]
    vpn: VPNConfig
    qbt: QBittorrentConfig = QBittorrentConfig()
    tunnels: list[TunnelConfig] = []
    logging: LoggingConfig = LoggingConfig()
    database: DatabaseConfig = DatabaseConfig()
    alerts: AlertConfig = AlertConfig()
    recovery: RecoveryPolicy = RecoveryPolicy()

    @model_validator(mode="after")
    def validate_service_names_unique(self) -> "AppConfig":
        names = [s.name for s in self.services]
        if len(names) != len(set(names)):
            raise ValueError("Duplicate service names found")
        return self
