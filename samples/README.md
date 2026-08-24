# DEM de ejemplo

`valle_ejemplo.tif` es un valle **sintético** de 1,5 × 1,5 km, celdas de 10 m,
CRS CRTM05 (EPSG:5367). No es una finca real: sirve para recorrer el programa
sin un GeoTIFF del cliente.

En PermacultureSoft: **Importar** y elige este archivo.

Para regenerarlo (desde `backend/`, con el venv activo):

```
python ..\scripts\make_sample_dem.py
```
