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
  }, 120_000);
});
