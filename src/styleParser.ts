import type { KmlColor, KmlStyle } from "./types";
import { booleanOf, childrenNamed, firstChild, numberOf, textOf } from "./xml";

export function convertKmlColor(input?: string): KmlColor | undefined {
  if (!input) return undefined;
  const raw = input.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{8}$/.test(raw)) return undefined;
  const alpha = Number.parseInt(raw.slice(0, 2), 16);
  const blue = raw.slice(2, 4);
  const green = raw.slice(4, 6);
  const red = raw.slice(6, 8);
  const hex = `#${red}${green}${blue}`.toLowerCase();
  return { raw: input, hex, opacity: alpha / 255, css: `rgba(${Number.parseInt(red, 16)}, ${Number.parseInt(green, 16)}, ${Number.parseInt(blue, 16)}, ${(alpha / 255).toFixed(3)})` };
}

export function parseStyle(element: Element): KmlStyle {
  const icon = firstChild(element, "IconStyle");
  const label = firstChild(element, "LabelStyle");
  const line = firstChild(element, "LineStyle");
  const poly = firstChild(element, "PolyStyle");
  return {
    id: element.getAttribute("id") || undefined,
    iconHref: icon ? textOf(firstChild(icon, "Icon") ?? icon, "href") : undefined,
    iconScale: icon ? numberOf(icon, "scale") : undefined,
    iconHeading: icon ? numberOf(icon, "heading") : undefined,
    labelColor: label ? convertKmlColor(textOf(label, "color")) : undefined,
    labelScale: label ? numberOf(label, "scale") : undefined,
    lineColor: line ? convertKmlColor(textOf(line, "color")) : undefined,
    lineWidth: line ? numberOf(line, "width") : undefined,
    polyColor: poly ? convertKmlColor(textOf(poly, "color")) : undefined,
    fill: poly ? booleanOf(poly, "fill") : undefined,
    outline: poly ? booleanOf(poly, "outline") : undefined,
  };
}

export interface StyleCatalog {
  styles: Map<string, KmlStyle>;
  styleMaps: Map<string, string>;
}

export function parseStyleCatalog(document: Document): StyleCatalog {
  const styles = new Map<string, KmlStyle>();
  const styleMaps = new Map<string, string>();
  for (const element of Array.from(document.querySelectorAll("[id]"))) {
    const id = element.getAttribute("id");
    if (!id) continue;
    if (element.localName === "Style") styles.set(`#${id}`, parseStyle(element));
    if (element.localName === "StyleMap") {
      const pairs = childrenNamed(element, "Pair");
      const normal = pairs.find((pair) => textOf(pair, "key") === "normal") ?? pairs[0];
      const target = normal ? textOf(normal, "styleUrl") : undefined;
      if (target) styleMaps.set(`#${id}`, target);
    }
  }
  return { styles, styleMaps };
}

export function resolveStyle(styleUrl: string | undefined, inline: Element | undefined, catalog: StyleCatalog): KmlStyle | undefined {
  const inlineStyle = inline ? parseStyle(inline) : undefined;
  let resolvedUrl = styleUrl;
  const seen = new Set<string>();
  while (resolvedUrl && catalog.styleMaps.has(resolvedUrl) && !seen.has(resolvedUrl)) {
    seen.add(resolvedUrl);
    resolvedUrl = catalog.styleMaps.get(resolvedUrl);
  }
  const shared = resolvedUrl ? catalog.styles.get(resolvedUrl) : undefined;
  return shared || inlineStyle ? { ...shared, ...inlineStyle } : undefined;
}
