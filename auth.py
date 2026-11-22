import secrets
import sqlite3
import bcrypt
from datetime import datetime, timedelta, timezone
from jose import JWTError, jwt

from state import DB_PATH

ALGORITHM = "HS256"
TOKEN_EXPIRE_HOURS = 12
MIN_PASSWORD_LENGTH = 8


def _get_config(key: str) -> str:
    try:
        con = sqlite3.connect(DB_PATH)
        row = con.execute(
            "SELECT value FROM config WHERE key = ?", (key,)
        ).fetchone()
        con.close()
        return row[0] if row else ""
    except Exception:
        return ""


def verify_password(plain: str) -> bool:
    h = _get_config("password_hash")
    if not h:
        return False
    try:
        return bcrypt.checkpw(plain.encode(), h.encode())
    except ValueError:
        return False


def _connect() -> sqlite3.Connection:
    con = sqlite3.connect(DB_PATH)
    con.execute(
        "CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
    )
    return con


def _hash(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def password_error(plain) -> str | None:
    if not isinstance(plain, str) or len(plain) < MIN_PASSWORD_LENGTH:
        return f"Password must be at least {MIN_PASSWORD_LENGTH} characters"
    if len(plain.encode()) > 72:
        return "Password must be at most 72 bytes"
    return None


def is_configured() -> bool:
    return bool(_get_config("password_hash"))


def create_initial_password(plain: str) -> bool:
    """Set the password only if none exists. Returns False if another writer won."""
    con = _connect()
    try:
        cur = con.execute(
            "INSERT OR IGNORE INTO config (key, value) VALUES ('password_hash', ?)",
            (_hash(plain),),
        )
        created = cur.rowcount == 1
        if created:
            con.execute(
                "INSERT OR REPLACE INTO config (key, value) VALUES ('secret_key', ?)",
                (secrets.token_hex(32),),
            )
        con.commit()
        return created
    finally:
        con.close()


def set_password(plain: str) -> None:
    """Replace the password and rotate the secret key, invalidating every existing token."""
    con = _connect()
    try:
        con.execute(
            "INSERT OR REPLACE INTO config (key, value) VALUES ('password_hash', ?)",
            (_hash(plain),),
        )
        con.execute(
            "INSERT OR REPLACE INTO config (key, value) VALUES ('secret_key', ?)",
            (secrets.token_hex(32),),
        )
        con.commit()
    finally:
        con.close()


def create_token() -> str:
    secret = _get_config("secret_key")
    if not secret:
        raise RuntimeError("secret_key is not configured")
    expire = datetime.now(timezone.utc) + timedelta(hours=TOKEN_EXPIRE_HOURS)
    return jwt.encode({"exp": expire, "sub": "admin"}, secret, algorithm=ALGORITHM)


def verify_token(token: str) -> bool:
    secret = _get_config("secret_key")
    if not secret:
        return False
    try:
        payload = jwt.decode(token, secret, algorithms=[ALGORITHM])
        return payload.get("sub") == "admin"
    except JWTError:
        return False
