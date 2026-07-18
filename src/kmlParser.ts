import type { FeatureCollection, Geometry } from "geojson";
import { combineLikeGeometries, countGeometry, parseGeometryElements } from "./geometry";
import { extractDescriptionFields } from "./descriptionFields";
import { parseGroundOverlay } from "./groundOverlayParser";
import { parseNetworkLink } from "./networkLinkParser";
import { escapeHtmlAsText, sanitizeHtml } from "./security";
import { parseStyleCatalog, resolveStyle } from "./styleParser";
import type { GroundOverlay, ImportSummary, ImportWarning, KmlFeature, KmlFeatureProperties, KmlModel, NetworkLinkInfo, ParseOptions, ParsedKml } from "./types";
import { childrenNamed, descendantsNamed, firstChild, localName, numberOf, parseXml, textOf } from "./xml";

function baseProperties(element: Element, folderPath: string, options: ParseOptions, plainTextDescriptions: boolean): KmlFeatureProperties {
  const properties: KmlFeatureProperties = { folderPath, sourceFilename: options.sourceFilename };
  for (const key of ["name", "address", "phoneNumber", "visibility", "open", "snippet"] as const) {
    const value = textOf(element, key);
    if (value !== undefined) properties[key] = value;
  }
  const description = textOf(element, "description");
  if (description) {
    const descriptionFields = extractDescriptionFields(description);
    if (descriptionFields) {
      Object.assign(properties, descriptionFields);
    } else {
      properties.description = plainTextDescriptions ? escapeHtmlAsText(description) : sanitizeHtml(description);
      if (plainTextDescriptions) properties.descriptionFormat = "escaped-text";
    }
  }
  const extendedData = firstChild(element, "ExtendedData");
  if (extendedData) {
    const values: Record<string, unknown> = {};
    for (const data of childrenNamed(extendedData, "Data")) {
      const name = data.getAttribute("name");
      if (name) values[name] = textOf(data, "value") ?? "";
    }
    for (const schemaData of childrenNamed(extendedData, "SchemaData")) {
      const schemaUrl = schemaData.getAttribute("schemaUrl");
      if (schemaUrl) properties.schemaUrl = schemaUrl;
      for (const simple of childrenNamed(schemaData, "SimpleData")) {
        const name = simple.getAttribute("name");
        if (name) values[name] = simple.textContent?.trim() ?? "";
      }
    }
    properties.extendedData = values;
    Object.assign(properties, values);
  }
  const timestamp = firstChild(element, "TimeStamp");
  const timespan = firstChild(element, "TimeSpan");
  if (timestamp) properties.when = textOf(timestamp, "when");
  if (timespan) {
    properties.begin = textOf(timespan, "begin");
    properties.end = textOf(timespan, "end");
  }
  for (const viewName of ["LookAt", "Camera", "Region"] as const) {
    const view = firstChild(element, viewName);
    if (view) properties[viewName.toLowerCase()] = Object.fromEntries(Array.from(view.children).map((child) => [localName(child), child.textContent?.trim()]));
  }
  return properties;
}

function parseModel(element: Element, placemark: Element, folderPath: string): KmlModel {
  const location = firstChild(element, "Location");
  const orientation = firstChild(element, "Orientation");
  const scale = firstChild(element, "Scale");
  const link = firstChild(element, "Link");
  return {
    name: textOf(placemark, "name") ?? "3D model",
    folderPath,
    href: link ? textOf(link, "href") : undefined,
    longitude: location ? numberOf(location, "longitude") : undefined,
    latitude: location ? numberOf(location, "latitude") : undefined,
    altitude: location ? numberOf(location, "altitude") : undefined,
    altitudeMode: textOf(element, "altitudeMode"),
    heading: orientation ? numberOf(orientation, "heading") : undefined,
    tilt: orientation ? numberOf(orientation, "tilt") : undefined,
    roll: orientation ? numberOf(orientation, "roll") : undefined,
    scaleX: scale ? numberOf(scale, "x") : undefined,
    scaleY: scale ? numberOf(scale, "y") : undefined,
    scaleZ: scale ? numberOf(scale, "z") : undefined,
  };
}

function aggregateWarnings(warnings: ImportWarning[]): ImportWarning[] {
  const grouped = new Map<string, ImportWarning>();
  for (const warning of warnings) {
    const key = `${warning.code}\0${warning.message}`;
    const existing = grouped.get(key);
    if (existing) existing.count = (existing.count ?? 1) + 1;
    else grouped.set(key, { ...warning, count: warning.count ?? 1 });
  }
  return [...grouped.values()];
}

export async function parseKml(xml: string, options: ParseOptions): Promise<ParsedKml> {
  const document = parseXml(xml);
  const catalog = parseStyleCatalog(document);
  const warnings: ImportWarning[] = [];
  const features: KmlFeature[] = [];
  const overlays: GroundOverlay[] = [];
  const networkLinks: NetworkLinkInfo[] = [];
  const models: KmlModel[] = [];
  const folders = new Set<string>();
  const root = document.documentElement;
  const top = Array.from(root.children).find((element) => ["Document", "Folder"].includes(localName(element))) ?? root;
  const documentName = textOf(top, "name");
  const plainTextDescriptions = xml.length > 5 * 1024 * 1024;
  if (plainTextDescriptions && descendantsNamed(root, "description").length > 0) {
    warnings.push({ code: "partial-support", message: "Non-tabular descriptions in this large KML use escaped plain text to keep importing responsive; two-column attribute tables are retained as fields." });
  }

  const visibleValue = (value: string | undefined): boolean => value !== "0" && value?.toLowerCase() !== "false";
  const visit = async (container: Element, path: string[], parentVisible: boolean): Promise<void> => {
    const containerName = ["Document", "Folder"].includes(localName(container)) ? textOf(container, "name") : undefined;
    const nextPath = containerName ? [...path, containerName] : path;
    const folderPath = nextPath.join(" / ");
    const containerVisible = parentVisible && visibleValue(textOf(container, "visibility"));
    if (localName(container) === "Folder" && folderPath) folders.add(folderPath);
    for (const child of Array.from(container.children)) {
      const name = localName(child);
      if (name === "Document" || name === "Folder") {
        await visit(child, nextPath, containerVisible);
      } else if (name === "Placemark") {
        const properties = baseProperties(child, folderPath, options, plainTextDescriptions);
        properties.__kmlVisible = containerVisible && visibleValue(textOf(child, "visibility"));
        const styleUrl = textOf(child, "styleUrl");
        const style = resolveStyle(styleUrl, firstChild(child, "Style"), catalog);
        if (styleUrl) properties.styleUrl = styleUrl;
        if (style?.iconHref && options.assetResolver) {
          const resolved = await options.assetResolver.resolve(style.iconHref, options.basePath);
          if (resolved) style.iconHref = resolved;
          else warnings.push({ code: "missing-asset", message: `Marker icon could not be resolved: ${style.iconHref}` });
        }
        if (style) properties.__kmlStyle = style;
        const parsed = combineLikeGeometries(parseGeometryElements(child, warnings));
        for (const item of parsed) {
          const itemProperties = { ...properties };
          if (item.altitudeMode) itemProperties.altitudeMode = item.altitudeMode;
          if (item.altitudeOffset !== undefined) itemProperties.altitudeOffset = item.altitudeOffset;
          if (item.extrude !== undefined) itemProperties.extrude = item.extrude;
          if (item.tessellate !== undefined) itemProperties.tessellate = item.tessellate;
          if (item.trackWhen) itemProperties.trackWhen = item.trackWhen;
          features.push({ type: "Feature", geometry: item.geometry, properties: itemProperties });
        }
        for (const modelElement of childrenNamed(child, "Model")) models.push(parseModel(modelElement, child, folderPath));
      } else if (name === "GroundOverlay") {
        overlays.push(await parseGroundOverlay(child, folderPath, options, warnings));
      } else if (name === "NetworkLink") {
        networkLinks.push(parseNetworkLink(child, folderPath));
      }
    }
  };
  await visit(top, [], true);

  const unsupported: Array<[string, string]> = [
    ["ScreenOverlay", "ScreenOverlay"], ["PhotoOverlay", "PhotoOverlay"], ["Tour", "gx:Tour"],
    ["NetworkLinkControl", "NetworkLinkControl"], ["Model", "COLLADA Model"],
  ];
  for (const [tag, label] of unsupported) {
    const count = descendantsNamed(root, tag).length;
    if (count) warnings.push({ code: "unsupported-feature", message: `${count} ${label}${count === 1 ? " was" : "s were"} detected but cannot be displayed as 2D GeoJSON.`, count });
  }
  for (const link of networkLinks) {
    const detail = link.kind === "unsafe" ? "uses an unsafe or unsupported URL" : "was detected; linked content is not loaded unless the user enables NetworkLink loading";
    warnings.push({ code: "network-link", message: `NetworkLink “${link.name}” ${detail}.` });
  }

  const summary: ImportSummary = { points: 0, lines: 0, polygons: 0, groundOverlays: overlays.length, folders: folders.size, styles: catalog.styles.size + catalog.styleMaps.size, models: models.length, networkLinks: networkLinks.length, features: features.length };
  for (const feature of features) {
    const count = countGeometry(feature.geometry);
    summary.points += count.points;
    summary.lines += count.lines;
    summary.polygons += count.polygons;
  }
  return {
    featureCollection: { type: "FeatureCollection", features } as FeatureCollection<Geometry, KmlFeatureProperties>,
    overlays,
    networkLinks,
    models,
    warnings: aggregateWarnings(warnings),
    summary,
    documentName,
  };
}
