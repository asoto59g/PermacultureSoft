"""Neutralise a foreign PROJ_LIB before any GIS import.

A machine-wide PROJ_LIB (PostGIS installs one) shadows the PROJ database that
rasterio and pyproj ship with, and every CRS lookup then fails with
"DATABASE.LAYOUT.VERSION.MINOR = 2 whereas a number >= 6 is expected".
Only a PROJ_LIB pointing outside this interpreter is replaced; an unset or
in-venv value is left alone so normal installs keep their own defaults.
"""

from __future__ import annotations

import importlib.util
import os
import sys
from pathlib import Path

_VARS = ("PROJ_LIB", "PROJ_DATA")


def _bundled_proj_data() -> Path | None:
    spec = importlib.util.find_spec("rasterio")
    if spec is None or not spec.origin:
        return None
    candidate = Path(spec.origin).parent / "proj_data"
    return candidate if (candidate / "proj.db").is_file() else None


def pin_proj_data() -> str | None:
    """Returns the path it pinned, or None if nothing needed fixing."""
    prefix = Path(sys.prefix).resolve()
    foreign = []
    for var in _VARS:
        value = os.environ.get(var)
        if not value:
            continue
        try:
            if prefix in Path(value).resolve().parents:
                continue
        except OSError:
            pass
        foreign.append(var)
    if not foreign:
        return None

    bundled = _bundled_proj_data()
    if bundled is None:
        for var in foreign:
            os.environ.pop(var, None)
        return None

    for var in _VARS:
        os.environ[var] = str(bundled)
    return str(bundled)
