/** Haversine distance in meters between [lon, lat] pairs. */
export function distanceMeters(a: number[], b: number[]): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function pathLengthMeters(coords: number[][]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    total += distanceMeters(coords[i - 1], coords[i]);
  }
  return total;
}

/** Approximate geodesic area (m²) via spherical excess for a closed ring. */
export function ringAreaMeters2(coords: number[][]): number {
  if (coords.length < 3) return 0;
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  let area = 0;
  const ring =
    coords[0][0] === coords[coords.length - 1][0] &&
    coords[0][1] === coords[coords.length - 1][1]
      ? coords
      : [...coords, coords[0]];

  for (let i = 0; i < ring.length - 1; i++) {
    const lon1 = toRad(ring[i][0]);
    const lon2 = toRad(ring[i + 1][0]);
    const lat1 = toRad(ring[i][1]);
    const lat2 = toRad(ring[i + 1][1]);
    area += (lon2 - lon1) * (2 + Math.sin(lat1) + Math.sin(lat2));
  }
  return Math.abs((area * R * R) / 2);
}

export function formatLength(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(2)} km`;
  return `${m.toFixed(1)} m`;
}

export function formatArea(m2: number): string {
  const ha = m2 / 10000;
  if (ha >= 1) return `${ha.toFixed(2)} ha`;
  return `${m2.toFixed(0)} m²`;
}

/** Map elevation to a green→yellow→brown contour color. */
export function elevationColor(
  elev: number,
  min: number,
  max: number,
  opacity = 200
): [number, number, number, number] {
  const t = max > min ? Math.min(1, Math.max(0, (elev - min) / (max - min))) : 0.5;
  // low: teal-green, mid: lime, high: amber-brown
  const r = Math.round(30 + t * 180);
  const g = Math.round(160 - t * 40);
  const b = Math.round(80 - t * 60);
  return [r, g, Math.max(20, b), opacity];
}

export function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function approxZoomScale(zoom: number, latitude: number): number {
  const metersPerPixel =
    (156543.03392 * Math.cos((latitude * Math.PI) / 180)) / Math.pow(2, zoom);
  // assume ~96 dpi screen → scale ≈ metersPerPixel * 96 / 0.0254
  return Math.round(metersPerPixel * 3779.5);
}
