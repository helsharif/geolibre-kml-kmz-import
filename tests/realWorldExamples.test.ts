import { existsSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseKml } from "../src/kmlParser";
import { KmzArchive } from "../src/kmzArchive";

const directory = resolve("example_kml-kmz_files");
const names = existsSync(directory) ? readdirSync(directory).filter((name) => /\.(?:kml|kmz)$/i.test(name)) : [];

describe("provided real-world examples", () => {
  if (names.length === 0) it.skip("local ignored corpus is not present", () => undefined);
  it.each(names)("parses %s without crashing on view-only documents", async (name) => {
      const bytes = await readFile(resolve(directory, name));
      if (extname(name).toLowerCase() === ".kmz") {
        const archive = await KmzArchive.open(bytes);
        const parsed = await parseKml(await archive.readText(), { sourceFilename: name, basePath: archive.primaryKmlPath, assetResolver: archive });
        expect(parsed.featureCollection.type, name).toBe("FeatureCollection");
      } else {
        const parsed = await parseKml(new TextDecoder().decode(bytes), { sourceFilename: name });
        expect(parsed.featureCollection.type, name).toBe("FeatureCollection");
      }
  }, 120_000);
});
