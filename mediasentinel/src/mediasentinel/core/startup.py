import asyncio
from pathlib import Path

from loguru import logger

from mediasentinel.config.models import AppConfig
from mediasentinel.db.connection import get_db, init_db


class StartupCheckResult:
    def __init__(self, name: str, passed: bool, message: str = ""):
        self.name = name
        self.passed = passed
        self.message = message


async def run_startup_checks(config: AppConfig, db_path: Path) -> list[StartupCheckResult]:
    results = []

    # Database writable
    results.append(await _check_database(db_path))

    # Config validity
    results.append(_check_service_urls(config))

    # Docker availability (soft check)
    results.append(await _check_docker())

    return results


async def _check_database(db_path: Path) -> StartupCheckResult:
    try:
        db_path.parent.mkdir(parents=True, exist_ok=True)
        await init_db(db_path)
        async with get_db(db_path) as db:
            cursor = await db.execute("SELECT COUNT(*) FROM services")
            await cursor.fetchone()
        return StartupCheckResult("database", True)
    except Exception as e:
        return StartupCheckResult("database", False, str(e))


def _check_service_urls(config: AppConfig) -> StartupCheckResult:
    for svc in config.services:
        if not svc.url.startswith(("http://", "https://")):
            return StartupCheckResult("service_urls", False, f"Invalid URL for {svc.name}: {svc.url}")
    return StartupCheckResult("service_urls", True)


async def _check_docker() -> StartupCheckResult:
    try:
        import docker
        client = docker.from_env()
        await asyncio.to_thread(client.ping)
        client.close()
        return StartupCheckResult("docker", True)
    except ImportError:
        return StartupCheckResult("docker", False, "docker package not installed")
    except Exception as e:
        return StartupCheckResult("docker", False, str(e))
