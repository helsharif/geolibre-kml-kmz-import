import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { createHash } from "node:crypto";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const bundle = join(root, "geolibre-plugin");
const manifest = JSON.parse(await readFile(join(bundle, "plugin.json"), "utf8"));
const zip = new JSZip();
// Keep the unpacked plugin and release ZIP on the same flat layout.
for (const asset of [manifest.entry, manifest.style].filter(Boolean)) {
  await writeFile(join(bundle, asset), await readFile(join(bundle, "dist", asset)));
}
zip.file("plugin.json", await readFile(join(bundle, "plugin.json")), { createFolders: false });
zip.file(manifest.entry, await readFile(join(bundle, manifest.entry)), { createFolders: false });
if (manifest.style) zip.file(manifest.style, await readFile(join(bundle, manifest.style)), { createFolders: false });
await mkdir(bundle, { recursive: true });
const output = join(bundle, `${manifest.id}-${manifest.version}.zip`);
await writeFile(output, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } }));
console.log(`Created ${output}`);
const entry = {
  id: manifest.id,
  name: manifest.name,
  version: manifest.version,
  description: "Import styled KML and KMZ files as organized GeoLibre vector and globe-compatible raster layers, with local parsing, feature information, altitude-aware 3D points, and GroundOverlay conversion.",
  author: "Husayn El Sharif",
  homepage: "https://github.com/helsharif/geolibre-kml-kmz-import",
  manifestUrl: `plugins/${manifest.id}/plugin.json`,
  categories: ["Data", "Vector"],
  minGeoLibreVersion: "2.2.0",
  source: {
    url: `https://github.com/helsharif/geolibre-kml-kmz-import/releases/download/v${manifest.version}/${manifest.id}-${manifest.version}.zip`,
    sha256: createHash("sha256").update(await readFile(output)).digest("hex"),
  },
};
await writeFile(join(bundle, `${manifest.id}.json`), `${JSON.stringify(entry, null, 2)}\n`);
console.log(`Created registry entry with SHA-256 ${entry.source.sha256}`);
