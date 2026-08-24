"""Cercas vivas: trazo sobre el DEM, plantas a espaciamiento y BoQ de estacas.

Catalogo de especies de referencia para Centroamerica (madero negro, poro,
leucaena, indio desnudo, bambu). No es receta de vivero ni normativa de
ganaderia: sirve para comparar metros y cantidad de material.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
import rasterio
from pyproj import Transformer
from shapely.geometry import LineString, mapping, Point
from shapely.ops import transform as shp_transform

from crsutil import transformer_from_wgs84
from ecosystems import _utm_epsg

STEEP_PCT = 35.0  # por encima, el establecimiento de estaca es dificil
ROW_GAP_M = 0.9
MAX_PLANT_FEATURES = 800
MAX_SPACING_M = 8.0
MIN_SPACING_M = 0.25

SPECIES: dict[str, dict[str, Any]] = {
    "gliricidia": {
        "id": "gliricidia",
        "name": "Madero negro (Gliricidia sepium)",
        "spacing_m": 0.5,
        "rows": 1,
        "price": 0.35,
        "unit": "estaca",
        "roles": ["potrero", "lindero", "forraje"],
        "note": "Estaca. Fija nitrogeno, cerca de ganado y forraje de poda.",
    },
    "erythrina": {
        "id": "erythrina",
        "name": "Poro (Erythrina poeppigiana)",
        "spacing_m": 1.0,
        "rows": 1,
        "price": 0.5,
        "unit": "estaca",
        "roles": ["lindero", "sombra", "forraje"],
        "note": "Estaca gruesa. Sombra de cafe y cerca perimetral.",
    },
    "leucaena": {
        "id": "leucaena",
        "name": "Leucaena (Leucaena leucocephala)",
        "spacing_m": 0.5,
        "rows": 1,
        "price": 0.25,
        "unit": "planton",
        "roles": ["potrero", "forraje", "lindero"],
        "note": "Planton. Banco de proteina; puede volverse invasora.",
    },
    "bursera": {
        "id": "bursera",
        "name": "Indio desnudo (Bursera simaruba)",
        "spacing_m": 1.5,
        "rows": 1,
        "price": 0.6,
        "unit": "estaca",
        "roles": ["lindero", "potrero"],
        "note": "Estaca grande. Lindero visible, poco forraje.",
    },
    "bamboo": {
        "id": "bamboo",
        "name": "Bambu",
        "spacing_m": 1.0,
        "rows": 2,
        "price": 1.2,
        "unit": "cepa",
        "roles": ["cortavientos", "lindero"],
        "note": "Dos hileras tipicas. Corta-vientos; no es cerca de ganado densa.",
    },
    "mixed": {
        "id": "mixed",
        "name": "Mixto multi-estrato",
        "spacing_m": 1.0,
        "rows": 2,
        "price": 0.8,
        "unit": "planta",
        "roles": ["multifuncional", "cortavientos", "lindero"],
        "note": "Arbol + arbusto. Cortavientos y biodiversidad, no un solo seto.",
    },
}

PURPOSES = ("lindero", "potrero", "cortavientos", "multifuncional")


def species_catalog() -> list[dict[str, Any]]:
    return [dict(v) for v in SPECIES.values()]


def _utm_line(coords_ll: list[list[float]]):
    lon0 = sum(c[0] for c in coords_ll) / len(coords_ll)
    lat0 = sum(c[1] for c in coords_ll) / len(coords_ll)
    epsg = _utm_epsg(lon0, lat0)
    to_utm = Transformer.from_crs("EPSG:4326", f"EPSG:{epsg}", always_xy=True).transform
    to_wgs = Transformer.from_crs(f"EPSG:{epsg}", "EPSG:4326", always_xy=True).transform
    line = shp_transform(to_utm, LineString([(c[0], c[1]) for c in coords_ll]))
    return line, to_wgs, epsg


def _sample_z(src: rasterio.DatasetReader, lon: float, lat: float) -> float | None:
    x, y = lon, lat
    to_native = transformer_from_wgs84(src.crs)
    if to_native is not None:
        x, y = to_native.transform(lon, lat)
    row, col = src.index(x, y)
    if row < 0 or col < 0 or row >= src.height or col >= src.width:
        return None
    z = float(src.read(1, window=rasterio.windows.Window(col, row, 1, 1))[0, 0])
    if src.nodata is not None and z == src.nodata:
        return None
    if not np.isfinite(z) or abs(z) > 1e5:
        return None
    return z


def _offset_xy(line: LineString, distance: float, offset_m: float) -> tuple[float, float]:
    pt = line.interpolate(min(distance, line.length))
    if offset_m == 0:
        return pt.x, pt.y
    ahead = min(line.length, distance + 0.6)
    behind = max(0.0, distance - 0.6)
    if ahead == behind:
        return pt.x, pt.y
    a = line.interpolate(behind)
    b = line.interpolate(ahead)
    dx, dy = b.x - a.x, b.y - a.y
    n = math.hypot(dx, dy) or 1.0
    return pt.x + (-dy / n) * offset_m, pt.y + (dx / n) * offset_m


def design_living_fence(
    dem_path: str,
    vertices: list[list[float]],
    species_id: str = "gliricidia",
    spacing_m: float | None = None,
    rows: int | None = None,
    purpose: str = "lindero",
) -> dict[str, Any]:
    if len(vertices) < 2:
        raise ValueError("La cerca viva necesita al menos dos vertices.")
    spec = SPECIES.get(species_id)
    if spec is None:
        raise ValueError(
            "Especie desconocida. Usa gliricidia, erythrina, leucaena, bursera, bamboo o mixed."
        )
    purpose = purpose if purpose in PURPOSES else "lindero"
    spacing = float(spacing_m if spacing_m is not None else spec["spacing_m"])
    spacing = min(MAX_SPACING_M, max(MIN_SPACING_M, spacing))
    n_rows = int(rows if rows is not None else spec["rows"])
    n_rows = min(4, max(1, n_rows))
    if purpose == "cortavientos":
        n_rows = max(n_rows, 2)

    line, to_wgs, _epsg = _utm_line(vertices)
    length2d = float(line.length)
    if length2d < 1.0:
        raise ValueError("El trazo es demasiado corto para una cerca (menos de 1 m).")

    step = min(5.0, max(1.0, spacing))
    n_prof = max(2, int(math.ceil(length2d / step)) + 1)

    with rasterio.open(dem_path) as src:
        samples: list[tuple[float, float, float, float]] = []  # chain, x, y, z
        for i in range(n_prof):
            chain = min(length2d, length2d * i / (n_prof - 1))
            pt = line.interpolate(chain)
            lon, lat = to_wgs(pt.x, pt.y)
            z = _sample_z(src, lon, lat)
            if z is None:
                continue
            samples.append((chain, pt.x, pt.y, z))

        if len(samples) < 2:
            raise ValueError("No hay cota a lo largo de la cerca (fuera del DEM).")

        length3d = 0.0
        grades: list[float] = []
        steep_runs: list[tuple[float, float, float]] = []  # start, end, max grade
        run_start: float | None = None
        run_max = 0.0
        prev = samples[0]
        for cur in samples[1:]:
            ds = math.hypot(cur[1] - prev[1], cur[2] - prev[2])
            dz = cur[3] - prev[3]
            length3d += math.hypot(ds, dz)
            grade = abs(dz) / ds * 100.0 if ds > 0.05 else 0.0
            grades.append(grade)
            if grade > STEEP_PCT:
                if run_start is None:
                    run_start = prev[0]
                    run_max = grade
                else:
                    run_max = max(run_max, grade)
            elif run_start is not None:
                steep_runs.append((run_start, prev[0], run_max))
                run_start = None
                run_max = 0.0
            prev = cur
        if run_start is not None:
            steep_runs.append((run_start, samples[-1][0], run_max))

        per_row = max(2, int(math.floor(length2d / spacing)) + 1)
        plant_count = per_row * n_rows
        stride = max(1, math.ceil(per_row / (MAX_PLANT_FEATURES / n_rows)))
        plant_features: list[dict[str, Any]] = []
        for row in range(n_rows):
            offset = (row - (n_rows - 1) / 2.0) * ROW_GAP_M
            for i in range(per_row):
                chain = min(length2d, i * spacing)
                if i == per_row - 1:
                    chain = length2d
                if i % stride != 0 and i not in (0, per_row - 1):
                    continue
                x, y = _offset_xy(line, chain, offset)
                lon, lat = to_wgs(x, y)
                z = _sample_z(src, lon, lat)
                plant_features.append(
                    {
                        "type": "Feature",
                        "properties": {
                            "type": "Plant",
                            "kind": "plant",
                            "row": row + 1,
                            "chain_m": round(chain, 1),
                            "z": None if z is None else round(z, 2),
                            "species": spec["id"],
                        },
                        "geometry": mapping(Point(lon, lat)),
                    }
                )

    steep_m = round(sum(end - start for start, end, _g in steep_runs), 1)
    mean_grade = round(float(np.mean(grades)) if grades else 0.0, 2)
    max_grade = round(float(np.max(grades)) if grades else 0.0, 2)
    unit_price = float(spec["price"])
    cost_plants = plant_count * unit_price
    # Mano de obra de referencia: ~0.4 USD/m de trazo (no cotizacion).
    labor_m = round(length2d * 0.4, 2)
    boq = [
        {
            "item": f"{spec['unit'].capitalize()} {spec['name']}",
            "qty": plant_count,
            "unit": spec["unit"],
            "unit_price": unit_price,
            "total": round(cost_plants, 2),
        },
        {
            "item": "Trazado y siembra de cerca viva",
            "qty": round(length2d, 1),
            "unit": "m",
            "unit_price": 0.4,
            "total": labor_m,
        },
    ]
    cost_ref = round(cost_plants + labor_m, 2)

    fence_line = {
        "type": "Feature",
        "properties": {
            "kind": "living-fence",
            "species": spec["id"],
            "species_name": spec["name"],
            "purpose": purpose,
            "spacing_m": spacing,
            "rows": n_rows,
            "length_m": round(length2d, 1),
            "length_3d_m": round(max(length2d, length3d), 1),
            "plant_count": plant_count,
            "mean_grade_pct": mean_grade,
            "max_grade_pct": max_grade,
            "steep_length_m": steep_m,
            "limit_pct": STEEP_PCT,
        },
        "geometry": mapping(LineString([(v[0], v[1]) for v in vertices])),
    }

    steep_features = []
    for start, end, gmax in steep_runs:
        if end - start < 2:
            continue
        n_seg = max(2, int((end - start) / 4) + 1)
        coords = []
        for i in range(n_seg):
            d = start + (end - start) * i / (n_seg - 1)
            pt = line.interpolate(d)
            lon, lat = to_wgs(pt.x, pt.y)
            coords.append((lon, lat))
        steep_features.append(
            {
                "type": "Feature",
                "properties": {
                    "kind": "steep",
                    "type": "Steep",
                    "grade_pct": round(gmax, 1),
                    "length_m": round(end - start, 1),
                    "limit_pct": STEEP_PCT,
                    "chainage_m": round(start, 1),
                },
                "geometry": {"type": "LineString", "coordinates": coords},
            }
        )

    notes = (
        f"{spec['note']} Pendiente > {STEEP_PCT:.0f} % (rojo) complica la estaca. "
        "Precios de referencia, no cotizacion. No sustituye diseno de cerca electrica "
        "ni normativa de linderos."
    )
    if purpose == "cortavientos" and n_rows < 3:
        notes += " Un corta-vientos efectivo suele llevar 2–3 hileras."

    return {
        "species": spec["id"],
        "species_name": spec["name"],
        "purpose": purpose,
        "spacing_m": spacing,
        "rows": n_rows,
        "vertices": vertices,
        "length_2d_m": round(length2d, 1),
        "length_3d_m": round(max(length2d, length3d), 1),
        "mean_grade_pct": mean_grade,
        "max_grade_pct": max_grade,
        "steep_length_m": steep_m,
        "steep_limit_pct": STEEP_PCT,
        "plant_count": plant_count,
        "plant_features_drawn": len(plant_features),
        "boq": boq,
        "cost_ref_usd": cost_ref,
        "notes": notes,
        "geojson": {
            "type": "FeatureCollection",
            "features": [fence_line, *steep_features, *plant_features],
        },
    }
