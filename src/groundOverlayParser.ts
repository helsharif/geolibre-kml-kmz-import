import type { GroundOverlay, ImportWarning, ParseOptions } from "./types";
import { convertKmlColor } from "./styleParser";
import { childrenNamed, firstChild, numberOf, textOf } from "./xml";

type Quad = [[number, number], [number, number], [number, number], [number, number]];

function rotateBounds(bounds: [number, number, number, number], angleDegrees: number): Quad {
  const [west, south, east, north] = bounds;
  const centerX = (west + east) / 2;
  const centerY = (south + north) / 2;
  const angle = angleDegrees * Math.PI / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const rotate = ([x, y]: [number, number]): [number, number] => {
    const dx = x - centerX;
    const dy = y - centerY;
    return [centerX + dx * cos - dy * sin, centerY + dx * sin + dy * cos];
  };
  return [rotate([west, north]), rotate([east, north]), rotate([east, south]), rotate([west, south])];
}

function parseLatLonQuad(element: Element): Quad | undefined {
  const coordinates = textOf(element, "coordinates")?.trim().split(/\s+/).map((item) => item.split(",").slice(0, 2).map(Number) as [number, number]);
  if (!coordinates || coordinates.length !== 4 || coordinates.some((item) => item.some((value) => !Number.isFinite(value)))) return undefined;
  const [lowerLeft, lowerRight, upperRight, upperLeft] = coordinates;
  return upperLeft && upperRight && lowerRight && lowerLeft ? [upperLeft, upperRight, lowerRight, lowerLeft] : undefined;
}

export async function parseGroundOverlay(element: Element, folderPath: string, options: ParseOptions, warnings: ImportWarning[], parentVisible = true): Promise<GroundOverlay> {
  const icon = firstChild(element, "Icon");
  const href = icon ? textOf(icon, "href") : undefined;
  const box = firstChild(element, "LatLonBox");
  const west = box ? numberOf(box, "west") : undefined;
  const south = box ? numberOf(box, "south") : undefined;
  const east = box ? numberOf(box, "east") : undefined;
  const north = box ? numberOf(box, "north") : undefined;
  const bounds = [west, south, east, north].every((value) => value !== undefined)
    ? [west!, south!, east!, north!] as [number, number, number, number]
    : undefined;
  const rotation = box ? numberOf(box, "rotation") ?? 0 : 0;
  const quadElement = childrenNamed(element, "LatLonQuad")[0] ?? Array.from(element.querySelectorAll("*")).find((item) => item.localName === "LatLonQuad");
  let coordinates = quadElement ? parseLatLonQuad(quadElement) : undefined;
  if (!coordinates && bounds) coordinates = rotateBounds(bounds, rotation);
  if (!bounds && !coordinates) warnings.push({ code: "invalid-geometry", message: `GroundOverlay “${textOf(element, "name") ?? "Unnamed overlay"}” has no valid LatLonBox or gx:LatLonQuad.` });
  const imageUrl = href ? await options.assetResolver?.resolve(href, options.basePath) : undefined;
  if (href && !imageUrl) warnings.push({ code: "missing-asset", message: `GroundOverlay image could not be resolved: ${href}` });
  if (!href) warnings.push({ code: "missing-asset", message: "A GroundOverlay has no image href." });
  if (rotation !== 0) warnings.push({ code: "partial-support", message: "A rotated GroundOverlay was approximated with MapLibre image-source coordinates." });
  const color = convertKmlColor(textOf(element, "color"));
  return {
    name: textOf(element, "name") ?? "Ground overlay",
    href,
    imageUrl,
    bounds,
    coordinates,
    rotation,
    drawOrder: numberOf(element, "drawOrder") ?? 0,
    opacity: color?.opacity ?? 1,
    folderPath,
    visible: parentVisible && textOf(element, "visibility") !== "0" && textOf(element, "visibility")?.toLowerCase() !== "false",
  };
}
