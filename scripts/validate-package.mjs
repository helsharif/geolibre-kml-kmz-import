import { access, readFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";

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
assert.deepEqual(bundledManifest, manifest, "Packaged manifest must match source manifest");
assert.deepEqual(Object.keys(zip.files).sort(), ["index.js", "plugin.json", "style.css"]);
const entry = JSON.parse(await readFile(join(root, "geolibre-plugin", `${manifest.id}.json`), "utf8"));
assert.equal(entry.source.sha256, createHash("sha256").update(await readFile(archivePath)).digest("hex"));
assert.equal(entry.version, manifest.version);
assert.equal(entry.id, manifest.id);
assert.equal(entry.manifestUrl, `plugins/${manifest.id}/plugin.json`);
assert.deepEqual(entry.categories, ["Data", "Vector"]);
const { default: plugin } = await import(`../geolibre-plugin/${manifest.entry}`);
for (const key of ["id", "name", "version"]) assert.equal(plugin[key], manifest[key]);
assert.equal(typeof plugin.activate, "function");
assert.equal(typeof plugin.deactivate, "function");
const assetCount = Object.values(zip.files).filter((entry) => !entry.dir && entry.name !== "plugin.json").length;
console.log(`Validated ${archivePath}: root manifest and ${assetCount} assets are present.`);
