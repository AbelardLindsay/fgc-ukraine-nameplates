import aiosqlite
import json
import os
import re
from datetime import datetime, timezone

from fonts import DEFAULT_FONT, font_path

DB_PATH = os.getenv("DB_PATH", "scoreboard.db")

ROUNDS = [
    "Pool Play",
    "Top 32",
    "Top 16",
    "Top 8",
    "Winners Quarterfinals",
    "Winners Semifinals",
    "Winners Finals",
    "Losers Round 1",
    "Losers Round 2",
    "Losers Round 3",
    "Losers Top 8",
    "Losers Quarterfinals",
    "Losers Semifinals",
    "Losers Finals",
    "Grand Finals",
    "Grand Finals Reset",
    "Showmatch (FT5)",
    "Showmatch (FT7)",
    "Showmatch (FT10)",
    "Freeplay",
]

# Overlay text sizes in px: key -> (default, min, max).
FONT_SIZES = {
    "name_size": (22, 12, 36),
    "score_size": (30, 14, 44),
    "round_size": (12, 8, 20),
    "event_size": (18, 10, 32),
}

DEFAULT_THEME = {
    "font": DEFAULT_FONT,
    "p1_color_start": "#0059b7",
    "p1_color_end": "#007dc0",
    "p2_color_start": "#fca600",
    "p2_color_end": "#ffc435",
    "round_bg_color": "#f0f0f0",
    "round_text_color": "#0f0f0f",
    "player_text_color": "#f0f0f0",
    "event_text_color": "#f0f0f0",
    **{key: default for key, (default, _, _) in FONT_SIZES.items()},
}
COLOR_KEYS = tuple(k for k in DEFAULT_THEME if k != "font" and k not in FONT_SIZES)
_HEX_COLOR = re.compile(r"#[0-9a-fA-F]{6}")

DEFAULT_STATE = {
    "player1_name": "PLAYER 1",
    "player2_name": "PLAYER 2",
    "player1_score": 0,
    "player2_score": 0,
    "round": "Grand Finals",
    "event_name": "FGC Ukraine Event",
    **DEFAULT_THEME,
}


async def init_db():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS state (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                data TEXT NOT NULL
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS config (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS player_cache (
                name    TEXT PRIMARY KEY,
                used_at TEXT NOT NULL
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS event_cache (
                name    TEXT PRIMARY KEY,
                used_at TEXT NOT NULL
            )
        """)
        cursor = await db.execute("SELECT COUNT(*) FROM state")
        count = (await cursor.fetchone())[0]
        if count == 0:
            await db.execute(
                "INSERT INTO state (id, data) VALUES (1, ?)",
                (json.dumps(DEFAULT_STATE),),
            )
        await db.commit()


async def get_state() -> dict:
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute("SELECT data FROM state WHERE id = 1")
        row = await cursor.fetchone()
        return {**DEFAULT_STATE, **json.loads(row[0])}


_DEFAULT_NAMES = {"PLAYER 1", "PLAYER 2"}


async def cache_player(name: str):
    if not name or name in _DEFAULT_NAMES:
        return
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT OR REPLACE INTO player_cache (name, used_at) VALUES (?, ?)",
            (name, datetime.now(timezone.utc).isoformat()),
        )
        await db.commit()


async def cache_event(name: str):
    if not name:
        return
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT OR REPLACE INTO event_cache (name, used_at) VALUES (?, ?)",
            (name, datetime.now(timezone.utc).isoformat()),
        )
        await db.commit()


async def get_player_cache() -> list:
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute(
            "SELECT name FROM player_cache ORDER BY used_at DESC"
        )
        return [r[0] for r in await cursor.fetchall()]


async def get_event_cache() -> list:
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute(
            "SELECT name FROM event_cache ORDER BY used_at DESC"
        )
        return [r[0] for r in await cursor.fetchall()]


async def update_state(updates: dict) -> dict:
    current = await get_state()
    allowed = set(DEFAULT_STATE.keys())
    for key, value in updates.items():
        if key not in allowed:
            continue
        if key in COLOR_KEYS:
            if not (isinstance(value, str) and _HEX_COLOR.fullmatch(value)):
                continue
            value = value.lower()
        elif key in FONT_SIZES:
            _, lo, hi = FONT_SIZES[key]
            if not (isinstance(value, int) and not isinstance(value, bool) and lo <= value <= hi):
                continue
        elif key == "font" and font_path(value) is None:
            continue
        current[key] = value
    current["player1_score"] = max(0, min(99, int(current["player1_score"])))
    current["player2_score"] = max(0, min(99, int(current["player2_score"])))
    if current["round"] not in ROUNDS:
        current["round"] = DEFAULT_STATE["round"]
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE state SET data = ? WHERE id = 1",
            (json.dumps(current),),
        )
        await db.commit()
    return current
