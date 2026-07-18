import type { Feature, Geometry } from "geojson";
import { describe, expect, it, vi } from "vitest";
import type { ExternalLayerRegistration, GeoLibreAppAPI, GeoLibreDeckGL, MapLike } from "../src/host-api";
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

function fakeDeckGL(): GeoLibreDeckGL {
  class FakeLayer {}
  class FakeMapboxLayer {
    id = "";
    type = "custom";
    constructor(properties: Record<string, unknown>) {
      Object.assign(this, properties);
      this.id = String(properties.id);
      this.type = "custom";
    }
  }
  return {
    layers: { GeoJsonLayer: FakeLayer, IconLayer: FakeLayer },
    mapbox: { MapboxLayer: FakeMapboxLayer },
  } as unknown as GeoLibreDeckGL;
}

function fakeMap(): { map: MapLike; layers: Record<string, unknown>[]; states: Array<{ target: { source: string; id: string | number }; state: Record<string, unknown> }>; container: HTMLElement } {
  const sources = new Map<string, unknown>();
  const layers: Record<string, unknown>[] = [];
  const states: Array<{ target: { source: string; id: string | number }; state: Record<string, unknown> }> = [];
  const container = document.createElement("div");
  const canvas = document.createElement("canvas");
  return {
    layers,
    states,
    container,
    map: {
      addSource: (id, source) => { sources.set(id, source); },
      getSource: (id) => sources.get(id),
      removeSource: (id) => { sources.delete(id); },
      addLayer: (layer) => { layers.push(layer); },
      getLayer: (id) => layers.find((layer) => layer.id === id),
      removeLayer: (id) => { const index = layers.findIndex((layer) => layer.id === id); if (index >= 0) layers.splice(index, 1); },
      setFeatureState: (target, state) => { states.push({ target, state }); },
      getContainer: () => container,
      getCanvas: () => canvas,
      queryTerrainElevation: () => 500,
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
    expect(result.layerIds).toHaveLength(1);
    expect(addLayerGroup).not.toHaveBeenCalled();
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

  it("uses one native 3D layer for points and stems, restores point information, and omits hidden features by default", async () => {
    const { map, layers, container } = fakeMap();
    const registrations: ExternalLayerRegistration[] = [];
    const visible = point("Visible", "Earthquakes / Depth 74 to 161");
    visible.geometry = { type: "Point", coordinates: [120.681, 0.109, 27_979] };
    visible.properties.__kmlVisible = true;
    visible.properties.__kmlStyle = { iconColor: { raw: "ff0000ff", hex: "#ff0000", opacity: 1, css: "rgba(255, 0, 0, 1)" } };
    visible.properties.Place = "Minahasa, Sulawesi, Indonesia";
    visible.properties.altitudeMode = "absolute";
    visible.properties.extrude = true;
    const stem: Feature<Geometry, KmlFeatureProperties> = {
      type: "Feature",
      geometry: { type: "LineString", coordinates: [[120.681, 0.109, 0], [120.681, 0.109, 27_979]] },
      properties: { name: "Visible stem", folderPath: "Earthquakes / Magnitude 5.8 to 6.2", sourceFilename: "earthquakes.kmz", __kmlVisible: true, altitudeMode: "absolute" },
    };
    const relative = point("Relative point", "Completely unrelated folder");
    relative.geometry = { type: "Point", coordinates: [121, 1, 25] };
    relative.properties.__kmlVisible = true;
    relative.properties.altitudeMode = "relativeToGround";
    const hidden = point("Hidden", "Earthquakes / Depth 0 to 10");
    hidden.geometry = { type: "Point", coordinates: [10, 20, 5_000] };
    hidden.properties.__kmlVisible = false;
    const app = {
      getMap: () => map,
      getDeckGL: async () => fakeDeckGL(),
      registerExternalNativeLayer: (layer: ExternalLayerRegistration) => { registrations.push(layer); },
      fitBounds: vi.fn(),
      addGeoJsonLayer: vi.fn(() => "fallback"),
    } as unknown as GeoLibreAppAPI;

    const result = await addParsedKmlToGeoLibre(app, parsed([visible, stem, relative, hidden]), "earthquakes.kmz");

    expect(registrations).toHaveLength(1);
    expect(registrations[0]).toMatchObject({ name: "earthquakes.kmz", opacity: 1 });
    expect(registrations[0]?.nativeLayerIds).toHaveLength(2);
    expect(registrations[0]?.style).toMatchObject({ elevation3dEnabled: true, elevation3dVerticalScale: 1, fillColor: "#ff0000" });
    expect(registrations[0]?.geojson?.features).toHaveLength(3);
    const pointLayer = layers.find((layer) => String(layer.id).endsWith("-3d-points"));
    expect(pointLayer).toBeDefined();
    const pointDatum = (pointLayer?.data as Array<{ properties: Record<string, unknown> }>)[0];
    (pointLayer?.onClick as (info: Record<string, unknown>) => boolean)({ x: 20, y: 30, object: pointDatum });
    expect(container.querySelector(".kml-feature-card")?.textContent).toContain("Minahasa, Sulawesi, Indonesia");
    expect((pointLayer?.data as Array<{ position: number[]; properties: Record<string, unknown> }>).find((datum) => datum.properties.name === "Relative point")?.position).toEqual([121, 1, 525]);
    const geometryLayer = layers.find((layer) => String(layer.id).endsWith("-3d-geometry"));
    expect(JSON.stringify(geometryLayer?.data)).toContain("27979");
    expect(JSON.stringify(geometryLayer?.data)).toContain("500");
    expect(result.warnings.some((warning) => warning.message.includes("marked hidden"))).toBe(true);

    registrations.length = 0;
    const withHidden = await addParsedKmlToGeoLibre(app, parsed([visible, stem, relative, hidden]), "earthquakes.kmz", { includeHiddenFeatures: true });
    expect(registrations).toHaveLength(1);
    expect(registrations[0]?.geojson?.features).toHaveLength(4);
    expect(withHidden.warnings.some((warning) => warning.message.includes("marked hidden"))).toBe(false);
  });
});
