import type { AssetResolver } from "./types";

export function normalizeArchivePath(path: string, basePath = ""): string | undefined {
  const cleaned = path.replace(/\\/g, "/").split(/[?#]/, 1)[0] ?? "";
  if (!cleaned || cleaned.startsWith("/") || /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(cleaned)) return undefined;
  const base = basePath.replace(/\\/g, "/").split("/").filter(Boolean);
  if (base.length > 0 && !basePath.endsWith("/")) base.pop();
  const parts = [...base];
  for (const part of cleaned.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return undefined;
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join("/");
}

export function mimeTypeForPath(path: string): string {
  const extension = path.toLowerCase().split(".").at(-1);
  return ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", kml: "application/vnd.google-earth.kml+xml", kmz: "application/vnd.google-earth.kmz" } as Record<string, string>)[extension ?? ""] ?? "application/octet-stream";
}

export function bytesToDataUrl(bytes: Uint8Array, mimeType: string): string {
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

export class EmptyAssetResolver implements AssetResolver {
  async resolve(href: string): Promise<string | undefined> {
    try {
      const url = new URL(href);
      return ["https:", "http:"].includes(url.protocol) ? url.href : undefined;
    } catch {
      return undefined;
    }
  }
}
