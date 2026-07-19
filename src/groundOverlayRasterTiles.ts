import type { GroundOverlay } from "./types";

type Quad = NonNullable<GroundOverlay["coordinates"]>;

export interface RasterTilePlan {
  z: number;
  x: number;
  y: number;
  rawX: number;
  bounds: [number, number, number, number];
}

export interface RenderableRasterTile extends RasterTilePlan {
  imageUrl: string;
}

export interface RasterTilePyramid {
  tileSize: number;
  targetZoom: number;
  bounds: [number, number, number, number];
  tiles: RenderableRasterTile[];
}

const MAX_MERCATOR_LATITUDE = 85.0511287798066;
const DEFAULT_TILE_SIZE = 512;
const MAX_TARGET_ZOOM = 14;
const MAX_TARGET_TILES = 128;

function clampLatitude(latitude: number): number {
  return Math.max(-MAX_MERCATOR_LATITUDE, Math.min(MAX_MERCATOR_LATITUDE, latitude));
}

function unwrapNear(longitude: number, reference: number): number {
  let result = longitude;
  while (result - reference > 180) result -= 360;
  while (result - reference < -180) result += 360;
  return result;
}

function unwrapEast(west: number, east: number): number {
  let result = east;
  while (result < west) result += 360;
  return Math.min(result, west + 360);
}

function unwrappedQuad(overlay: GroundOverlay): Quad | undefined {
  if (!overlay.coordinates) return undefined;
  const reference = overlay.coordinates[0][0];
  return overlay.coordinates.map((point) => [unwrapNear(point[0], reference), point[1]]) as Quad;
}

function overlayExtent(overlay: GroundOverlay): [number, number, number, number] | undefined {
  if (overlay.bounds && overlay.rotation === 0) {
    const [west, south, rawEast, north] = overlay.bounds;
    const east = unwrapEast(west, rawEast);
    if (![west, south, east, north].every(Number.isFinite) || east <= west || north <= south) return undefined;
    return [west, clampLatitude(south), east, clampLatitude(north)];
  }
  const quad = unwrappedQuad(overlay);
  if (!quad) return undefined;
  const longitudes = quad.map((point) => point[0]);
  const latitudes = quad.map((point) => clampLatitude(point[1]));
  const extent: [number, number, number, number] = [Math.min(...longitudes), Math.min(...latitudes), Math.max(...longitudes), Math.max(...latitudes)];
  return extent[2] > extent[0] && extent[3] > extent[1] ? extent : undefined;
}

function mercatorY(latitude: number): number {
  const radians = clampLatitude(latitude) * Math.PI / 180;
  return (1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2;
}

function latitudeFromMercatorY(value: number): number {
  return Math.atan(Math.sinh(Math.PI * (1 - 2 * value))) * 180 / Math.PI;
}

function tileBounds(x: number, y: number, zoom: number): [number, number, number, number] {
  const count = 2 ** zoom;
  return [
    x / count * 360 - 180,
    latitudeFromMercatorY((y + 1) / count),
    (x + 1) / count * 360 - 180,
    latitudeFromMercatorY(y / count),
  ];
}

function requestBounds(x: number, y: number, zoom: number): [number, number, number, number] {
  const bounds = tileBounds(x, y, zoom);
  // TileJSON bounds are geographic coverage, not a tile identifier. Keep them
  // just inside the canonical tile so inclusive edge rounding cannot make a
  // one-image source repeat into an adjacent tile.
  const longitudeInset = Math.max(1e-10, (bounds[2] - bounds[0]) * 1e-9);
  const latitudeInset = Math.max(1e-10, (bounds[3] - bounds[1]) * 1e-9);
  return [bounds[0] + longitudeInset, bounds[1] + latitudeInset, bounds[2] - longitudeInset, bounds[3] - latitudeInset];
}

function tileRange(extent: [number, number, number, number], zoom: number): { minX: number; maxX: number; minY: number; maxY: number } {
  const [west, south, east, north] = extent;
  const count = 2 ** zoom;
  const minX = Math.floor((west + 180) / 360 * count);
  const maxX = Math.ceil((east + 180) / 360 * count) - 1;
  const minY = Math.max(0, Math.floor(mercatorY(north) * count));
  const maxY = Math.min(count - 1, Math.ceil(mercatorY(south) * count) - 1);
  return { minX, maxX, minY, maxY };
}

function rangeTileCount(range: ReturnType<typeof tileRange>): number {
  return Math.max(0, range.maxX - range.minX + 1) * Math.max(0, range.maxY - range.minY + 1);
}

function chooseTargetZoom(extent: [number, number, number, number], imageWidth: number, imageHeight: number, tileSize: number): number {
  const longitudeSpan = extent[2] - extent[0];
  const mercatorSpan = Math.max(Number.EPSILON, mercatorY(extent[1]) - mercatorY(extent[3]));
  const worldPixelsForWidth = imageWidth * 360 / longitudeSpan;
  const worldPixelsForHeight = imageHeight / mercatorSpan;
  let zoom = Math.max(0, Math.min(MAX_TARGET_ZOOM, Math.ceil(Math.log2(Math.max(worldPixelsForWidth, worldPixelsForHeight) / tileSize))));
  while (zoom > 0 && rangeTileCount(tileRange(extent, zoom)) > MAX_TARGET_TILES) zoom -= 1;
  return zoom;
}

export function planRasterTilePyramid(
  overlay: GroundOverlay,
  imageWidth: number,
  imageHeight: number,
  tileSize = DEFAULT_TILE_SIZE,
): { targetZoom: number; tiles: RasterTilePlan[] } {
  const extent = overlayExtent(overlay);
  if (!extent || imageWidth <= 0 || imageHeight <= 0 || tileSize <= 0) return { targetZoom: 0, tiles: [] };
  const targetZoom = chooseTargetZoom(extent, imageWidth, imageHeight, tileSize);
  const tiles: RasterTilePlan[] = [];
  for (let zoom = 0; zoom <= targetZoom; zoom += 1) {
    const count = 2 ** zoom;
    const range = tileRange(extent, zoom);
    for (let y = range.minY; y <= range.maxY; y += 1) {
      for (let rawX = range.minX; rawX <= range.maxX; rawX += 1) {
        const x = ((rawX % count) + count) % count;
        tiles.push({ z: zoom, x, y, rawX, bounds: requestBounds(x, y, zoom) });
      }
    }
  }
  return { targetZoom, tiles };
}

function axisAlignedUv(overlay: GroundOverlay, longitude: number, latitude: number): [number, number] | undefined {
  if (!overlay.bounds || overlay.rotation !== 0) return undefined;
  const [west, south, rawEast, north] = overlay.bounds;
  const east = unwrapEast(west, rawEast);
  let adjustedLongitude = longitude;
  const center = (west + east) / 2;
  while (adjustedLongitude - center > 180) adjustedLongitude -= 360;
  while (adjustedLongitude - center < -180) adjustedLongitude += 360;
  return [(adjustedLongitude - west) / (east - west), (north - latitude) / (north - south)];
}

function interpolateQuad(quad: Quad, u: number, v: number): [number, number] {
  const topX = quad[0][0] + (quad[1][0] - quad[0][0]) * u;
  const topY = quad[0][1] + (quad[1][1] - quad[0][1]) * u;
  const bottomX = quad[3][0] + (quad[2][0] - quad[3][0]) * u;
  const bottomY = quad[3][1] + (quad[2][1] - quad[3][1]) * u;
  return [topX + (bottomX - topX) * v, topY + (bottomY - topY) * v];
}

function inverseQuadUv(quad: Quad, longitude: number, latitude: number): [number, number] | undefined {
  const xs = quad.map((point) => point[0]);
  const ys = quad.map((point) => point[1]);
  let adjustedLongitude = longitude;
  const center = (Math.min(...xs) + Math.max(...xs)) / 2;
  while (adjustedLongitude - center > 180) adjustedLongitude -= 360;
  while (adjustedLongitude - center < -180) adjustedLongitude += 360;
  let u = (adjustedLongitude - Math.min(...xs)) / Math.max(Number.EPSILON, Math.max(...xs) - Math.min(...xs));
  let v = (Math.max(...ys) - latitude) / Math.max(Number.EPSILON, Math.max(...ys) - Math.min(...ys));
  for (let iteration = 0; iteration < 6; iteration += 1) {
    const point = interpolateQuad(quad, u, v);
    const epsilon = 1e-5;
    const pointU = interpolateQuad(quad, u + epsilon, v);
    const pointV = interpolateQuad(quad, u, v + epsilon);
    const errorX = point[0] - adjustedLongitude;
    const errorY = point[1] - latitude;
    const duX = (pointU[0] - point[0]) / epsilon;
    const duY = (pointU[1] - point[1]) / epsilon;
    const dvX = (pointV[0] - point[0]) / epsilon;
    const dvY = (pointV[1] - point[1]) / epsilon;
    const determinant = duX * dvY - dvX * duY;
    if (Math.abs(determinant) < 1e-12) return undefined;
    u -= (errorX * dvY - errorY * dvX) / determinant;
    v -= (duX * errorY - duY * errorX) / determinant;
  }
  return Number.isFinite(u) && Number.isFinite(v) ? [u, v] : undefined;
}

function sourceUv(overlay: GroundOverlay, quad: Quad | undefined, longitude: number, latitude: number): [number, number] | undefined {
  return axisAlignedUv(overlay, longitude, latitude) ?? (quad ? inverseQuadUv(quad, longitude, latitude) : undefined);
}

export async function materializeRasterTilePyramid(
  overlay: GroundOverlay,
  loadImage: (url: string) => Promise<ImageBitmap | HTMLImageElement | undefined>,
  tileSize = DEFAULT_TILE_SIZE,
): Promise<RasterTilePyramid> {
  const extent = overlayExtent(overlay);
  const bounds: [number, number, number, number] = extent && extent[0] >= -180 && extent[2] <= 180
    ? extent
    : [-180, extent?.[1] ?? -MAX_MERCATOR_LATITUDE, 180, extent?.[3] ?? MAX_MERCATOR_LATITUDE];
  if (!overlay.imageUrl) return { tileSize, targetZoom: 0, bounds, tiles: [] };
  const image = await loadImage(overlay.imageUrl);
  if (!image || image.width <= 0 || image.height <= 0) throw new Error("the overlay image could not be decoded for raster conversion");
  const plan = planRasterTilePyramid(overlay, image.width, image.height, tileSize);
  if (!plan.tiles.length) return { tileSize, targetZoom: plan.targetZoom, bounds, tiles: [] };

  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = image.width;
  sourceCanvas.height = image.height;
  const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
  if (!sourceContext) throw new Error("the browser could not create a source canvas for raster conversion");
  sourceContext.drawImage(image, 0, 0);
  const source = sourceContext.getImageData(0, 0, image.width, image.height).data;
  const quad = overlay.rotation !== 0 || !overlay.bounds ? unwrappedQuad(overlay) : undefined;
  const tiles: RenderableRasterTile[] = [];

  for (const tile of plan.tiles) {
    const canvas = document.createElement("canvas");
    canvas.width = tileSize;
    canvas.height = tileSize;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("the browser could not create an XYZ tile canvas");
    const output = context.createImageData(tileSize, tileSize);
    let hasVisiblePixel = false;
    const count = 2 ** tile.z;
    for (let pixelY = 0; pixelY < tileSize; pixelY += 1) {
      const latitude = latitudeFromMercatorY((tile.y + (pixelY + 0.5) / tileSize) / count);
      for (let pixelX = 0; pixelX < tileSize; pixelX += 1) {
        const longitude = (tile.rawX + (pixelX + 0.5) / tileSize) / count * 360 - 180;
        const uv = sourceUv(overlay, quad, longitude, latitude);
        if (!uv || uv[0] < 0 || uv[0] > 1 || uv[1] < 0 || uv[1] > 1) continue;
        const sourceX = Math.min(image.width - 1, Math.max(0, Math.floor(uv[0] * image.width)));
        const sourceY = Math.min(image.height - 1, Math.max(0, Math.floor(uv[1] * image.height)));
        const sourceIndex = (sourceY * image.width + sourceX) * 4;
        const targetIndex = (pixelY * tileSize + pixelX) * 4;
        output.data[targetIndex] = source[sourceIndex] ?? 0;
        output.data[targetIndex + 1] = source[sourceIndex + 1] ?? 0;
        output.data[targetIndex + 2] = source[sourceIndex + 2] ?? 0;
        output.data[targetIndex + 3] = source[sourceIndex + 3] ?? 0;
        if ((source[sourceIndex + 3] ?? 0) > 0) hasVisiblePixel = true;
      }
    }
    if (!hasVisiblePixel) continue;
    context.putImageData(output, 0, 0);
    tiles.push({ ...tile, imageUrl: canvas.toDataURL("image/png") });
  }
  return { tileSize, targetZoom: plan.targetZoom, bounds, tiles };
}
