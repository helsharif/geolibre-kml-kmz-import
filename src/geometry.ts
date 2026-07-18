import type { Geometry, LineString, MultiLineString, MultiPoint, MultiPolygon, Point, Polygon, Position } from "geojson";
import type { ImportWarning } from "./types";
import { childrenNamed, firstChild, localName, textOf } from "./xml";

export function parseCoordinateTuple(tuple: string): Position | undefined {
  const values = tuple.trim().split(",").map(Number);
  if (values.length < 2 || values.some((value) => !Number.isFinite(value))) return undefined;
  const [longitude, latitude, altitude] = values;
  if (longitude === undefined || latitude === undefined) return undefined;
  return altitude === undefined ? [longitude, latitude] : [longitude, latitude, altitude];
}

export function parseCoordinates(text?: string): Position[] {
  if (!text) return [];
  return text.trim().split(/\s+/).map(parseCoordinateTuple).filter((coordinate): coordinate is Position => Boolean(coordinate));
}

const ALTITUDE_MODES = new Set(["clampToGround", "relativeToGround", "absolute", "clampToSeaFloor", "relativeToSeaFloor"]);

type GeometryParseResult = Omit<ParsedGeometry, "geometry"> & { geometry?: Geometry };

function normalizedPosition(position: Position, mode: string | undefined, offset: number): Position {
  const [longitude, latitude, rawAltitude] = position;
  if (longitude === undefined || latitude === undefined) return position;
  const effectiveMode = ALTITUDE_MODES.has(mode ?? "") ? mode : "clampToGround";
  const hasAltitude = rawAltitude !== undefined;
  if (effectiveMode === "clampToGround" || effectiveMode === "clampToSeaFloor") {
    if (!hasAltitude || rawAltitude === 0) return position;
    return [longitude, latitude, 0];
  }
  if (offset === 0 && (rawAltitude === undefined || Number.isFinite(rawAltitude))) return position;
  const altitude = (Number.isFinite(rawAltitude) ? rawAltitude! : 0) + offset;
  return hasAltitude || offset !== 0 ? [longitude, latitude, altitude] : [longitude, latitude];
}

function geometryMetadata(element: Element): Pick<ParsedGeometry, "altitudeMode" | "altitudeOffset" | "extrude" | "tessellate"> {
  const metadata: Pick<ParsedGeometry, "altitudeMode" | "altitudeOffset" | "extrude" | "tessellate"> = {};
  for (const child of Array.from(element.children)) {
    const name = localName(child);
    if (!["altitudeMode", "altitudeOffset", "extrude", "tessellate"].includes(name)) continue;
    const value = child.textContent?.trim();
    if (!value) continue;
    if (name === "altitudeMode") metadata.altitudeMode = value;
    else if (name === "altitudeOffset") {
      const offset = Number(value);
      if (Number.isFinite(offset)) metadata.altitudeOffset = offset;
    } else if (name === "extrude") metadata.extrude = value === "1" || value.toLowerCase() === "true";
    else if (name === "tessellate") metadata.tessellate = value === "1" || value.toLowerCase() === "true";
  }
  return metadata;
}

function point(element: Element): GeometryParseResult {
  const coordinate = parseCoordinates(textOf(element, "coordinates"))[0];
  const metadata = geometryMetadata(element);
  return { geometry: coordinate ? { type: "Point", coordinates: normalizedPosition(coordinate, metadata.altitudeMode, metadata.altitudeOffset ?? 0) } : undefined, ...metadata };
}

function lineString(element: Element): GeometryParseResult {
  const metadata = geometryMetadata(element);
  const coordinates = parseCoordinates(textOf(element, "coordinates")).map((position) => normalizedPosition(position, metadata.altitudeMode, metadata.altitudeOffset ?? 0));
  return { geometry: coordinates.length >= 2 ? { type: "LineString", coordinates } : undefined, ...metadata };
}

function polygon(element: Element): GeometryParseResult {
  const metadata = geometryMetadata(element);
  const outer = firstChild(element, "outerBoundaryIs");
  const outerRing = outer ? firstChild(outer, "LinearRing") : undefined;
  const exterior = outerRing ? parseCoordinates(textOf(outerRing, "coordinates")).map((position) => normalizedPosition(position, metadata.altitudeMode, metadata.altitudeOffset ?? 0)) : [];
  if (exterior.length < 4) return metadata;
  const holes = childrenNamed(element, "innerBoundaryIs")
    .map((boundary) => firstChild(boundary, "LinearRing"))
    .filter((ring): ring is Element => Boolean(ring))
    .map((ring) => parseCoordinates(textOf(ring, "coordinates")).map((position) => normalizedPosition(position, metadata.altitudeMode, metadata.altitudeOffset ?? 0)))
    .filter((ring) => ring.length >= 4);
  return { geometry: { type: "Polygon", coordinates: [exterior, ...holes] }, ...metadata };
}

function track(element: Element): GeometryParseResult {
  const metadata = geometryMetadata(element);
  const coordinates = childrenNamed(element, "coord")
    .map((item) => item.textContent?.trim().split(/\s+/).map(Number) ?? [])
    .filter((values) => values.length >= 2 && values.every(Number.isFinite))
    .map((values) => normalizedPosition(values as Position, metadata.altitudeMode, metadata.altitudeOffset ?? 0));
  const trackWhen = childrenNamed(element, "when").map((item) => item.textContent?.trim() ?? "");
  return {
    geometry: coordinates.length >= 2 ? { type: "LineString", coordinates } : undefined,
    ...metadata,
    trackWhen,
  };
}

export interface ParsedGeometry {
  geometry: Geometry;
  altitudeMode?: string;
  altitudeOffset?: number;
  extrude?: boolean;
  tessellate?: boolean;
  trackWhen?: string[];
}

export function parseGeometryElements(parent: Element, warnings: ImportWarning[]): ParsedGeometry[] {
  const parsed: ParsedGeometry[] = [];
  const visit = (element: Element): void => {
    const name = localName(element);
    if (name === "MultiGeometry" || name === "MultiTrack") {
      for (const child of Array.from(element.children)) visit(child);
      return;
    }
    let result: GeometryParseResult | undefined;
    if (name === "Point") result = point(element);
    if (name === "LineString") result = lineString(element);
    if (name === "Polygon") result = polygon(element);
    if (name === "Track") result = track(element);
    if (!result) return;
    if (result.altitudeMode && !ALTITUDE_MODES.has(result.altitudeMode)) {
      warnings.push({ code: "partial-support", message: `Unknown altitudeMode “${result.altitudeMode}” was treated as clampToGround.` });
    }
    if (result.geometry) parsed.push(result as ParsedGeometry);
    else warnings.push({ code: "invalid-geometry", message: `A malformed ${name} geometry was skipped.` });
  };

  for (const child of Array.from(parent.children)) visit(child);
  return parsed;
}

export function combineLikeGeometries(geometries: ParsedGeometry[]): ParsedGeometry[] {
  if (geometries.length < 2) return geometries;
  // Each gx:Track owns an ordered timestamp array. Keeping tracks as sibling
  // features preserves that one-to-one association in gx:MultiTrack.
  if (geometries.some((entry) => entry.trackWhen)) return geometries;
  const types = new Set(geometries.map((entry) => entry.geometry.type));
  if (types.size !== 1) return geometries;
  const metadataSignatures = new Set(geometries.map((entry) => JSON.stringify([
    entry.altitudeMode,
    entry.altitudeOffset,
    entry.extrude,
    entry.tessellate,
  ])));
  if (metadataSignatures.size !== 1) return geometries;
  const metadata = geometries.find((entry) => entry.altitudeMode || entry.altitudeOffset !== undefined || entry.extrude !== undefined || entry.tessellate !== undefined);
  const common = metadata ? {
    altitudeMode: metadata.altitudeMode,
    altitudeOffset: metadata.altitudeOffset,
    extrude: metadata.extrude,
    tessellate: metadata.tessellate,
  } : {};
  const type = geometries[0]?.geometry.type;
  if (type === "Point") {
    return [{ geometry: { type: "MultiPoint", coordinates: geometries.map((entry) => (entry.geometry as Point).coordinates) } as MultiPoint, ...common }];
  }
  if (type === "LineString") {
    return [{ geometry: { type: "MultiLineString", coordinates: geometries.map((entry) => (entry.geometry as LineString).coordinates) } as MultiLineString, ...common }];
  }
  if (type === "Polygon") {
    return [{ geometry: { type: "MultiPolygon", coordinates: geometries.map((entry) => (entry.geometry as Polygon).coordinates) } as MultiPolygon, ...common }];
  }
  return geometries;
}

export function countGeometry(geometry: Geometry): { points: number; lines: number; polygons: number } {
  switch (geometry.type) {
    case "Point":
    case "MultiPoint": return { points: geometry.type === "Point" ? 1 : geometry.coordinates.length, lines: 0, polygons: 0 };
    case "LineString":
    case "MultiLineString": return { points: 0, lines: geometry.type === "LineString" ? 1 : geometry.coordinates.length, polygons: 0 };
    case "Polygon":
    case "MultiPolygon": return { points: 0, lines: 0, polygons: geometry.type === "Polygon" ? 1 : geometry.coordinates.length };
    case "GeometryCollection": return geometry.geometries.reduce((total, item) => {
      const count = countGeometry(item);
      return { points: total.points + count.points, lines: total.lines + count.lines, polygons: total.polygons + count.polygons };
    }, { points: 0, lines: 0, polygons: 0 });
  }
}

export function boundsOfGeometry(geometry: Geometry): [number, number, number, number] | undefined {
  const positions: Position[] = [];
  const collect = (value: unknown): void => {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === "number" && typeof value[1] === "number") positions.push(value as Position);
    else for (const child of value) collect(child);
  };
  if (geometry.type === "GeometryCollection") geometry.geometries.forEach((item) => {
    const bounds = boundsOfGeometry(item);
    if (bounds) positions.push([bounds[0], bounds[1]], [bounds[2], bounds[3]]);
  });
  else collect(geometry.coordinates);
  if (positions.length === 0) return undefined;
  return positions.reduce<[number, number, number, number]>((bounds, position) => [
    Math.min(bounds[0], position[0] ?? bounds[0]), Math.min(bounds[1], position[1] ?? bounds[1]),
    Math.max(bounds[2], position[0] ?? bounds[2]), Math.max(bounds[3], position[1] ?? bounds[3]),
  ], [Infinity, Infinity, -Infinity, -Infinity]);
}
