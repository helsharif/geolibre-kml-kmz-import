import JSZip, { type JSZipObject } from "jszip";
import { bytesToDataUrl, mimeTypeForPath, normalizeArchivePath } from "./assetResolver";
import type { AssetResolver } from "./types";

export const KMZ_LIMITS = {
  maxCompressedBytes: 100 * 1024 * 1024,
  maxEntries: 2_000,
  maxEntryBytes: 100 * 1024 * 1024,
  maxTotalUncompressedBytes: 250 * 1024 * 1024,
  maxCompressionRatio: 1_000,
  maxAssetBytes: 10 * 1024 * 1024,
};

interface ZipMetrics { compressedSize?: number; uncompressedSize?: number }

function metrics(file: JSZipObject): ZipMetrics {
  const data = (file as unknown as { _data?: ZipMetrics })._data;
  return data ?? {};
}

export class KmzArchive implements AssetResolver {
  readonly zip: JSZip;
  readonly files: Map<string, JSZipObject>;
  readonly primaryKmlPath: string;
  private readonly assetCache = new Map<string, Promise<string | undefined>>();

  private constructor(zip: JSZip, files: Map<string, JSZipObject>, primaryKmlPath: string) {
    this.zip = zip;
    this.files = files;
    this.primaryKmlPath = primaryKmlPath;
  }

  static async open(data: ArrayBuffer | Uint8Array): Promise<KmzArchive> {
    const byteLength = data.byteLength;
    if (byteLength > KMZ_LIMITS.maxCompressedBytes) throw new Error(`KMZ exceeds the ${KMZ_LIMITS.maxCompressedBytes / 1024 / 1024} MB compressed-size limit.`);
    let zip: JSZip;
    try {
      // Keep extraction lazy. checkCRC32=true eagerly inflates every DAE/image in
      // a KMZ before parsing can begin; structural corruption is still rejected
      // by JSZip and referenced entries fail when they are extracted on demand.
      zip = await JSZip.loadAsync(data, { checkCRC32: false, createFolders: false });
    } catch (error) {
      throw new Error(`The KMZ archive is corrupted or unsupported: ${error instanceof Error ? error.message : String(error)}`);
    }
    const entries = Object.values(zip.files).filter((entry) => !entry.dir);
    if (entries.length > KMZ_LIMITS.maxEntries) throw new Error(`KMZ contains ${entries.length} files; the limit is ${KMZ_LIMITS.maxEntries}.`);
    const files = new Map<string, JSZipObject>();
    let totalUncompressed = 0;
    for (const entry of entries) {
      const originalName = (entry as JSZipObject & { unsafeOriginalName?: string }).unsafeOriginalName ?? entry.name;
      const safeOriginal = normalizeArchivePath(originalName);
      if (!safeOriginal || safeOriginal !== originalName.replace(/\\/g, "/")) throw new Error(`KMZ contains an unsafe archive path: ${originalName}`);
      const info = metrics(entry);
      const uncompressed = info.uncompressedSize ?? 0;
      const compressed = info.compressedSize ?? 0;
      if (uncompressed > KMZ_LIMITS.maxEntryBytes) throw new Error(`KMZ entry ${entry.name} exceeds the per-file extraction limit.`);
      if (compressed > 0 && uncompressed / compressed > KMZ_LIMITS.maxCompressionRatio) throw new Error(`KMZ entry ${entry.name} exceeds the compression-ratio limit.`);
      totalUncompressed += uncompressed;
      if (totalUncompressed > KMZ_LIMITS.maxTotalUncompressedBytes) throw new Error("KMZ exceeds the total uncompressed-size limit.");
      files.set(entry.name.toLowerCase(), entry);
    }
    const kmlEntries = entries.filter((entry) => entry.name.toLowerCase().endsWith(".kml"));
    if (kmlEntries.length === 0) throw new Error("The KMZ archive does not contain a KML document.");
    kmlEntries.sort((a, b) => {
      const aDoc = a.name.toLowerCase() === "doc.kml" ? -1 : 0;
      const bDoc = b.name.toLowerCase() === "doc.kml" ? -1 : 0;
      return aDoc - bDoc || a.name.split("/").length - b.name.split("/").length || a.name.localeCompare(b.name);
    });
    return new KmzArchive(zip, files, kmlEntries[0]!.name);
  }

  has(href: string, basePath = this.primaryKmlPath): boolean {
    const path = normalizeArchivePath(href, basePath);
    return path ? this.files.has(path.toLowerCase()) : false;
  }

  async readText(path = this.primaryKmlPath): Promise<string> {
    const entry = this.files.get(path.toLowerCase());
    if (!entry) throw new Error(`Archive file not found: ${path}`);
    const bytes = await entry.async("uint8array");
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }

  async readBytes(path: string): Promise<Uint8Array> {
    const entry = this.files.get(path.toLowerCase());
    if (!entry) throw new Error(`Archive file not found: ${path}`);
    return entry.async("uint8array");
  }

  async resolve(href: string, basePath = this.primaryKmlPath): Promise<string | undefined> {
    try {
      const url = new URL(href);
      return ["https:", "http:"].includes(url.protocol) ? url.href : undefined;
    } catch {
      const path = normalizeArchivePath(href, basePath);
      if (!path) return undefined;
      const key = path.toLowerCase();
      const cached = this.assetCache.get(key);
      if (cached) return cached;
      const pending = this.resolveArchiveAsset(path, key);
      this.assetCache.set(key, pending);
      return pending;
    }
  }

  private async resolveArchiveAsset(path: string, key: string): Promise<string | undefined> {
    const entry = this.files.get(key);
    if (!entry) return undefined;
    const info = metrics(entry);
    if ((info.uncompressedSize ?? 0) > KMZ_LIMITS.maxAssetBytes) return undefined;
    const bytes = await entry.async("uint8array");
    if (bytes.byteLength > KMZ_LIMITS.maxAssetBytes) return undefined;
    return bytesToDataUrl(bytes, mimeTypeForPath(path));
  }
}
