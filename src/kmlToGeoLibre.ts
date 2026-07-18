import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { GeoLibreAppAPI, MapLike } from "./host-api";
import { registerKmlFeatureInfo } from "./featureInfo";
import { boundsOfGeometry } from "./geometry";
import type { ImportWarning, KmlFeatureProperties, KmlStyle, ParsedKml } from "./types";

let importSequence = 0;

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "layer";
}

function groupFeatures(parsed: ParsedKml, features: Feature<Geometry, KmlFeatureProperties>[], preserveFolders: boolean): Map<string, Feature<Geometry, KmlFeatureProperties>[]> {
  if (!preserveFolders) return new Map([["Features", features]]);
  const groups = new Map<string, Feature<Geometry, KmlFeatureProperties>[]>();
  for (const feature of features) {
    const path = feature.properties.folderPath;
    const leaf = path.split(" / ").at(-1);
    const name = !leaf || path === parsed.documentName ? "Features" : leaf;
    const grouped = groups.get(name) ?? [];
    grouped.push(feature);
    groups.set(name, grouped);
  }
  return groups;
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
  const groups = groupFeatures(parsed, visibleFeatures, native3d);
  let groupIndex = 0;
  for (const [name, features] of groups) {
    const prepared = prepareFeatures(features);
    const collection: FeatureCollection<Geometry, Record<string, unknown>> = { type: "FeatureCollection", features: prepared.map((item) => item.feature) };
    const id = `${prefix}-${groupIndex++}-${slug(name)}`;
    if (native3d && app.registerExternalNativeLayer) {
      try {
        app.registerExternalNativeLayer({
          id, name: `${sourceFilename} / ${name}`, type: "geojson", geojson: collection,
          nativeLayerIds: [], opacity: 1, style: await native3dStyle(prepared),
          metadata: { sourceKind: "kml-kmz-import-3d", kmlDocumentName: parsed.documentName, kmlFeatureCount: features.length, kmlAltitudeMode: "native-z" },
        });
        importedLayerIds.push(id);
        continue;
      } catch (error) {
        warnings.push({ code: "partial-support", message: `GeoLibre's native 3D Z-value renderer could not register “${name}”; flat styling was used (${error instanceof Error ? error.message : String(error)}).` });
      }
    }
    if (map && app.registerExternalNativeLayer) {
      try {
        const native = await addStyledMapLayers(map, id, prepared, warnings);
        app.registerExternalNativeLayer({
          id, name: `${sourceFilename} / ${name}`, type: "geojson", geojson: collection,
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
        importedLayerIds.push(app.addGeoJsonLayer(`${sourceFilename} / ${name}`, collection));
      }
    } else {
      importedLayerIds.push(app.addGeoJsonLayer(`${sourceFilename} / ${name}`, collection));
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
  if (importedLayerIds.length > 0) {
    if (app.addLayerGroup) {
      app.addLayerGroup(sourceFilename, importedLayerIds);
    } else if (importedLayerIds.length > 1) {
      warnings.push({
        code: "partial-support",
        message: `GeoLibre's external-plugin API cannot create layer groups yet. “${sourceFilename}” folder layers remain adjacent in the Layers panel.`,
      });
    }
  }
  return { layerIds: importedLayerIds, warnings };
}
