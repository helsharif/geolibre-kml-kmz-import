import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseKml } from "../src/kmlParser";

describe("GroundOverlay", () => {
  it("parses bounds, rotation, opacity, draw order, and resolved image", async () => {
    const xml = await readFile(resolve("test-data/kml-kmz/synthetic/ground-overlay.kml"), "utf8");
    const result = await parseKml(xml, { sourceFilename: "overlay.kml", assetResolver: { resolve: async () => "data:image/png;base64,AA==" } });
    expect(result.overlays[0]).toMatchObject({ bounds: [-80, 40, -70, 45], rotation: 15, drawOrder: 2, opacity: 128 / 255, imageUrl: "data:image/png;base64,AA==", visible: true });
    expect(result.overlays[0]?.coordinates).toHaveLength(4);
    expect(result.warnings.some((warning) => warning.message.includes("rotated"))).toBe(true);
  });

  it("supports gx:LatLonQuad coordinate order", async () => {
    const xml = `<kml xmlns:gx="http://www.google.com/kml/ext/2.2"><GroundOverlay><Icon><href>x.png</href></Icon><gx:LatLonQuad><coordinates>0,0 1,0 1,1 0,1</coordinates></gx:LatLonQuad></GroundOverlay></kml>`;
    const result = await parseKml(xml, { sourceFilename: "quad.kml", assetResolver: { resolve: async () => "data:image/png;base64,AA==" } });
    expect(result.overlays[0]?.coordinates).toEqual([[0, 1], [1, 1], [1, 0], [0, 0]]);
  });

  it("inherits Document and Folder visibility", async () => {
    const xml = `<kml><Document><visibility>0</visibility><GroundOverlay><visibility>1</visibility><Icon><href>x.png</href></Icon><LatLonBox><north>10</north><south>0</south><east>10</east><west>0</west></LatLonBox></GroundOverlay></Document></kml>`;
    const result = await parseKml(xml, { sourceFilename: "hidden.kml", assetResolver: { resolve: async () => "data:image/png;base64,AA==" } });
    expect(result.overlays[0]?.visible).toBe(false);
  });
});
