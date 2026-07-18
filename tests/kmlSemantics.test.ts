import { describe, expect, it } from "vitest";
import { parseKml } from "../src/kmlParser";

describe("filename-independent KML semantics", () => {
  it.each(["opaque-name.kml", "vendor-export-9472.kmz", "測量データ.kml"])("applies altitude modes identically for %s", async (sourceFilename) => {
    const xml = `<kml xmlns:gx="http://www.google.com/kml/ext/2.2"><Document><name>Arbitrary document</name>
      <Placemark><name>Default clamp</name><Point><coordinates>1,2,100</coordinates></Point></Placemark>
      <Placemark><name>Explicit clamp</name><Point><altitudeMode>clampToGround</altitudeMode><coordinates>3,4,200</coordinates></Point></Placemark>
      <Placemark><name>Absolute</name><Point><altitudeMode>absolute</altitudeMode><coordinates>5,6,300</coordinates></Point></Placemark>
      <Placemark><name>Relative</name><Point><altitudeMode>relativeToGround</altitudeMode><coordinates>7,8,25</coordinates></Point></Placemark>
      <Placemark><name>Sea floor clamp</name><Point><gx:altitudeMode>clampToSeaFloor</gx:altitudeMode><coordinates>9,10,400</coordinates></Point></Placemark>
    </Document></kml>`;
    const parsed = await parseKml(xml, { sourceFilename });
    const coordinates = Object.fromEntries(parsed.featureCollection.features.map((feature) => [feature.properties.name, feature.geometry.type === "Point" ? feature.geometry.coordinates : undefined]));
    expect(coordinates).toEqual({
      "Default clamp": [1, 2, 0],
      "Explicit clamp": [3, 4, 0],
      Absolute: [5, 6, 300],
      Relative: [7, 8, 25],
      "Sea floor clamp": [9, 10, 0],
    });
    expect(parsed.featureCollection.features.every((feature) => feature.properties.sourceFilename === sourceFilename)).toBe(true);
  });

  it("applies gx:altitudeOffset and retains generic geometry flags", async () => {
    const xml = `<kml xmlns:gx="http://www.google.com/kml/ext/2.2"><Placemark><name>Offset route</name><LineString><altitudeMode>absolute</altitudeMode><gx:altitudeOffset>5</gx:altitudeOffset><extrude>1</extrude><tessellate>0</tessellate><coordinates>10,20,30 11,21,40</coordinates></LineString></Placemark></kml>`;
    const parsed = await parseKml(xml, { sourceFilename: "unrecognized-generator-output.kml" });
    expect(parsed.featureCollection.features[0]).toMatchObject({
      geometry: { type: "LineString", coordinates: [[10, 20, 35], [11, 21, 45]] },
      properties: { altitudeMode: "absolute", altitudeOffset: 5, extrude: true, tessellate: false },
    });
  });

  it("keeps mixed MultiGeometry altitude rules independent and safely clamps unknown modes", async () => {
    const xml = `<kml><Placemark><name>Mixed modes</name><MultiGeometry>
      <Point><coordinates>1,1,90</coordinates></Point>
      <Point><altitudeMode>absolute</altitudeMode><coordinates>2,2,80</coordinates></Point>
      <Point><altitudeMode>vendorSpecific</altitudeMode><coordinates>3,3,70</coordinates></Point>
    </MultiGeometry></Placemark></kml>`;
    const parsed = await parseKml(xml, { sourceFilename: "anything.kml" });
    expect(parsed.featureCollection.features.map((feature) => feature.geometry)).toEqual([
      { type: "Point", coordinates: [1, 1, 0] },
      { type: "Point", coordinates: [2, 2, 80] },
      { type: "Point", coordinates: [3, 3, 0] },
    ]);
    expect(parsed.warnings.some((warning) => warning.message.includes("vendorSpecific") && warning.message.includes("clampToGround"))).toBe(true);
  });
});
