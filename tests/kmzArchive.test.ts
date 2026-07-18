import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { KmzArchive } from "../src/kmzArchive";

async function archive(entries: Record<string, string | Uint8Array>): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [name, value] of Object.entries(entries)) zip.file(name, value);
  return zip.generateAsync({ type: "uint8array" });
}

describe("KMZ archive", () => {
  it("selects doc.kml and resolves embedded icons relative to nested paths", async () => {
    const bytes = await archive({
      "other.kml": "<kml/>",
      "doc.kml": "<kml/>",
      "images/pin.png": new Uint8Array([137, 80, 78, 71]),
      "nested/data.kml": "<kml/>",
    });
    const kmz = await KmzArchive.open(bytes);
    expect(kmz.primaryKmlPath).toBe("doc.kml");
    expect(await kmz.resolve("../images/pin.png", "nested/data.kml")).toMatch(/^data:image\/png;base64,/);
  });

  it("uses the shallowest KML when doc.kml is absent", async () => {
    const kmz = await KmzArchive.open(await archive({ "deep/inside.kml": "<kml/>", "main.kml": "<kml/>" }));
    expect(kmz.primaryKmlPath).toBe("main.kml");
  });

  it("rejects corrupt data, missing KML, and ZIP path traversal", async () => {
    await expect(KmzArchive.open(new Uint8Array([1, 2, 3]))).rejects.toThrow(/corrupted|unsupported/);
    await expect(KmzArchive.open(await archive({ "image.png": "x" }))).rejects.toThrow(/does not contain a KML/);
    await expect(KmzArchive.open(await archive({ "doc.kml": "<kml/>", "../evil.txt": "x" }))).rejects.toThrow(/unsafe archive path/);
  });

  it("returns undefined for missing assets", async () => {
    const kmz = await KmzArchive.open(await archive({ "doc.kml": "<kml/>" }));
    expect(await kmz.resolve("files/missing.png")).toBeUndefined();
  });
});
