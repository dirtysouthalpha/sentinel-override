from contextlib import asynccontextmanager
from pathlib import Path

import aiosqlite
from loguru import logger


@asynccontextmanager
async def get_db(db_path: Path):
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
    """Apply persistent PRAGMAs once during initialization (IN-05)."""
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

    async with get_db(db_path) as db:
        await db.executescript(schema_sql)
        await db.commit()

    logger.bind(component="Database").info("Database initialized at {}", db_path)
