import type { FeatureCollection, Geometry } from "geojson";
import { EmptyAssetResolver, normalizeArchivePath } from "./assetResolver";
import { parseKml } from "./kmlParser";
import { KmzArchive } from "./kmzArchive";
import type { ImportSummary, ImportWarning, KmlFeatureProperties, ParsedKml } from "./types";

export interface ImportOptions {
  loadNetworkLinks?: boolean;
  maxNetworkDepth?: number;
  maxNetworkResources?: number;
  onStatus?(message: string): void;
}

function isZip(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b;
}

function emptySummary(): ImportSummary {
  return { points: 0, lines: 0, polygons: 0, groundOverlays: 0, folders: 0, styles: 0, models: 0, networkLinks: 0, features: 0 };
}

function merge(target: ParsedKml, source: ParsedKml): void {
  target.featureCollection.features.push(...source.featureCollection.features);
  target.overlays.push(...source.overlays);
  target.networkLinks.push(...source.networkLinks);
  target.models.push(...source.models);
  target.warnings.push(...source.warnings);
  for (const key of Object.keys(target.summary) as Array<keyof ImportSummary>) target.summary[key] += source.summary[key];
}

async function parseBytes(bytes: Uint8Array, filename: string): Promise<{ parsed: ParsedKml; archive?: KmzArchive }> {
  if (isZip(bytes) || filename.toLowerCase().endsWith(".kmz")) {
    const archive = await KmzArchive.open(bytes);
    const parsed = await parseKml(await archive.readText(), { sourceFilename: filename, basePath: archive.primaryKmlPath, assetResolver: archive });
    return { parsed, archive };
  }
  const xml = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  return { parsed: await parseKml(xml, { sourceFilename: filename, assetResolver: new EmptyAssetResolver() }) };
}

export async function importKmlKmz(file: File, options: ImportOptions = {}): Promise<ParsedKml> {
  if (!/\.(?:kml|kmz)$/i.test(file.name)) throw new Error("Choose a .kml or .kmz file.");
  if (file.size > 100 * 1024 * 1024) throw new Error("The selected file exceeds the 100 MB input limit.");
  options.onStatus?.(`Reading ${file.name}…`);
  const initial = await parseBytes(new Uint8Array(await file.arrayBuffer()), file.name);
  const result = initial.parsed;
  if (!options.loadNetworkLinks || result.networkLinks.length === 0) return result;

  const maxDepth = Math.min(5, Math.max(0, options.maxNetworkDepth ?? 2));
  const maxResources = Math.min(50, Math.max(1, options.maxNetworkResources ?? 10));
  const visited = new Set<string>();
  let loaded = 0;

  const loadLinks = async (parsed: ParsedKml, archive: KmzArchive | undefined, basePath: string | undefined, depth: number): Promise<void> => {
    if (depth >= maxDepth) return;
    for (const link of parsed.networkLinks) {
      if (!link.href || loaded >= maxResources) break;
      let child: { parsed: ParsedKml; archive?: KmzArchive } | undefined;
      try {
        if (link.kind === "archive" && archive) {
          const path = normalizeArchivePath(link.href, basePath ?? archive.primaryKmlPath);
          if (!path || !archive.has(path, "")) continue;
          const key = `archive:${path.toLowerCase()}`;
          if (visited.has(key)) continue;
          visited.add(key);
          loaded += 1;
          options.onStatus?.(`Loading linked archive resource ${path}…`);
          if (path.toLowerCase().endsWith(".kml")) {
            child = { parsed: await parseKml(await archive.readText(path), { sourceFilename: path.split("/").at(-1) ?? path, basePath: path, assetResolver: archive }), archive };
          } else {
            child = await parseBytes(await archive.readBytes(path), path.split("/").at(-1) ?? path);
          }
        } else if (link.kind === "https") {
          const url = new URL(link.href);
          if (url.protocol !== "https:") {
            result.warnings.push({ code: "network-link", message: `NetworkLink was not fetched because only HTTPS is allowed: ${link.href}` });
            continue;
          }
          const key = url.href;
          if (visited.has(key)) continue;
          visited.add(key);
          loaded += 1;
          options.onStatus?.(`Loading linked KML resource ${url.hostname}…`);
          const response = await fetch(url.href, { credentials: "omit", redirect: "follow" });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const declaredLength = Number(response.headers.get("content-length") ?? 0);
          if (declaredLength > 20 * 1024 * 1024) throw new Error("linked resource exceeds the 20 MB limit");
          const bytes = new Uint8Array(await response.arrayBuffer());
          if (bytes.byteLength > 20 * 1024 * 1024) throw new Error("linked resource exceeds the 20 MB limit");
          child = await parseBytes(bytes, url.pathname.split("/").at(-1) || "linked.kml");
        }
        if (child) {
          merge(result, child.parsed);
          await loadLinks(child.parsed, child.archive, child.archive?.primaryKmlPath, depth + 1);
        }
      } catch (error) {
        result.warnings.push({ code: "network-link", message: `NetworkLink “${link.name}” could not be loaded: ${error instanceof Error ? error.message : String(error)}` });
      }
    }
  };
  await loadLinks(initial.parsed, initial.archive, initial.archive?.primaryKmlPath, 0);
  if (loaded >= maxResources) result.warnings.push({ code: "security-limit", message: `NetworkLink loading stopped at the ${maxResources}-resource safety limit.` });
  return result;
}

export function emptyParsedKml(): ParsedKml {
  return { featureCollection: { type: "FeatureCollection", features: [] } as FeatureCollection<Geometry, KmlFeatureProperties>, overlays: [], networkLinks: [], models: [], warnings: [] as ImportWarning[], summary: emptySummary() };
}
