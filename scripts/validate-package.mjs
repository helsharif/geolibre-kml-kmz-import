import { access, readFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const manifestPath = join(root, "geolibre-plugin", "plugin.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
for (const key of ["id", "name", "version", "entry"]) if (!manifest[key]) throw new Error(`plugin.json is missing ${key}`);
for (const path of [manifest.entry, manifest.style].filter(Boolean)) {
  if (path !== posix.normalize(path) || path.startsWith("/") || path.includes("..") || path.includes("\\")) throw new Error(`Unsafe manifest path: ${path}`);
  await access(join(root, "geolibre-plugin", path));
}
const archivePath = join(root, "geolibre-plugin", `${manifest.id}-${manifest.version}.zip`);
const zip = await JSZip.loadAsync(await readFile(archivePath));
for (const required of ["plugin.json", manifest.entry, manifest.style].filter(Boolean)) if (!zip.file(required)) throw new Error(`Packaged ZIP is missing ${required}`);
const bundledManifest = JSON.parse(await zip.file("plugin.json").async("string"));
if (bundledManifest.id !== manifest.id || bundledManifest.version !== manifest.version) throw new Error("Packaged manifest does not match source manifest.");
const assetCount = Object.values(zip.files).filter((entry) => !entry.dir && entry.name !== "plugin.json").length;
console.log(`Validated ${archivePath}: root manifest and ${assetCount} assets are present.`);
