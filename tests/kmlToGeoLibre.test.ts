import type { Feature, Geometry } from "geojson";
import { describe, expect, it, vi } from "vitest";
import type { ExternalLayerRegistration, GeoLibreAppAPI, MapLike } from "../src/host-api";
import { addParsedKmlToGeoLibre } from "../src/kmlToGeoLibre";
import type { KmlFeatureProperties, ParsedKml } from "../src/types";

function parsed(features: Array<Feature<Geometry, KmlFeatureProperties>>, withOverlay = false): ParsedKml {
  return {
    featureCollection: { type: "FeatureCollection", features },
    overlays: withOverlay ? [{ name: "Overlay", imageUrl: "data:image/png;base64,AA==", bounds: [0, 0, 2, 2], coordinates: [[0, 2], [2, 2], [2, 0], [0, 0]], rotation: 0, drawOrder: 0, opacity: 1, folderPath: "" }] : [],
    networkLinks: [], models: [], warnings: [], documentName: "Document",
    summary: { points: features.length, lines: 0, polygons: 0, groundOverlays: withOverlay ? 1 : 0, folders: 2, styles: 1, models: 0, networkLinks: 0, features: features.length },
  };
}

function point(name: string, folderPath: string, icon = false): Feature<Geometry, KmlFeatureProperties> {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [1, 1] },
    properties: {
      name, folderPath, sourceFilename: "points.kmz",
      ...(icon ? { __kmlStyle: { iconHref: "data:image/png;base64,AA==" } } : {}),
    },
  };
}

function fakeMap(): { map: MapLike; layers: Record<string, unknown>[]; states: Array<{ target: { source: string; id: string | number }; state: Record<string, unknown> }> } {
  const sources = new Map<string, unknown>();
  const layers: Record<string, unknown>[] = [];
  const states: Array<{ target: { source: string; id: string | number }; state: Record<string, unknown> }> = [];
  return {
    layers,
    states,
    map: {
      addSource: (id, source) => { sources.set(id, source); },
      getSource: (id) => sources.get(id),
      removeSource: (id) => { sources.delete(id); },
      addLayer: (layer) => { layers.push(layer); },
      getLayer: (id) => layers.find((layer) => layer.id === id),
      removeLayer: (id) => { const index = layers.findIndex((layer) => layer.id === id); if (index >= 0) layers.splice(index, 1); },
      setFeatureState: (target, state) => { states.push({ target, state }); },
    },
  };
}

describe("GeoLibre layer registration", () => {
  it("keeps icon points visible, consolidates folders, and uses a native group when available", async () => {
    const { map, layers, states } = fakeMap();
    const registrations: ExternalLayerRegistration[] = [];
    const addLayerGroup = vi.fn(() => "group-1");
    const app = {
      getMap: () => map,
      registerExternalNativeLayer: (layer: ExternalLayerRegistration) => { registrations.push(layer); },
      addLayerGroup,
      fitBounds: vi.fn(),
      addGeoJsonLayer: vi.fn(() => "fallback"),
    } as unknown as GeoLibreAppAPI;

    const result = await addParsedKmlToGeoLibre(app, parsed([point("A", "Folder A", true), point("B", "Folder B")]), "points.kmz");

    expect(registrations).toHaveLength(1);
    expect(registrations[0]?.geojson?.features).toHaveLength(2);
    const publicProperties = registrations[0]!.geojson!.features[0]!.properties!;
    expect(publicProperties).toEqual({ name: "A", Folder: "Folder A" });
    expect(JSON.stringify(publicProperties)).not.toContain("__kml");
    const circle = layers.find((layer) => String(layer.id).endsWith("-point"));
    expect(circle).toBeDefined();
    expect(JSON.stringify(circle?.filter)).not.toContain("__kmlIconHref");
    expect(JSON.stringify(circle?.paint)).toContain("feature-state");
    expect(states.some((item) => item.state.pointColor === "#e5df67" && item.state.pointOpacity === 0.9)).toBe(true);
    expect(addLayerGroup).toHaveBeenCalledWith("points.kmz", result.layerIds);
  });

  it("reports the current host grouping limitation when overlays create adjacent layers", async () => {
    const { map } = fakeMap();
    const app = {
      getMap: () => map,
      registerExternalNativeLayer: vi.fn(),
      fitBounds: vi.fn(),
      addGeoJsonLayer: vi.fn(() => "fallback"),
    } as unknown as GeoLibreAppAPI;
    const result = await addParsedKmlToGeoLibre(app, parsed([point("A", "Folder A")], true), "overlay.kmz");
    expect(result.layerIds).toHaveLength(2);
    expect(result.warnings.some((warning) => warning.message.includes("cannot create layer groups"))).toBe(true);
  });

  it("uses GeoLibre native 3D Z rendering, preserves folders, and omits KML-hidden features by default", async () => {
    const { map } = fakeMap();
    const registrations: ExternalLayerRegistration[] = [];
    const visible = point("Visible", "Earthquakes / Depth 74 to 161");
    visible.geometry = { type: "Point", coordinates: [120.681, 0.109, 27_979] };
    visible.properties.__kmlVisible = true;
    visible.properties.__kmlStyle = { iconColor: { raw: "ff0000ff", hex: "#ff0000", opacity: 1, css: "rgba(255, 0, 0, 1)" } };
    const hidden = point("Hidden", "Earthquakes / Depth 0 to 10");
    hidden.geometry = { type: "Point", coordinates: [10, 20, 5_000] };
    hidden.properties.__kmlVisible = false;
    const app = {
      getMap: () => map,
      getDeckGL: async () => ({}),
      registerExternalNativeLayer: (layer: ExternalLayerRegistration) => { registrations.push(layer); },
      fitBounds: vi.fn(),
      addGeoJsonLayer: vi.fn(() => "fallback"),
    } as unknown as GeoLibreAppAPI;

    const result = await addParsedKmlToGeoLibre(app, parsed([visible, hidden]), "earthquakes.kmz");

    expect(registrations).toHaveLength(1);
    expect(registrations[0]).toMatchObject({ name: "earthquakes.kmz / Depth 74 to 161", nativeLayerIds: [], opacity: 1 });
    expect(registrations[0]?.style).toMatchObject({ elevation3dEnabled: true, elevation3dVerticalScale: 1, fillColor: "#ff0000" });
    expect(registrations[0]?.geojson?.features).toHaveLength(1);
    expect(result.warnings.some((warning) => warning.message.includes("marked hidden"))).toBe(true);

    registrations.length = 0;
    const withHidden = await addParsedKmlToGeoLibre(app, parsed([visible, hidden]), "earthquakes.kmz", { includeHiddenFeatures: true });
    expect(registrations).toHaveLength(2);
    expect(withHidden.warnings.some((warning) => warning.message.includes("marked hidden"))).toBe(false);
  });
});
