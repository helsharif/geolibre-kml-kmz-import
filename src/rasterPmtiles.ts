import type { RasterTilePyramid, RenderableRasterTile } from "./groundOverlayRasterTiles";

const HEADER_BYTES = 127;
const PMTILES_VERSION = 3;
const COMPRESSION_NONE = 1;
const TILE_TYPE_PNG = 2;
const objectUrls = new Set<string>();

interface DirectoryEntry {
  tileId: number;
  offset: number;
  length: number;
}

function rotate(size: number, x: number, y: number, rx: number, ry: number): [number, number] {
  if (ry !== 0) return [x, y];
  return rx !== 0 ? [size - 1 - y, size - 1 - x] : [y, x];
}

export function zxyToTileId(z: number, x: number, y: number): number {
  if (!Number.isInteger(z) || z < 0 || z > 26) throw new Error("PMTiles zoom must be an integer from 0 through 26");
  const dimension = 2 ** z;
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= dimension || y >= dimension) {
    throw new Error(`Tile ${z}/${x}/${y} is outside its zoom-level bounds`);
  }
  let tileId = (dimension * dimension - 1) / 3;
  let hilbertX = x;
  let hilbertY = y;
  let bit = z - 1;
  for (let scale = z === 0 ? 0 : 2 ** bit; scale > 0; scale >>= 1) {
    const rx = hilbertX & scale;
    const ry = hilbertY & scale;
    tileId += (3 * rx ^ ry) * 2 ** bit;
    [hilbertX, hilbertY] = rotate(scale, hilbertX, hilbertY, rx, ry);
    bit -= 1;
  }
  return tileId;
}

function appendVarint(output: number[], input: number): void {
  if (!Number.isSafeInteger(input) || input < 0) throw new Error(`Invalid PMTiles varint value: ${input}`);
  let value = input;
  while (value >= 128) {
    output.push(value % 128 + 128);
    value = Math.floor(value / 128);
  }
  output.push(value);
}

function serializeDirectory(entries: DirectoryEntry[]): Uint8Array {
  const output: number[] = [];
  appendVarint(output, entries.length);
  let previousTileId = 0;
  for (const entry of entries) {
    appendVarint(output, entry.tileId - previousTileId);
    previousTileId = entry.tileId;
  }
  for (let index = 0; index < entries.length; index += 1) appendVarint(output, 1);
  for (const entry of entries) appendVarint(output, entry.length);
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    const previous = entries[index - 1];
    appendVarint(output, previous && entry.offset === previous.offset + previous.length ? 0 : entry.offset + 1);
  }
  return Uint8Array.from(output);
}

function decodePngDataUrl(dataUrl: string): Uint8Array {
  const match = /^data:image\/png(?:;[^,]*)?;base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl);
  if (!match) throw new Error("Raster conversion produced a non-PNG tile");
  const binary = globalThis.atob(match[1]!.replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function setUint64(view: DataView, offset: number, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`PMTiles offset is outside JavaScript's safe range: ${value}`);
  view.setUint32(offset, value % 2 ** 32, true);
  view.setUint32(offset + 4, Math.floor(value / 2 ** 32), true);
}

function coordinate(value: number): number {
  return Math.max(-2_147_483_648, Math.min(2_147_483_647, Math.round(value * 1e7)));
}

function tileRecord(tile: RenderableRasterTile): { tileId: number; bytes: Uint8Array } {
  return { tileId: zxyToTileId(tile.z, tile.x, tile.y), bytes: decodePngDataUrl(tile.imageUrl) };
}

export function buildRasterPmtiles(pyramid: RasterTilePyramid, name: string): Uint8Array {
  if (!pyramid.tiles.length) throw new Error("Cannot create an empty PMTiles raster archive");
  const records = pyramid.tiles.map(tileRecord).sort((a, b) => a.tileId - b.tileId);
  for (let index = 1; index < records.length; index += 1) {
    if (records[index - 1]!.tileId === records[index]!.tileId) throw new Error("Raster conversion produced duplicate PMTiles tile coordinates");
  }

  let tileDataLength = 0;
  const entries = records.map((record) => {
    const entry = { tileId: record.tileId, offset: tileDataLength, length: record.bytes.byteLength };
    tileDataLength += record.bytes.byteLength;
    return entry;
  });
  const root = serializeDirectory(entries);
  const metadata = new TextEncoder().encode(JSON.stringify({ name, format: "png", type: "overlay" }));
  const rootOffset = HEADER_BYTES;
  const metadataOffset = rootOffset + root.byteLength;
  const tileDataOffset = metadataOffset + metadata.byteLength;
  const archive = new Uint8Array(tileDataOffset + tileDataLength);
  archive.set(root, rootOffset);
  archive.set(metadata, metadataOffset);
  let writeOffset = tileDataOffset;
  for (const record of records) {
    archive.set(record.bytes, writeOffset);
    writeOffset += record.bytes.byteLength;
  }

  archive.set(new TextEncoder().encode("PMTiles"), 0);
  const view = new DataView(archive.buffer);
  view.setUint8(7, PMTILES_VERSION);
  setUint64(view, 8, rootOffset);
  setUint64(view, 16, root.byteLength);
  setUint64(view, 24, metadataOffset);
  setUint64(view, 32, metadata.byteLength);
  setUint64(view, 40, tileDataOffset);
  setUint64(view, 48, 0);
  setUint64(view, 56, tileDataOffset);
  setUint64(view, 64, tileDataLength);
  setUint64(view, 72, entries.length);
  setUint64(view, 80, entries.length);
  setUint64(view, 88, entries.length);
  view.setUint8(96, 1);
  view.setUint8(97, COMPRESSION_NONE);
  view.setUint8(98, COMPRESSION_NONE);
  view.setUint8(99, TILE_TYPE_PNG);
  const zooms = pyramid.tiles.map((tile) => tile.z);
  view.setUint8(100, Math.min(...zooms));
  view.setUint8(101, Math.max(...zooms));
  const [west, south, east, north] = pyramid.bounds;
  view.setInt32(102, coordinate(west), true);
  view.setInt32(106, coordinate(south), true);
  view.setInt32(110, coordinate(east), true);
  view.setInt32(114, coordinate(north), true);
  view.setUint8(118, Math.min(pyramid.targetZoom, 255));
  view.setInt32(119, coordinate((west + east) / 2), true);
  view.setInt32(123, coordinate((south + north) / 2), true);
  return archive;
}

export function createRasterPmtilesUrl(pyramid: RasterTilePyramid, name: string): { url: string; byteLength: number } {
  const bytes = buildRasterPmtiles(pyramid, name);
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const url = URL.createObjectURL(new Blob([buffer], { type: "application/vnd.pmtiles" }));
  objectUrls.add(url);
  return { url, byteLength: bytes.byteLength };
}

export function releaseRasterPmtilesUrl(url: string): void {
  URL.revokeObjectURL(url);
  objectUrls.delete(url);
}

export function revokeRasterPmtilesUrls(): void {
  for (const url of objectUrls) URL.revokeObjectURL(url);
  objectUrls.clear();
}
