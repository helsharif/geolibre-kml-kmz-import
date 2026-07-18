import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { GeoLibreAppAPI, MapLike } from "./host-api";
import { boundsOfGeometry } from "./geometry";
import type { ImportWarning, KmlFeatureProperties, ParsedKml } from "./types";

let importSequence = 0;

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "layer";
}

function styledFeature(feature: Feature<Geometry, KmlFeatureProperties>): Feature<Geometry, KmlFeatureProperties> {
  const style = feature.properties.__kmlStyle;
  const properties: KmlFeatureProperties = {
    ...feature.properties,
    __kmlFillColor: style?.polyColor?.hex ?? "#3b82f6",
    __kmlFillOpacity: style?.fill === false ? 0 : style?.polyColor?.opacity ?? 0.35,
    __kmlLineColor: style?.lineColor?.hex ?? "#2563eb",
    __kmlLineOpacity: style?.lineColor?.opacity ?? 1,
    __kmlLineWidth: style?.lineWidth ?? 2,
    __kmlPointColor: style?.labelColor?.hex ?? "#e11d48",
    __kmlPointOpacity: style?.labelColor?.opacity ?? 1,
    __kmlPointRadius: Math.max(3, 6 * (style?.iconScale ?? 1)),
  };
  if (style?.iconHref) properties.__kmlIconHref = style.iconHref;
  return {
    ...feature,
    properties,
  };
}

function groupFeatures(parsed: ParsedKml): Map<string, Feature<Geometry, KmlFeatureProperties>[]> {
  // One GeoLibre store layer per imported file keeps the Layers panel usable.
  // Original Document/Folder paths remain on every feature as folderPath.
  return new Map([["Features", parsed.featureCollection.features.map(styledFeature)]]);
}

async function loadImage(dataUrl: string): Promise<ImageBitmap | HTMLImageElement | undefined> {
  try {
    if (typeof createImageBitmap === "function") return await createImageBitmap(await (await fetch(dataUrl)).blob());
    const image = new Image();
    image.src = dataUrl;
    await image.decode();
    return image;
  } catch {
    return undefined;
  }
}

async function addStyledMapLayers(map: MapLike, id: string, collection: FeatureCollection<Geometry, KmlFeatureProperties>, warnings: ImportWarning[]): Promise<{ layerIds: string[]; sourceId: string }> {
  const sourceId = `${id}-source`;
  const layerIds: string[] = [];
  map.addSource(sourceId, { type: "geojson", data: collection });
  const specs: Array<Record<string, unknown>> = [
    {
      id: `${id}-fill`, type: "fill", source: sourceId,
      filter: ["match", ["geometry-type"], ["Polygon", "MultiPolygon"], true, false],
      paint: {
        "fill-color": ["coalesce", ["get", "__kmlFillColor"], "#3b82f6"],
        "fill-opacity": ["coalesce", ["get", "__kmlFillOpacity"], 0.35],
      },
    },
    {
      id: `${id}-line`, type: "line", source: sourceId,
      filter: ["match", ["geometry-type"], ["LineString", "MultiLineString", "Polygon", "MultiPolygon"], true, false],
      paint: {
        "line-color": ["coalesce", ["get", "__kmlLineColor"], "#2563eb"],
        "line-opacity": ["coalesce", ["get", "__kmlLineOpacity"], 1],
        "line-width": ["coalesce", ["get", "__kmlLineWidth"], 2],
      },
    },
    {
      id: `${id}-point`, type: "circle", source: sourceId,
      // Always draw a circle fallback. Remote icons may be blocked by CORS or
      // the Tauri CSP; hiding the circle made point-only KMZ files look empty.
      filter: ["match", ["geometry-type"], ["Point", "MultiPoint"], true, false],
      paint: {
        "circle-color": ["coalesce", ["get", "__kmlPointColor"], "#e11d48"],
        "circle-opacity": ["coalesce", ["get", "__kmlPointOpacity"], 1],
        "circle-radius": ["coalesce", ["get", "__kmlPointRadius"], 6],
        "circle-stroke-color": "#ffffff", "circle-stroke-width": 1,
      },
    },
  ];
  for (const spec of specs) {
    map.addLayer(spec);
    layerIds.push(String(spec.id));
  }
  const iconHrefs = [...new Set(collection.features.map((feature) => feature.properties.__kmlIconHref).filter((value): value is string => typeof value === "string"))].slice(0, 50);
  if (iconHrefs.length && (!map.addImage || !map.hasImage)) {
    warnings.push({ code: "partial-support", message: "Custom marker icons were resolved but this GeoLibre host cannot register MapLibre images; circle markers were used." });
  }
  for (let index = 0; index < iconHrefs.length; index += 1) {
    const href = iconHrefs[index]!;
    const imageId = `${id}-icon-${index}`;
    const image = await loadImage(href);
    if (!image || !map.addImage) {
      warnings.push({ code: "missing-asset", message: `A marker icon could not be decoded: ${href.startsWith("data:") ? "embedded image" : href}` });
      continue;
    }
    if (!map.hasImage?.(imageId)) map.addImage(imageId, image);
    const layerId = `${id}-symbol-${index}`;
    map.addLayer({
      id: layerId, type: "symbol", source: sourceId,
      filter: ["==", ["get", "__kmlIconHref"], href],
      layout: {
        "icon-image": imageId,
        "icon-size": ["/", ["coalesce", ["get", "__kmlPointRadius"], 6], 6],
        "icon-allow-overlap": true,
        "icon-rotation-alignment": "map",
      },
    });
    layerIds.push(layerId);
  }
  return { layerIds, sourceId };
}

export interface AddToGeoLibreResult { layerIds: string[]; warnings: ImportWarning[] }

export async function addParsedKmlToGeoLibre(app: GeoLibreAppAPI, parsed: ParsedKml, sourceFilename: string): Promise<AddToGeoLibreResult> {
  const warnings = [...parsed.warnings];
  const map = app.getMap?.() ?? null;
  const importedLayerIds: string[] = [];
  const prefix = `kml-${Date.now()}-${++importSequence}`;
  const groups = groupFeatures(parsed);
  let groupIndex = 0;
  for (const [name, features] of groups) {
    const collection: FeatureCollection<Geometry, KmlFeatureProperties> = { type: "FeatureCollection", features };
    const id = `${prefix}-${groupIndex++}-${slug(name)}`;
    if (map && app.registerExternalNativeLayer) {
      try {
        const native = await addStyledMapLayers(map, id, collection, warnings);
        app.registerExternalNativeLayer({
          id, name: `${sourceFilename} / ${name}`, type: "geojson", geojson: collection,
          nativeLayerIds: native.layerIds, sourceIds: [native.sourceId], opacity: 1,
          metadata: { sourceKind: "kml-kmz-import", controlOwnsPaint: true, kmlDocumentName: parsed.documentName, kmlFeatureCount: features.length },
        });
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
  const bounds = parsed.featureCollection.features.map((feature) => boundsOfGeometry(feature.geometry)).filter((value): value is [number, number, number, number] => Boolean(value));
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
        message: `GeoLibre's external-plugin API cannot create layer groups yet. “${sourceFilename}” was consolidated where possible; GroundOverlays remain adjacent layers.`,
      });
    }
  }
  return { layerIds: importedLayerIds, warnings };
}
