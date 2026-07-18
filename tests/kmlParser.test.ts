import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseKml } from "../src/kmlParser";
import type { AssetResolver } from "../src/types";

const fixture = (name: string) => readFile(resolve("test-data/kml-kmz/synthetic", name), "utf8");
const resolver: AssetResolver = { resolve: async (href) => href === "icons/pin.png" ? "data:image/png;base64,AA==" : undefined };

describe("KML parser", () => {
  it("imports Point, LineString, Polygon and altitude", async () => {
    const result = await parseKml(await fixture("basic-mixed.kml"), { sourceFilename: "basic-mixed.kml" });
    expect(result.summary).toMatchObject({ points: 1, lines: 1, polygons: 1, features: 3 });
    expect(result.featureCollection.features[0]?.geometry).toEqual({ type: "Point", coordinates: [-77.0365, 38.8977, 12] });
  });

  it("preserves Polygon holes", async () => {
    const result = await parseKml(await fixture("polygon-hole.kml"), { sourceFilename: "polygon-hole.kml" });
    const polygon = result.featureCollection.features[0]?.geometry;
    expect(polygon?.type).toBe("Polygon");
    if (polygon?.type === "Polygon") expect(polygon.coordinates).toHaveLength(2);
  });

  it("handles nested folders, mixed MultiGeometry, ExtendedData, StyleMap, time and gx:Track", async () => {
    const result = await parseKml(await fixture("nested-styled-time.kml"), { sourceFilename: "survey.kml", assetResolver: resolver });
    expect(result.summary).toMatchObject({ points: 1, lines: 2, folders: 2, styles: 2, features: 3 });
    const observation = result.featureCollection.features.find((feature) => feature.properties.name === "Observation");
    expect(observation?.properties.folderPath).toBe("Survey / Day 1 / Track A");
    expect(observation?.properties.observer).toBe("Ada");
    expect(observation?.properties.depth).toBe("42.5");
    expect(observation?.properties.schemaUrl).toBe("#survey");
    expect(observation?.properties.begin).toBe("2026-01-01");
    expect(observation?.properties.description).toContain("<b>Safe</b>");
    expect(observation?.properties.description).not.toContain("script");
    expect(observation?.properties.__kmlStyle?.lineColor?.hex).toBe("#00ff00");
    expect(observation?.properties.__kmlStyle?.iconHref).toBe("data:image/png;base64,AA==");
    const track = result.featureCollection.features.find((feature) => feature.properties.name === "GPS");
    expect(track?.properties.trackWhen).toEqual(["2026-01-01T00:00:00Z", "2026-01-01T00:01:00Z"]);
    expect(track?.geometry).toEqual({ type: "LineString", coordinates: [[1, 2, 3], [4, 5, 6]] });
  });

  it("keeps valid features when an unsupported COLLADA model exists", async () => {
    const result = await parseKml(await fixture("unsupported-model.kml"), { sourceFilename: "model.kml" });
    expect(result.summary.features).toBe(1);
    expect(result.summary.models).toBe(1);
    expect(result.models[0]).toMatchObject({ href: "models/building.dae", longitude: 10, latitude: 20, altitude: 50, heading: 90, scaleX: 2 });
    expect(result.warnings.some((warning) => warning.message.includes("COLLADA"))).toBe(true);
  });

  it("parses TimeStamp and NetworkLink metadata", async () => {
    const xml = `<kml><Document><Placemark><TimeStamp><when>2026-02-03T04:05:06Z</when></TimeStamp><Point><coordinates>1,2</coordinates></Point></Placemark><NetworkLink><name>Linked</name><Link><href>https://example.com/data.kml</href></Link></NetworkLink></Document></kml>`;
    const result = await parseKml(xml, { sourceFilename: "time.kml" });
    expect(result.featureCollection.features[0]?.properties.when).toBe("2026-02-03T04:05:06Z");
    expect(result.networkLinks[0]).toMatchObject({ name: "Linked", kind: "https" });
  });

  it("preserves per-track timestamps in gx:MultiTrack", async () => {
    const xml = `<kml xmlns:gx="http://www.google.com/kml/ext/2.2"><Placemark><gx:MultiTrack><gx:Track><when>2026-01-01</when><when>2026-01-02</when><gx:coord>0 0</gx:coord><gx:coord>1 1</gx:coord></gx:Track><gx:Track><when>2026-02-01</when><when>2026-02-02</when><gx:coord>2 2</gx:coord><gx:coord>3 3</gx:coord></gx:Track></gx:MultiTrack></Placemark></kml>`;
    const result = await parseKml(xml, { sourceFilename: "multi-track.kml" });
    expect(result.featureCollection.features).toHaveLength(2);
    expect(result.featureCollection.features.map((feature) => feature.properties.trackWhen)).toEqual([["2026-01-01", "2026-01-02"], ["2026-02-01", "2026-02-02"]]);
  });

  it("reports malformed XML and rejects entity declarations", async () => {
    await expect(parseKml("<kml><Document>", { sourceFilename: "bad.kml" })).rejects.toThrow(/Invalid KML XML/);
    await expect(parseKml("<!DOCTYPE kml [<!ENTITY x SYSTEM 'file:///etc/passwd'>]><kml/>", { sourceFilename: "xxe.kml" })).rejects.toThrow(/security/i);
  });
});
