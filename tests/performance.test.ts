import { describe, expect, it } from "vitest";
import { parseKml } from "../src/kmlParser";

function pointKml(count: number): string {
  return `<kml><Document>${Array.from({ length: count }, (_, index) => `<Placemark><name>P${index}</name><Point><coordinates>${index / 1000},${index / 2000}</coordinates></Point></Placemark>`).join("")}</Document></kml>`;
}

describe("large KML performance", () => {
  it.each([1, 1_000, 10_000])("parses %i point features", async (count) => {
    const started = performance.now();
    const result = await parseKml(pointKml(count), { sourceFilename: `${count}.kml` });
    expect(result.summary.points).toBe(count);
    expect(performance.now() - started).toBeLessThan(20_000);
  }, 25_000);
});
