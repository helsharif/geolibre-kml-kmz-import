import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const bundle = join(root, "geolibre-plugin");
const manifest = JSON.parse(await readFile(join(bundle, "plugin.json"), "utf8"));
const zip = new JSZip();
zip.file("plugin.json", await readFile(join(bundle, "plugin.json")), { createFolders: false });
zip.file(manifest.entry, await readFile(join(bundle, manifest.entry)), { createFolders: false });
if (manifest.style) zip.file(manifest.style, await readFile(join(bundle, manifest.style)), { createFolders: false });
await mkdir(bundle, { recursive: true });
const output = join(bundle, `${manifest.id}-${manifest.version}.zip`);
await writeFile(output, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } }));
console.log(`Created ${output}`);
