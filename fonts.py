import os
from pathlib import Path

BUNDLED_FONTS_DIR = Path(__file__).resolve().parent / "static" / "fonts"
FONTS_DIR = Path(os.getenv("FONTS_DIR") or Path(os.getenv("DB_PATH", "scoreboard.db")).resolve().parent / "fonts")
FONT_MEDIA_TYPES = {".ttf": "font/ttf", ".otf": "font/otf", ".woff": "font/woff", ".woff2": "font/woff2"}
MAX_FONT_BYTES = 10 * 1024 * 1024
DEFAULT_FONT = "High School USA Sans.ttf"


def is_valid_font_name(name) -> bool:
    return (
        isinstance(name, str)
        and name == Path(name).name
        and not name.startswith(".")
        and Path(name).suffix.lower() in FONT_MEDIA_TYPES
    )


def font_path(name) -> Path | None:
    if not is_valid_font_name(name):
        return None
    for directory in (FONTS_DIR, BUNDLED_FONTS_DIR):
        p = directory / name
        if p.is_file():
            return p
    return None


def list_fonts() -> list[str]:
    names = set()
    for directory in (FONTS_DIR, BUNDLED_FONTS_DIR):
        if directory.is_dir():
            names.update(p.name for p in directory.iterdir() if p.is_file() and is_valid_font_name(p.name))
    return sorted(names, key=str.lower)
