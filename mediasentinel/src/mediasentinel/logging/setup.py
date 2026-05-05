import os
import sys
from pathlib import Path

from loguru import logger

from mediasentinel.config.models import LoggingConfig


def setup_logging(config: LoggingConfig, debug: bool = False):
    log_dir = Path(os.path.expandvars(config.log_dir))
    log_dir.mkdir(parents=True, exist_ok=True)

    logger.remove()

    level = "DEBUG" if debug else config.log_level

    logger.add(
        sys.stderr,
        format="{time:YYYY-MM-DD HH:mm:ss} | {level: <8} | {extra.get('component', 'MediaSentinel')} - {message}",
        level=level,
    )

    logger.add(
        log_dir / "mediasentinel.json",
        serialize=True,
        rotation=config.rotation_size,
        retention=config.retention_days,
        compression="gz",
        level="DEBUG",
    )

    logger.add(
        log_dir / "health.log",
        format="{time:YYYY-MM-DD HH:mm:ss} | {level} | {message}",
        filter=lambda record: record["extra"].get("component") == "HealthMonitor",
        rotation=config.rotation_size,
        retention="14 days",
    )

    logger.add(
        log_dir / "recovery.log",
        format="{time:YYYY-MM-DD HH:mm:ss} | {level} | {message}",
        filter=lambda record: record["extra"].get("component") == "RecoveryEngine",
        rotation=config.rotation_size,
        retention="90 days",
    )

    return logger
