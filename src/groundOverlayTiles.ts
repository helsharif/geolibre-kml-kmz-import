import type { GroundOverlay } from "./types";

type Quad = NonNullable<GroundOverlay["coordinates"]>;

export interface GroundOverlayTilePlan {
  coordinates: Quad;
  crop: { left: number; top: number; right: number; bottom: number };
}

export interface RenderableGroundOverlayTile {
  coordinates: Quad;
  imageUrl: string;
}

// MapLibre image sources are converted through Web Mercator even when the map
// is displayed as a globe. Finite corners keep one polar coordinate from
// invalidating an otherwise valid global image.
export const MERCATOR_MAX_LATITUDE = 85.0511287798066;
const MAX_TILE_SPAN_DEGREES = 30;

function clampLatitude(latitude: number): number {
  return Math.max(-MERCATOR_MAX_LATITUDE, Math.min(MERCATOR_MAX_LATITUDE, latitude));
}

function unwrapEast(west: number, east: number): number {
  let result = east;
  while (result < west) result += 360;
  return Math.min(result, west + 360);
}

function splitRange(start: number, end: number, forcedBreaks: number[] = []): number[] {
  const anchors = [start, ...forcedBreaks.filter((value) => value > start && value < end), end].sort((a, b) => a - b);
  const result: number[] = [start];
  for (let index = 1; index < anchors.length; index += 1) {
    const segmentStart = anchors[index - 1]!;
    const segmentEnd = anchors[index]!;
    const count = Math.max(1, Math.ceil((segmentEnd - segmentStart) / MAX_TILE_SPAN_DEGREES));
    for (let part = 1; part <= count; part += 1) result.push(segmentStart + (segmentEnd - segmentStart) * part / count);
  }
  return result;
}

function antimeridianBreaks(west: number, east: number): number[] {
  const result: number[] = [];
  const first = Math.ceil((west - 180) / 360);
  const last = Math.floor((east - 180) / 360);
  for (let world = first; world <= last; world += 1) result.push(180 + world * 360);
  return result;
}

function normalizedLongitudePair(west: number, east: number): [number, number] {
  const middle = (west + east) / 2;
  const world = Math.floor((middle + 180) / 360);
  return [west - world * 360, east - world * 360];
}

function axisAlignedTilePlan(overlay: GroundOverlay): GroundOverlayTilePlan[] | undefined {
  if (!overlay.bounds || overlay.rotation !== 0) return undefined;
  const [west, originalSouth, rawEast, originalNorth] = overlay.bounds;
  if (![west, originalSouth, rawEast, originalNorth].every(Number.isFinite) || originalNorth <= originalSouth) return [];
  const east = unwrapEast(west, rawEast);
  if (east <= west) return [];
  const south = clampLatitude(originalSouth);
  const north = clampLatitude(originalNorth);
  if (north <= south) return [];

  const longitudeCuts = splitRange(west, east, antimeridianBreaks(west, east));
  const latitudeCuts = splitRange(south, north);
  const longitudeSpan = east - west;
  const latitudeSpan = originalNorth - originalSouth;
  const plans: GroundOverlayTilePlan[] = [];

  for (let row = latitudeCuts.length - 1; row > 0; row -= 1) {
    const tileNorth = latitudeCuts[row]!;
    const tileSouth = latitudeCuts[row - 1]!;
    for (let column = 0; column < longitudeCuts.length - 1; column += 1) {
      const tileWest = longitudeCuts[column]!;
      const tileEast = longitudeCuts[column + 1]!;
      const [normalizedWest, normalizedEast] = normalizedLongitudePair(tileWest, tileEast);
      plans.push({
        coordinates: [[normalizedWest, tileNorth], [normalizedEast, tileNorth], [normalizedEast, tileSouth], [normalizedWest, tileSouth]],
        crop: {
          left: (tileWest - west) / longitudeSpan,
          top: (originalNorth - tileNorth) / latitudeSpan,
          right: (tileEast - west) / longitudeSpan,
          bottom: (originalNorth - tileSouth) / latitudeSpan,
        },
      });
    }
  }
  return plans;
}

function unwrapNear(longitude: number, reference: number): number {
  let result = longitude;
  while (result - reference > 180) result -= 360;
  while (result - reference < -180) result += 360;
  return result;
}

function interpolateQuad(quad: Quad, u: number, v: number): [number, number] {
  const topLongitude = quad[0][0] + (quad[1][0] - quad[0][0]) * u;
  const topLatitude = quad[0][1] + (quad[1][1] - quad[0][1]) * u;
  const bottomLongitude = quad[3][0] + (quad[2][0] - quad[3][0]) * u;
  const bottomLatitude = quad[3][1] + (quad[2][1] - quad[3][1]) * u;
  return [topLongitude + (bottomLongitude - topLongitude) * v, clampLatitude(topLatitude + (bottomLatitude - topLatitude) * v)];
}

function quadTilePlan(coordinates: Quad): GroundOverlayTilePlan[] {
  const unwrapped: Quad = [
    [...coordinates[0]],
    [unwrapNear(coordinates[1][0], coordinates[0][0]), coordinates[1][1]],
    [unwrapNear(coordinates[2][0], coordinates[0][0]), coordinates[2][1]],
    [unwrapNear(coordinates[3][0], coordinates[0][0]), coordinates[3][1]],
  ];
  const longitudeSpan = Math.max(Math.abs(unwrapped[1][0] - unwrapped[0][0]), Math.abs(unwrapped[2][0] - unwrapped[3][0]));
  const latitudeSpan = Math.max(Math.abs(unwrapped[3][1] - unwrapped[0][1]), Math.abs(unwrapped[2][1] - unwrapped[1][1]));
  const columns = Math.max(1, Math.ceil(longitudeSpan / MAX_TILE_SPAN_DEGREES));
  const rows = Math.max(1, Math.ceil(latitudeSpan / MAX_TILE_SPAN_DEGREES));
  const plans: GroundOverlayTilePlan[] = [];
  for (let row = 0; row < rows; row += 1) {
    const top = row / rows;
    const bottom = (row + 1) / rows;
    for (let column = 0; column < columns; column += 1) {
      const left = column / columns;
      const right = (column + 1) / columns;
      const corners: Quad = [
        interpolateQuad(unwrapped, left, top), interpolateQuad(unwrapped, right, top),
        interpolateQuad(unwrapped, right, bottom), interpolateQuad(unwrapped, left, bottom),
      ];
      const middle = corners.reduce((sum, point) => sum + point[0], 0) / 4;
      const world = Math.floor((middle + 180) / 360);
      for (const point of corners) point[0] -= world * 360;
      plans.push({ coordinates: corners, crop: { left, top, right, bottom } });
    }
  }
  return plans;
}

export function planGroundOverlayTiles(overlay: GroundOverlay): GroundOverlayTilePlan[] {
  const axisAligned = axisAlignedTilePlan(overlay);
  if (axisAligned) return axisAligned;
  return overlay.coordinates ? quadTilePlan(overlay.coordinates) : [];
}

function isUncropped(plan: GroundOverlayTilePlan): boolean {
  const { left, top, right, bottom } = plan.crop;
  return left === 0 && top === 0 && right === 1 && bottom === 1;
}

export async function materializeGroundOverlayTiles(
  overlay: GroundOverlay,
  loadImage: (url: string) => Promise<ImageBitmap | HTMLImageElement | undefined>,
): Promise<RenderableGroundOverlayTile[]> {
  if (!overlay.imageUrl) return [];
  const plans = planGroundOverlayTiles(overlay);
  if (plans.length === 1 && isUncropped(plans[0]!)) return [{ coordinates: plans[0]!.coordinates, imageUrl: overlay.imageUrl }];
  if (!plans.length) return [];

  const image = await loadImage(overlay.imageUrl);
  if (!image) throw new Error("the overlay image could not be decoded for globe-safe tiling");
  const tiles: RenderableGroundOverlayTile[] = [];
  for (const plan of plans) {
    const sourceX = Math.max(0, Math.min(image.width - 1, Math.floor(plan.crop.left * image.width)));
    const sourceY = Math.max(0, Math.min(image.height - 1, Math.floor(plan.crop.top * image.height)));
    const sourceRight = Math.max(sourceX + 1, Math.min(image.width, Math.ceil(plan.crop.right * image.width)));
    const sourceBottom = Math.max(sourceY + 1, Math.min(image.height, Math.ceil(plan.crop.bottom * image.height)));
    const width = sourceRight - sourceX;
    const height = sourceBottom - sourceY;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("the browser could not create an image canvas for globe-safe tiling");
    context.drawImage(image, sourceX, sourceY, width, height, 0, 0, width, height);
    tiles.push({ coordinates: plan.coordinates, imageUrl: canvas.toDataURL("image/png") });
  }
  return tiles;
}
