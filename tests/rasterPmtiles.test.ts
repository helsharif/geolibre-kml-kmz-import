import { PMTiles, zxyToTileId as referenceTileId } from "pmtiles";
import { describe, expect, it } from "vitest";
import type { RasterTilePyramid } from "../src/groundOverlayRasterTiles";
import { buildRasterPmtiles, zxyToTileId } from "../src/rasterPmtiles";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function pyramid(): RasterTilePyramid {
  return {
    tileSize: 512,
    targetZoom: 1,
    bounds: [-20, -10, 30, 40],
    tiles: [
      { z: 0, x: 0, y: 0, rawX: 0, bounds: [-180, -85, 180, 85], imageUrl: PNG },
      { z: 1, x: 1, y: 1, rawX: 1, bounds: [0, -85, 180, 0], imageUrl: PNG },
    ],
  };
}

describe("raster PMTiles conversion", () => {
  it("uses the PMTiles v3 Hilbert tile ordering", () => {
    for (let z = 0; z <= 5; z += 1) {
      for (let x = 0; x < 2 ** z; x += 1) {
        for (let y = 0; y < 2 ** z; y += 1) expect(zxyToTileId(z, x, y)).toBe(referenceTileId(z, x, y));
      }
    }
  });

  it("writes a standards-readable uncompressed PNG archive", async () => {
    const archive = buildRasterPmtiles(pyramid(), "Overlay");
    const reader = new PMTiles({
      getKey: () => "memory://overlay.pmtiles",
      getBytes: async (offset: number, length: number) => ({ data: archive.slice(offset, offset + length).buffer }),
    });
    const header = await reader.getHeader();

    expect(header).toMatchObject({ specVersion: 3, tileType: 2, minZoom: 0, maxZoom: 1, minLon: -20, minLat: -10, maxLon: 30, maxLat: 40 });
    expect(await reader.getMetadata()).toMatchObject({ name: "Overlay", format: "png" });
    expect(new Uint8Array((await reader.getZxy(0, 0, 0))!.data)).toEqual(new Uint8Array((await reader.getZxy(1, 1, 1))!.data));
    expect(await reader.getZxy(1, 0, 0)).toBeUndefined();
  });
});
