import { existsSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseKml } from "../src/kmlParser";
import { KmzArchive } from "../src/kmzArchive";
import type { ParsedKml } from "../src/types";

const directory = resolve("example_kml-kmz_files");
const names = existsSync(directory) ? readdirSync(directory).filter((name) => /\.(?:kml|kmz)$/i.test(name)) : [];

describe("provided real-world examples", () => {
  if (names.length === 0) it.skip("local ignored corpus is not present", () => undefined);
  it.each(names)("parses %s without crashing on view-only documents", async (name) => {
      const bytes = await readFile(resolve(directory, name));
      let parsed: ParsedKml;
      if (extname(name).toLowerCase() === ".kmz") {
        const archive = await KmzArchive.open(bytes);
        parsed = await parseKml(await archive.readText(), { sourceFilename: name, basePath: archive.primaryKmlPath, assetResolver: archive });
      } else {
        parsed = await parseKml(new TextDecoder().decode(bytes), { sourceFilename: name });
      }
      expect(parsed.featureCollection.type, name).toBe("FeatureCollection");
      if (name === "Canada.kmz") {
        const winnipeg = parsed.featureCollection.features.find((feature) => feature.properties.name === "Winnipeg");
        expect(parsed.summary.points).toBeGreaterThan(3_000);
        expect(winnipeg?.properties).toMatchObject({ FID: "0", Data_Numbe: "CAN001", Site_Name: "Winnipeg" });
        expect(winnipeg?.properties.description).toBeUndefined();
        expect(winnipeg?.properties.__kmlStyle?.iconHref).toMatch(/^data:image\/png;base64,/);
      }
      if (name === "AboveSurfaceEQ_depth_as_color.kmz") {
        const visiblePoints = parsed.featureCollection.features.filter((feature) => feature.geometry.type === "Point" && feature.properties.__kmlVisible !== false);
        const minahasa = visiblePoints.find((feature) => feature.properties.Time === "2008-10-20T04:54:19.240Z");
        expect(visiblePoints).toHaveLength(4_884);
        expect(minahasa?.properties).toMatchObject({ Place: "Minahasa, Sulawesi, Indonesia", "Depth km": "96", Magnitude: "5.9" });
        expect(minahasa?.geometry).toEqual({ type: "Point", coordinates: [120.681, 0.109, 27979.079284] });
      }
      if (name === "dynamic_earth_kmz_file.v2.kmz") {
        const seafloorAge = parsed.overlays.find((overlay) => overlay.name === "Seafloor Age");
        expect(seafloorAge).toMatchObject({ bounds: [-179.9999999999, -72, 179.9999999999, 89.99999990000001], visible: false, drawOrder: 2 });
        expect(seafloorAge?.imageUrl).toMatch(/^data:image\/png;base64,/);
      }
  }, 120_000);
});
