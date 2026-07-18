import type { Feature, FeatureCollection, Geometry, GeometryCollection, Position } from "geojson";
import type { GeoLibreAppAPI, MapLike } from "./host-api";
import { registerKmlFeatureInfo, showKmlFeatureInfo } from "./featureInfo";
import { boundsOfGeometry } from "./geometry";
import type { ImportWarning, KmlFeatureProperties, KmlStyle, ParsedKml } from "./types";

let importSequence = 0;

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "layer";
}

function groupFeatures(features: Feature<Geometry, KmlFeatureProperties>[]): Map<string, Feature<Geometry, KmlFeatureProperties>[]> {
  return new Map([["Features", features]]);
}

async function loadImage(dataUrl: string): Promise<ImageBitmap | HTMLImageElement | undefined> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(await (await fetch(dataUrl)).blob());
    } catch {
      // Tauri deployments can block fetch(data:), while an HTMLImageElement
      // can still decode that same archive-resolved URL.
    }
  }
  try {
    const image = new Image();
    image.src = dataUrl;
    await image.decode();
    return image;
  } catch {
    return undefined;
  }
}

async function dominantImageColor(href: string | undefined): Promise<string | undefined> {
  if (!href) return undefined;
  const image = await loadImage(href);
  if (!image) return undefined;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.min(128, image.width));
    canvas.height = Math.max(1, Math.min(128, image.height));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return undefined;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let red = 0;
    let green = 0;
    let blue = 0;
    let totalWeight = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const r = pixels[index] ?? 0;
      const g = pixels[index + 1] ?? 0;
      const b = pixels[index + 2] ?? 0;
      const alpha = pixels[index + 3] ?? 0;
      if (alpha < 32) continue;
      const chroma = Math.max(r, g, b) - Math.min(r, g, b);
      const weight = (alpha / 255) * (1 + chroma / 255);
      red += r * weight;
      green += g * weight;
      blue += b * weight;
      totalWeight += weight;
    }
    if (!totalWeight) return undefined;
    return `#${[red, green, blue].map((value) => Math.round(value / totalWeight).toString(16).padStart(2, "0")).join("")}`;
  } catch {
    return undefined;
  }
}

type RgbaColor = [number, number, number, number];

function rgbaColor(hex: string | undefined, opacity = 1, fallback = "#e5df67"): RgbaColor {
  const normalized = /^#[0-9a-f]{6}$/i.test(hex ?? "") ? hex! : fallback;
  return [
    Number.parseInt(normalized.slice(1, 3), 16),
    Number.parseInt(normalized.slice(3, 5), 16),
    Number.parseInt(normalized.slice(5, 7), 16),
    Math.round(Math.max(0, Math.min(1, opacity)) * 255),
  ];
}

const DOT_ICON_SIZE = 64;
const DOT_ICON_ATLAS = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${DOT_ICON_SIZE}" height="${DOT_ICON_SIZE}" viewBox="0 0 ${DOT_ICON_SIZE} ${DOT_ICON_SIZE}"><circle cx="32" cy="32" r="29" fill="white" stroke="white" stroke-width="2"/></svg>`,
)}`;
const DOT_ICON_MAPPING = {
  dot: { x: 0, y: 0, width: DOT_ICON_SIZE, height: DOT_ICON_SIZE, anchorX: 32, anchorY: 32, mask: true },
};

function geometryHasAltitude(geometry: Geometry): boolean {
  if (geometry.type === "GeometryCollection") return geometry.geometries.some(geometryHasAltitude);
  let found = false;
  const visit = (value: unknown): void => {
    if (found || !Array.isArray(value)) return;
    if (typeof value[0] === "number" && typeof value[1] === "number") {
      found = typeof value[2] === "number" && Number.isFinite(value[2]) && value[2] !== 0;
      return;
    }
    for (const child of value) visit(child);
  };
  visit(geometry.coordinates);
  return found;
}

interface PreparedFeature {
  feature: Feature<Geometry, Record<string, unknown>>;
  style: KmlStyle | undefined;
  state: Record<string, unknown>;
}

const PRIVATE_PROPERTIES = new Set(["descriptionFormat", "extendedData", "folderPath", "sourceFilename", "styleUrl"]);

function publicProperties(properties: KmlFeatureProperties): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (properties.name !== undefined) result.name = properties.name;
  for (const [key, value] of Object.entries(properties)) {
    if (key === "name" || key.startsWith("__") || PRIVATE_PROPERTIES.has(key) || value === undefined) continue;
    result[key] = value;
  }
  if (properties.folderPath) result.Folder = properties.folderPath;
  return result;
}

function prepareFeatures(features: Feature<Geometry, KmlFeatureProperties>[]): PreparedFeature[] {
  return features.map((feature, index) => {
    const style = feature.properties.__kmlStyle;
    return {
      feature: {
        ...feature,
        id: feature.id ?? index,
        properties: publicProperties(feature.properties),
      },
      style,
      state: {
        fillColor: style?.polyColor?.hex ?? "#3b82f6",
        fillOpacity: style?.fill === false ? 0 : style?.polyColor?.opacity ?? 0.35,
        lineColor: style?.lineColor?.hex ?? "#2563eb",
        lineOpacity: style?.lineColor?.opacity ?? 1,
        lineWidth: style?.lineWidth ?? 2,
        pointColor: style?.iconColor?.hex ?? "#e5df67",
        pointOpacity: style?.iconColor?.opacity ?? 0.9,
        pointRadius: Math.max(3, 6 * (style?.iconScale ?? 1)),
      },
    };
  });
}

async function native3dStyle(prepared: PreparedFeature[]): Promise<NonNullable<Parameters<NonNullable<GeoLibreAppAPI["registerExternalNativeLayer"]>>[0]["style"]>> {
  const point = prepared.find((item) => ["Point", "MultiPoint"].includes(item.feature.geometry.type));
  const line = prepared.find((item) => ["LineString", "MultiLineString"].includes(item.feature.geometry.type));
  const pointColor = point?.style?.iconColor?.hex ?? await dominantImageColor(point?.style?.iconHref) ?? "#e5df67";
  return {
    fillColor: pointColor,
    fillOpacity: point?.style?.iconColor?.opacity ?? 0.95,
    strokeColor: line?.style?.lineColor?.hex ?? pointColor,
    strokeWidth: line?.style?.lineWidth ?? 1,
    circleRadius: Math.max(3, 6 * (point?.style?.iconScale ?? 1)),
    elevation3dEnabled: true,
    elevation3dVerticalScale: 1,
    elevation3dOffset: 0,
  };
}

interface DeckPointDatum {
  position: [number, number, number];
  properties: Record<string, unknown>;
  color: RgbaColor;
  size: number;
}

interface DeckPickingInfo {
  x?: number;
  y?: number;
  object?: { properties?: Record<string, unknown> };
}

function terrainElevation(map: MapLike, longitude: number, latitude: number): number {
  const elevation = map.queryTerrainElevation?.([longitude, latitude], { exaggerated: false });
  return Number.isFinite(elevation) ? elevation! : 0;
}

function deckPosition(position: Position, altitudeMode: unknown, map: MapLike): Position {
  const [longitude = 0, latitude = 0, altitude = 0] = position;
  const ground = terrainElevation(map, longitude, latitude);
  if (altitudeMode === "absolute") return [longitude, latitude, Number.isFinite(altitude) ? altitude : 0];
  if (altitudeMode === "relativeToGround" || altitudeMode === "relativeToSeaFloor") {
    return [longitude, latitude, ground + (Number.isFinite(altitude) ? altitude : 0)];
  }
  return [longitude, latitude, ground];
}

function geometryForDeck(geometry: Geometry, altitudeMode: unknown, map: MapLike): Geometry {
  if (geometry.type === "GeometryCollection") {
    return { ...geometry, geometries: geometry.geometries.map((child) => geometryForDeck(child, altitudeMode, map)) };
  }
  const transform = (value: unknown): unknown => {
    if (!Array.isArray(value)) return value;
    if (typeof value[0] === "number" && typeof value[1] === "number") return deckPosition(value as Position, altitudeMode, map);
    return value.map(transform);
  };
  return { ...geometry, coordinates: transform(geometry.coordinates) } as Geometry;
}

function pointExtrusionGeometry(geometry: Geometry, map: MapLike): Geometry | null {
  const lines: Position[][] = [];
  const collect = (item: Geometry): void => {
    if (item.type === "Point") {
      const [longitude = 0, latitude = 0, altitude = 0] = item.coordinates;
      const ground = terrainElevation(map, longitude, latitude);
      if (altitude !== ground) lines.push([[longitude, latitude, ground], [longitude, latitude, altitude]]);
    } else if (item.type === "MultiPoint") {
      for (const coordinates of item.coordinates) collect({ type: "Point", coordinates });
    } else if (item.type === "GeometryCollection") {
      for (const child of item.geometries) collect(child);
    }
  };
  collect(geometry);
  if (!lines.length) return null;
  return lines.length === 1 ? { type: "LineString", coordinates: lines[0]! } : { type: "MultiLineString", coordinates: lines };
}

function geometryWithoutPoints(geometry: Geometry): Geometry | null {
  if (geometry.type === "Point" || geometry.type === "MultiPoint") return null;
  if (geometry.type !== "GeometryCollection") return geometry;
  const geometries = geometry.geometries
    .map(geometryWithoutPoints)
    .filter((item): item is Geometry => item !== null);
  if (!geometries.length) return null;
  if (geometries.length === 1) return geometries[0]!;
  return { type: "GeometryCollection", geometries } satisfies GeometryCollection;
}

function addDeckPoints(
  geometry: Geometry,
  properties: Record<string, unknown>,
  color: RgbaColor,
  size: number,
  result: DeckPointDatum[],
): void {
  const addPosition = (position: Position): void => {
    const [longitude = 0, latitude = 0, altitude = 0] = position;
    result.push({
      position: [longitude, latitude, Number.isFinite(altitude) ? altitude : 0],
      properties,
      color,
      size,
    });
  };
  if (geometry.type === "Point") addPosition(geometry.coordinates);
  else if (geometry.type === "MultiPoint") geometry.coordinates.forEach(addPosition);
  else if (geometry.type === "GeometryCollection") {
    for (const child of geometry.geometries) addDeckPoints(child, properties, color, size, result);
  }
}

function showDeckFeatureInfo(map: MapLike, info: DeckPickingInfo, sourceFilename: string): boolean {
  const properties = info.object?.properties;
  if (!properties || !Number.isFinite(info.x) || !Number.isFinite(info.y)) return false;
  showKmlFeatureInfo(map, { x: info.x!, y: info.y! }, properties, sourceFilename);
  return true;
}

async function addDeck3dLayers(
  app: GeoLibreAppAPI,
  map: MapLike,
  id: string,
  prepared: PreparedFeature[],
  sourceFilename: string,
): Promise<string[]> {
  const deckGL = await app.getDeckGL!();
  const stylesById = new Map(prepared.map((item) => [item.feature.id, item.style]));
  const nonPointFeatures: Array<Feature<Geometry, Record<string, unknown>>> = [];
  const pointData: DeckPointDatum[] = [];
  const imageColors = new Map<string, string | undefined>();
  const imageHrefs = new Set(
    prepared
      .filter((item) => !item.style?.iconColor?.hex && item.style?.iconHref)
      .map((item) => item.style!.iconHref!),
  );
  await Promise.all([...imageHrefs].map(async (href) => {
    imageColors.set(href, await dominantImageColor(href));
  }));

  for (const item of prepared) {
    const deckGeometry = geometryForDeck(item.feature.geometry, item.feature.properties.altitudeMode, map);
    const nonPointGeometry = geometryWithoutPoints(deckGeometry);
    if (nonPointGeometry) nonPointFeatures.push({ ...item.feature, geometry: nonPointGeometry });
    if (item.feature.properties.extrude === true) {
      const extrusion = pointExtrusionGeometry(deckGeometry, map);
      if (extrusion) nonPointFeatures.push({ ...item.feature, geometry: extrusion });
    }
    let pointHex = item.style?.iconColor?.hex;
    if (!pointHex && item.style?.iconHref) {
      pointHex = imageColors.get(item.style.iconHref);
    }
    addDeckPoints(
      deckGeometry,
      item.feature.properties,
      rgbaColor(pointHex, item.style?.iconColor?.opacity ?? 0.95),
      Math.max(4, 12 * (item.style?.iconScale ?? 1)),
      pointData,
    );
  }

  const layerIds: string[] = [];
  const styleOf = (feature: unknown): KmlStyle | undefined => {
    const featureId = (feature as { id?: string | number } | undefined)?.id;
    return stylesById.get(featureId);
  };
  if (nonPointFeatures.length) {
    const layerId = `${id}-3d-geometry`;
    const layer = new deckGL.mapbox.MapboxLayer({
      id: layerId,
      type: deckGL.layers.GeoJsonLayer,
      data: { type: "FeatureCollection", features: nonPointFeatures },
      filled: true,
      stroked: true,
      extruded: false,
      getFillColor: (feature: unknown) => {
        const style = styleOf(feature);
        return rgbaColor(style?.polyColor?.hex, style?.fill === false ? 0 : style?.polyColor?.opacity ?? 0.35, "#3b82f6");
      },
      getLineColor: (feature: unknown) => {
        const style = styleOf(feature);
        return rgbaColor(style?.lineColor?.hex, style?.lineColor?.opacity ?? 1, "#2563eb");
      },
      getLineWidth: (feature: unknown) => styleOf(feature)?.lineWidth ?? 2,
      lineWidthUnits: "pixels",
      lineWidthMinPixels: 1,
      lineBillboard: true,
      pickable: true,
      autoHighlight: true,
      onClick: (info: DeckPickingInfo) => showDeckFeatureInfo(map, info, sourceFilename),
    });
    map.addLayer(layer);
    layerIds.push(layerId);
  }
  if (pointData.length) {
    const layerId = `${id}-3d-points`;
    const layer = new deckGL.mapbox.MapboxLayer({
      id: layerId,
      type: deckGL.layers.IconLayer,
      data: pointData,
      getPosition: (datum: DeckPointDatum) => datum.position,
      getIcon: () => "dot",
      iconAtlas: DOT_ICON_ATLAS,
      iconMapping: DOT_ICON_MAPPING,
      getSize: (datum: DeckPointDatum) => datum.size,
      getColor: (datum: DeckPointDatum) => datum.color,
      sizeUnits: "pixels",
      sizeMinPixels: 4,
      billboard: true,
      pickable: true,
      autoHighlight: true,
      onClick: (info: DeckPickingInfo) => showDeckFeatureInfo(map, info, sourceFilename),
    });
    map.addLayer(layer);
    layerIds.push(layerId);
  }
  return layerIds;
}

async function addStyledMapLayers(map: MapLike, id: string, prepared: PreparedFeature[], warnings: ImportWarning[]): Promise<{ layerIds: string[]; sourceIds: string[]; sourceId: string }> {
  const sourceId = `${id}-source`;
  const collection: FeatureCollection<Geometry, Record<string, unknown>> = { type: "FeatureCollection", features: prepared.map((item) => item.feature) };
  const layerIds: string[] = [];
  const sourceIds = [sourceId];
  map.addSource(sourceId, { type: "geojson", data: collection });
  const specs: Array<Record<string, unknown>> = [
    {
      id: `${id}-fill`, type: "fill", source: sourceId,
      filter: ["match", ["geometry-type"], ["Polygon", "MultiPolygon"], true, false],
      paint: {
        "fill-color": ["coalesce", ["feature-state", "fillColor"], "#3b82f6"],
        "fill-opacity": ["coalesce", ["feature-state", "fillOpacity"], 0.35],
      },
    },
    {
      id: `${id}-line`, type: "line", source: sourceId,
      filter: ["match", ["geometry-type"], ["LineString", "MultiLineString", "Polygon", "MultiPolygon"], true, false],
      paint: {
        "line-color": ["coalesce", ["feature-state", "lineColor"], "#2563eb"],
        "line-opacity": ["coalesce", ["feature-state", "lineOpacity"], 1],
        "line-width": ["coalesce", ["feature-state", "lineWidth"], 2],
      },
    },
    {
      id: `${id}-point`, type: "circle", source: sourceId,
      // Always draw a circle fallback. Remote icons may be blocked by CORS or
      // the Tauri CSP; hiding the circle made point-only KMZ files look empty.
      filter: ["match", ["geometry-type"], ["Point", "MultiPoint"], true, false],
      paint: {
        "circle-color": ["coalesce", ["feature-state", "pointColor"], "#e5df67"],
        "circle-opacity": ["coalesce", ["feature-state", "pointOpacity"], 0.9],
        "circle-radius": ["coalesce", ["feature-state", "pointRadius"], 6],
        "circle-stroke-color": "#ffffff", "circle-stroke-width": 1,
      },
    },
  ];
  for (const spec of specs) {
    map.addLayer(spec);
    layerIds.push(String(spec.id));
  }
  for (const item of prepared) {
    if (item.feature.id !== undefined) map.setFeatureState?.({ source: sourceId, id: item.feature.id }, item.state);
  }

  const iconGroups = new Map<string, { href: string; scale: number; heading: number; features: Array<Feature<Geometry, Record<string, unknown>>> }>();
  for (const item of prepared) {
    if (!item.style?.iconHref || !["Point", "MultiPoint"].includes(item.feature.geometry.type)) continue;
    const scale = item.style.iconScale ?? 1;
    const heading = item.style.iconHeading ?? 0;
    const key = `${item.style.iconHref}\0${scale}\0${heading}`;
    const group = iconGroups.get(key) ?? { href: item.style.iconHref, scale, heading, features: [] };
    group.features.push(item.feature);
    iconGroups.set(key, group);
  }
  const groups = [...iconGroups.values()].slice(0, 50);
  if (iconGroups.size > groups.length) warnings.push({ code: "partial-support", message: `Only the first ${groups.length} distinct marker styles were rendered; ${iconGroups.size - groups.length} additional styles use visible circle fallbacks.` });
  if (groups.length && (!map.addImage || !map.hasImage)) {
    warnings.push({ code: "partial-support", message: "Custom marker icons were resolved but this GeoLibre host cannot register MapLibre images; circle markers were used." });
  }
  let failedIcons = 0;
  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index]!;
    const imageId = `${id}-icon-${index}`;
    const image = await loadImage(group.href);
    if (!image || !map.addImage) {
      failedIcons += 1;
      continue;
    }
    if (!map.hasImage?.(imageId)) map.addImage(imageId, image);
    const iconSourceId = `${id}-icon-source-${index}`;
    map.addSource(iconSourceId, { type: "geojson", data: { type: "FeatureCollection", features: group.features } });
    sourceIds.push(iconSourceId);
    const layerId = `${id}-symbol-${index}`;
    map.addLayer({
      id: layerId, type: "symbol", source: iconSourceId,
      layout: {
        "icon-image": imageId,
        "icon-size": group.scale,
        "icon-allow-overlap": true,
        "icon-rotation-alignment": "map",
        "icon-rotate": group.heading,
      },
    });
    layerIds.push(layerId);
  }
  if (failedIcons) warnings.push({ code: "missing-asset", message: `${failedIcons} marker icon style${failedIcons === 1 ? "" : "s"} could not be decoded; visible circle fallbacks were used.`, count: failedIcons });
  return { layerIds, sourceIds, sourceId };
}

export interface AddToGeoLibreResult { layerIds: string[]; warnings: ImportWarning[] }

export interface AddToGeoLibreOptions { includeHiddenFeatures?: boolean }

export async function addParsedKmlToGeoLibre(app: GeoLibreAppAPI, parsed: ParsedKml, sourceFilename: string, options: AddToGeoLibreOptions = {}): Promise<AddToGeoLibreResult> {
  const warnings = [...parsed.warnings];
  const map = app.getMap?.() ?? null;
  const importedLayerIds: string[] = [];
  const prefix = `kml-${Date.now()}-${++importSequence}`;
  const allFeatures = parsed.featureCollection.features;
  const visibleFeatures = options.includeHiddenFeatures ? allFeatures : allFeatures.filter((feature) => feature.properties.__kmlVisible !== false);
  const hiddenCount = allFeatures.length - visibleFeatures.length;
  if (hiddenCount) warnings.push({
    code: "partial-support",
    message: `${hiddenCount.toLocaleString()} feature${hiddenCount === 1 ? " was" : "s were"} marked hidden by the KML and not drawn. Enable “Include features marked hidden” to import them too.`,
  });
  const native3d = Boolean(app.getDeckGL && app.registerExternalNativeLayer && visibleFeatures.some((feature) => geometryHasAltitude(feature.geometry)));
  const groups = groupFeatures(visibleFeatures);
  let groupIndex = 0;
  for (const [name, features] of groups) {
    const prepared = prepareFeatures(features);
    const collection: FeatureCollection<Geometry, Record<string, unknown>> = { type: "FeatureCollection", features: prepared.map((item) => item.feature) };
    const id = `${prefix}-${groupIndex++}-${slug(name)}`;
    if (native3d && app.registerExternalNativeLayer) {
      try {
        const nativeLayerIds = map ? await addDeck3dLayers(app, map, id, prepared, sourceFilename) : [];
        app.registerExternalNativeLayer({
          id, name: sourceFilename, type: "geojson", geojson: collection,
          nativeLayerIds, opacity: 1, style: await native3dStyle(prepared),
          metadata: {
            sourceKind: "kml-kmz-import-3d",
            controlOwnsPaint: nativeLayerIds.length > 0,
            kmlDocumentName: parsed.documentName,
            kmlFeatureCount: features.length,
            kmlAltitudeMode: "native-z",
          },
        });
        importedLayerIds.push(id);
        continue;
      } catch (error) {
        for (const suffix of ["3d-points", "3d-geometry"]) {
          const nativeId = `${id}-${suffix}`;
          if (map?.getLayer(nativeId)) map.removeLayer(nativeId);
        }
        warnings.push({ code: "partial-support", message: `GeoLibre's native 3D Z-value renderer could not register this file; flat styling was used (${error instanceof Error ? error.message : String(error)}).` });
      }
    }
    if (map && app.registerExternalNativeLayer) {
      try {
        const native = await addStyledMapLayers(map, id, prepared, warnings);
        app.registerExternalNativeLayer({
          id, name: sourceFilename, type: "geojson", geojson: collection,
          nativeLayerIds: native.layerIds, sourceIds: native.sourceIds, opacity: 1,
          metadata: { sourceKind: "kml-kmz-import", controlOwnsPaint: true, kmlDocumentName: parsed.documentName, kmlFeatureCount: features.length },
        });
        for (const item of prepared) {
          if (item.feature.id !== undefined) map.setFeatureState?.({ source: native.sourceId, id: item.feature.id }, item.state);
        }
        registerKmlFeatureInfo(map, native.layerIds, sourceFilename);
        importedLayerIds.push(id);
      } catch (error) {
        warnings.push({ code: "partial-support", message: `Styled layer creation failed; GeoLibre default styling was used (${error instanceof Error ? error.message : String(error)}).` });
        importedLayerIds.push(app.addGeoJsonLayer(sourceFilename, collection));
      }
    } else {
      importedLayerIds.push(app.addGeoJsonLayer(sourceFilename, collection));
      if (!app.registerExternalNativeLayer) warnings.push({ code: "partial-support", message: "This GeoLibre host does not expose styled external-layer registration; default vector styling was used." });
    }
  }
  const sortedOverlays = [...parsed.overlays].sort((a, b) => a.drawOrder - b.drawOrder);
  for (let index = 0; index < sortedOverlays.length; index += 1) {
    const overlay = sortedOverlays[index]!;
    if (!map || !overlay.imageUrl || !overlay.coordinates) {
      warnings.push({ code: "partial-support", message: `GroundOverlay “${overlay.name}” could not be rendered because the host lacks direct MapLibre image-source access or the image/bounds are invalid.` });
      continue;
    }
    const id = `${prefix}-overlay-${index}`;
    const sourceId = `${id}-source`;
    try {
      map.addSource(sourceId, { type: "image", url: overlay.imageUrl, coordinates: overlay.coordinates });
      map.addLayer({ id, type: "raster", source: sourceId, paint: { "raster-opacity": overlay.opacity } });
      app.registerExternalNativeLayer?.({
        id, name: `${sourceFilename} / ${overlay.name}`, type: "raster",
        source: { type: "image", url: overlay.imageUrl, coordinates: overlay.coordinates },
        nativeLayerIds: [id], sourceIds: [sourceId], opacity: overlay.opacity,
        metadata: { sourceKind: "kml-ground-overlay", controlOwnsPaint: true, rotation: overlay.rotation, drawOrder: overlay.drawOrder },
      });
      importedLayerIds.push(id);
    } catch (error) {
      warnings.push({ code: "partial-support", message: `GroundOverlay “${overlay.name}” could not be added: ${error instanceof Error ? error.message : String(error)}` });
    }
  }
  const bounds = visibleFeatures.map((feature) => boundsOfGeometry(feature.geometry)).filter((value): value is [number, number, number, number] => Boolean(value));
  for (const overlay of parsed.overlays) if (overlay.bounds) bounds.push(overlay.bounds);
  if (bounds.length) {
    const union = bounds.reduce<[number, number, number, number]>((total, item) => [Math.min(total[0], item[0]), Math.min(total[1], item[1]), Math.max(total[2], item[2]), Math.max(total[3], item[3])], [Infinity, Infinity, -Infinity, -Infinity]);
    app.fitBounds?.(union);
  }
  if (importedLayerIds.length > 1) {
    if (app.addLayerGroup) {
      app.addLayerGroup(sourceFilename, importedLayerIds);
    } else {
      warnings.push({
        code: "partial-support",
        message: `GeoLibre's external-plugin API cannot create layer groups yet. “${sourceFilename}” vector and overlay components remain adjacent in the Layers panel.`,
      });
    }
  }
  return { layerIds: importedLayerIds, warnings };
}
