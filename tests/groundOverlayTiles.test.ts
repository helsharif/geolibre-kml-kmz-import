import { describe, expect, it, vi } from "vitest";
import { materializeGroundOverlayTiles, MERCATOR_MAX_LATITUDE, planGroundOverlayTiles } from "../src/groundOverlayTiles";
import type { GroundOverlay } from "../src/types";

function overlay(bounds: [number, number, number, number]): GroundOverlay {
  const [west, south, east, north] = bounds;
  return {
    name: "Overlay",
    imageUrl: "data:image/png;base64,AA==",
    bounds,
    coordinates: [[west, north], [east, north], [east, south], [west, south]],
    rotation: 0,
    drawOrder: 0,
    opacity: 1,
    folderPath: "",
    visible: true,
  };
}

describe("globe-safe GroundOverlay tiling", () => {
  it("tessellates and polar-clips an almost-global image", () => {
    const plans = planGroundOverlayTiles(overlay([-179.9999999999, -72, 179.9999999999, 89.9999999]));
    expect(plans).toHaveLength(72);
    expect(Math.max(...plans.flatMap((plan) => plan.coordinates.map((point) => point[1])))).toBeCloseTo(MERCATOR_MAX_LATITUDE, 8);
    expect(plans.every((plan) => Math.abs(plan.coordinates[1][0] - plan.coordinates[0][0]) <= 30.000001)).toBe(true);
    expect(plans[0]!.crop.top).toBeCloseTo((89.9999999 - MERCATOR_MAX_LATITUDE) / (89.9999999 + 72), 8);
    expect(plans.at(-1)!.crop.bottom).toBe(1);
  });

  it("splits a dateline-crossing box without creating a 340-degree image quad", () => {
    const plans = planGroundOverlayTiles(overlay([170, -10, -170, 10]));
    expect(plans).toHaveLength(2);
    expect(plans[0]!.coordinates).toEqual([[170, 10], [180, 10], [180, -10], [170, -10]]);
    expect(plans[1]!.coordinates).toEqual([[-180, 10], [-170, 10], [-170, -10], [-180, -10]]);
    expect(plans.map((plan) => [plan.crop.left, plan.crop.right])).toEqual([[0, 0.5], [0.5, 1]]);
  });

  it("rejects a zero-width LatLonBox instead of interpreting it as a full world", () => {
    expect(planGroundOverlayTiles(overlay([12, -10, 12, 10]))).toEqual([]);
  });

  it("crops every planned tile from the source image", async () => {
    const drawImage = vi.fn();
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    const toDataUrl = vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,tile");
    try {
      const tiles = await materializeGroundOverlayTiles(overlay([170, -10, -170, 10]), async () => ({ width: 200, height: 100 }) as ImageBitmap);
      expect(tiles).toHaveLength(2);
      expect(drawImage).toHaveBeenCalledTimes(2);
      expect(toDataUrl).toHaveBeenCalledTimes(2);
    } finally {
      getContext.mockRestore();
      toDataUrl.mockRestore();
    }
  });
});
