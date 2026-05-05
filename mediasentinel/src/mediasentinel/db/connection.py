import asyncio
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

import aiosqlite
from loguru import logger

_pool_lock = asyncio.Lock()
_pools: dict[str, aiosqlite.Connection] = {}


async def _get_shared_connection(db_path: Path) -> aiosqlite.Connection:
    key = str(db_path.resolve())
    if key in _pools:
        return _pools[key]

    db_path = Path(db_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)

    db = await aiosqlite.connect(str(db_path))
    await db.execute("PRAGMA foreign_keys=ON;")
    await db.execute("PRAGMA synchronous=NORMAL;")
    db.row_factory = aiosqlite.Row
    _pools[key] = db
    logger.bind(component="Database").debug("Created shared connection for {}", key)
    return db


@asynccontextmanager
async def get_db(db_path: Path) -> AsyncGenerator[aiosqlite.Connection, None]:
    async with _pool_lock:
        db = await _get_shared_connection(db_path)
    yield db


async def close_all_connections() -> None:
    async with _pool_lock:
        for key, db in _pools.items():
            try:
                await db.close()
            except Exception:
                pass
        _pools.clear()
        logger.bind(component="Database").debug("All database connections closed")


@asynccontextmanager
async def get_fresh_db(db_path: Path) -> AsyncGenerator[aiosqlite.Connection, None]:
    db_path = Path(db_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    db = await aiosqlite.connect(str(db_path))
    try:
        await db.execute("PRAGMA foreign_keys=ON;")
        await db.execute("PRAGMA synchronous=NORMAL;")
        db.row_factory = aiosqlite.Row
        yield db
    finally:
        await db.close()


async def _apply_pragmas(db_path: Path):
    db_path = Path(db_path)
    db = await aiosqlite.connect(str(db_path))
    try:
        await db.execute("PRAGMA journal_mode=WAL;")
        await db.execute("PRAGMA synchronous=NORMAL;")
        await db.execute("PRAGMA foreign_keys=ON;")
    finally:
        await db.close()


async def init_db(db_path: Path):
    await _apply_pragmas(db_path)
    schema_path = Path(__file__).parent / "schema.sql"
    schema_sql = schema_path.read_text(encoding="utf-8")

    async with get_fresh_db(db_path) as db:
        await db.executescript(schema_sql)
        await db.commit()

    logger.bind(component="Database").info("Database initialized at {}", db_path)
