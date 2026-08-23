from pyproj import CRS, Transformer


def normalize_crs(raster_crs):
    """Map messy GDAL CRS (LOCAL_CS, WKT without EPSG) to a pyproj CRS."""
    if raster_crs is None:
        return None

    wkt = ""
    try:
        wkt = raster_crs.to_wkt()
    except Exception:
        wkt = str(raster_crs)

    if "CRTM05" in wkt or "CR-SIRGAS" in wkt:
        return CRS.from_epsg(5367)

    try:
        crs = CRS.from_user_input(wkt)
    except Exception:
        try:
            crs = CRS.from_user_input(raster_crs)
        except Exception:
            return None

    if crs.is_geographic:
        return CRS.from_epsg(4326)

    epsg = crs.to_epsg()
    if epsg:
        return CRS.from_epsg(epsg)
    return crs


def transformer_to_wgs84(raster_crs):
    """None means coordinates are already lon/lat WGS84."""
    crs = normalize_crs(raster_crs)
    if crs is None:
        return None
    if crs.to_epsg() == 4326:
        return None
    return Transformer.from_crs(crs, "EPSG:4326", always_xy=True)


def transformer_from_wgs84(raster_crs):
    crs = normalize_crs(raster_crs)
    if crs is None:
        return None
    if crs.to_epsg() == 4326:
        return None
    return Transformer.from_crs("EPSG:4326", crs, always_xy=True)
