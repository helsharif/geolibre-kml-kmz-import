import { describe, expect, it } from "vitest";
import { convertKmlColor, parseStyle } from "../src/styleParser";
import { parseXml } from "../src/xml";

describe("KML color conversion", () => {
  it("converts aabbggrr into CSS color channels and opacity", () => {
    expect(convertKmlColor("8000ff00")).toEqual({ raw: "8000ff00", hex: "#00ff00", opacity: 128 / 255, css: "rgba(0, 255, 0, 0.502)" });
    expect(convertKmlColor("ff0000ff")?.hex).toBe("#ff0000");
  });

  it("rejects malformed colors", () => {
    expect(convertKmlColor("#fff")).toBeUndefined();
    expect(convertKmlColor("not-a-color")).toBeUndefined();
  });

  it("reads IconStyle color independently of transparent label styling", () => {
    const document = parseXml(`<kml><Style><IconStyle><color>ff00ff00</color><scale>0.625</scale><Icon><href>dot.png</href></Icon></IconStyle><LabelStyle><color>00000000</color></LabelStyle></Style></kml>`);
    const style = parseStyle(document.querySelector("Style")!);
    expect(style.iconColor?.hex).toBe("#00ff00");
    expect(style.iconScale).toBe(0.625);
    expect(style.labelColor?.opacity).toBe(0);
  });
});
