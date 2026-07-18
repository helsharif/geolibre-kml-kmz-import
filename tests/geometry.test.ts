import { describe, expect, it } from "vitest";
import { parseCoordinateTuple, parseCoordinates } from "../src/geometry";

describe("coordinate parsing", () => {
  it("preserves KML longitude, latitude, altitude order", () => {
    expect(parseCoordinateTuple("-77.1,38.9,123.4")).toEqual([-77.1, 38.9, 123.4]);
    expect(parseCoordinates("1,2 3,4,5")).toEqual([[1, 2], [3, 4, 5]]);
  });

  it("drops invalid tuples without reversing valid values", () => {
    expect(parseCoordinateTuple("north,west")).toBeUndefined();
    expect(parseCoordinates("1,2 bad 3,4")).toEqual([[1, 2], [3, 4]]);
  });
});
