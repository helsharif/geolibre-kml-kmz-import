import { describe, expect, it } from "vitest";
import { createFeatureInfoCard } from "../src/featureInfo";

describe("Google Earth-style feature information", () => {
  it("uses the site name as a title and presents nulls, links, and fields cleanly", () => {
    const card = createFeatureInfoCard({
      name: "Winnipeg",
      FID: "0",
      Site_Name: "Winnipeg",
      Codes: "<null>",
      Reference: "https://example.com/source",
      __kmlStyle: "private",
    }, "Canada.kmz");
    expect(card.querySelector("header strong")?.textContent).toBe("Winnipeg");
    expect(card.textContent).toContain("Site Name");
    expect(card.textContent).toContain("—");
    expect(card.textContent).toContain("Canada.kmz");
    expect(card.textContent).not.toContain("private");
    expect(card.querySelector("a")?.getAttribute("href")).toBe("https://example.com/source");
  });
});
