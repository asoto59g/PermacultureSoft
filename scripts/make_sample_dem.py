"""Genera samples/valle_ejemplo.tif: valle sintetico 1.5 x 1.5 km, 10 m, CRTM05.

No es una finca real. Sirve para probar el programa sin un DEM del cliente.
Ejecutar desde backend/ (para pin_proj_data):

    python ..\\scripts\\make_sample_dem.py
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from projfix import pin_proj_data  # noqa: E402

pin_proj_data()

import numpy as np  # noqa: E402
import rasterio  # noqa: E402
from rasterio.transform import from_origin  # noqa: E402

# CRTM05, ladera oeste del Valle Central (tierra firme, no golfo).
WEST = 470_000.0
NORTH = 1_102_000.0
PIXEL_M = 10.0
SIZE = 150
OUT = ROOT / "samples" / "valle_ejemplo.tif"


def main() -> None:
    rows, cols = np.indices((SIZE, SIZE))
    along = rows.astype(np.float64) * 1.1
    valley = ((cols - (SIZE - 1) / 2.0) ** 2) * 0.04
    ridges = 8.0 * np.sin(cols / 18.0)
    elev = (780.0 - along + valley + ridges).astype("float32")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    transform = from_origin(WEST, NORTH, PIXEL_M, PIXEL_M)
    with rasterio.open(
        OUT,
        "w",
        driver="GTiff",
        height=SIZE,
        width=SIZE,
        count=1,
        dtype="float32",
        crs="EPSG:5367",
        transform=transform,
        nodata=-9999.0,
        compress="lzw",
    ) as dst:
        dst.write(elev, 1)
        dst.update_tags(
            AREA_OR_POINT="Area",
            DESCRIPTION="Valle sintetico PermacultureSoft. No es una finca real.",
        )
    print(f"Escrito {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
