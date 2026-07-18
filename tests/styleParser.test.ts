import { describe, expect, it } from "vitest";
import { convertKmlColor } from "../src/styleParser";

describe("KML color conversion", () => {
  it("converts aabbggrr into CSS color channels and opacity", () => {
    expect(convertKmlColor("8000ff00")).toEqual({ raw: "8000ff00", hex: "#00ff00", opacity: 128 / 255, css: "rgba(0, 255, 0, 0.502)" });
    expect(convertKmlColor("ff0000ff")?.hex).toBe("#ff0000");
  });

  it("rejects malformed colors", () => {
    expect(convertKmlColor("#fff")).toBeUndefined();
    expect(convertKmlColor("not-a-color")).toBeUndefined();
  });
});
