import { describe, expect, it, vi } from "vitest";
import { materializeRasterTilePyramid, planRasterTilePyramid } from "../src/groundOverlayRasterTiles";
import type { GroundOverlay } from "../src/types";

function overlay(bounds: [number, number, number, number]): GroundOverlay {
  const [west, south, east, north] = bounds;
  return {
    name: "Overlay", imageUrl: "data:image/png;base64,AA==", bounds,
    coordinates: [[west, north], [east, north], [east, south], [west, south]],
    rotation: 0, drawOrder: 0, opacity: 1, folderPath: "", visible: true,
  };
}

describe("globe-native GroundOverlay raster pyramids", () => {
  it("plans a multi-resolution XYZ pyramid for the Dynamic Earth overlay", () => {
    const plan = planRasterTilePyramid(overlay([-179.9999999999, -72, 179.9999999999, 89.9999999]), 3600, 1620);
    expect(plan.targetZoom).toBe(3);
    expect(plan.tiles.some((tile) => tile.z === 0)).toBe(true);
    expect(plan.tiles.filter((tile) => tile.z === 3)).toHaveLength(56);
    expect(plan.tiles).toHaveLength(77);
    expect(plan.tiles.every((tile) => tile.x >= 0 && tile.x < 2 ** tile.z)).toBe(true);
    expect(plan.tiles[0]?.bounds[0]).toBeGreaterThan(-180);
    expect(plan.tiles[0]?.bounds[2]).toBeLessThan(180);
  });

  it("wraps dateline-crossing tile coordinates into the canonical XYZ world", () => {
    const plan = planRasterTilePyramid(overlay([170, -10, -170, 10]), 1024, 512);
    expect(plan.targetZoom).toBeGreaterThan(0);
    const target = plan.tiles.filter((tile) => tile.z === plan.targetZoom);
    expect(target.some((tile) => tile.rawX !== tile.x)).toBe(true);
    expect(target.every((tile) => tile.x >= 0 && tile.x < 2 ** tile.z)).toBe(true);
  });

  it("converts decoded image pixels into PNG raster tiles", async () => {
    const sourcePixels = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]);
    const drawImage = vi.fn();
    const getImageData = vi.fn(() => ({ data: sourcePixels } as ImageData));
    const putImageData = vi.fn();
    const createImageData = vi.fn(() => ({ data: new Uint8ClampedArray(64), width: 4, height: 4 } as ImageData));
    let contextCall = 0;
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => {
      contextCall += 1;
      return (contextCall === 1 ? { drawImage, getImageData } : { createImageData, putImageData }) as unknown as CanvasRenderingContext2D;
    });
    const toDataUrl = vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,tile");
    try {
      const pyramid = await materializeRasterTilePyramid(overlay([-180, -85, 180, 85]), async () => ({ width: 2, height: 2 }) as ImageBitmap, 4);
      expect(pyramid.tiles).toHaveLength(1);
      expect(pyramid.tiles[0]?.imageUrl).toBe("data:image/png;base64,tile");
      expect(drawImage).toHaveBeenCalledOnce();
      expect(putImageData).toHaveBeenCalledOnce();
    } finally {
      getContext.mockRestore();
      toDataUrl.mockRestore();
    }
  });
});
