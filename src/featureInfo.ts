import type { MapLayerMouseEvent, MapLike } from "./host-api";

const activeCards = new WeakMap<MapLike, HTMLElement>();
const handlers = new WeakMap<MapLike, Array<{ layerId: string; handler: (event: MapLayerMouseEvent) => void }>>();

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === "" || /^<?null>?$/i.test(String(value))) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function displayLabel(key: string): string {
  return key.replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

function titleOf(properties: Record<string, unknown>): string {
  const entries = Object.entries(properties);
  for (const candidate of ["name", "site_name", "title", "fid"]) {
    const match = entries.find(([key, value]) => key.toLowerCase() === candidate && displayValue(value) !== "—");
    if (match) return displayValue(match[1]);
  }
  return "KML feature";
}

function valueElement(value: unknown): HTMLElement {
  const text = displayValue(value);
  if (/^https?:\/\/\S+$/i.test(text)) {
    const link = document.createElement("a");
    link.href = text;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = text;
    return link;
  }
  const span = document.createElement("span");
  span.textContent = text;
  return span;
}

export function createFeatureInfoCard(properties: Record<string, unknown>, sourceFilename: string): HTMLElement {
  const card = document.createElement("section");
  card.className = "kml-feature-card";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-label", `KML feature: ${titleOf(properties)}`);

  const header = document.createElement("header");
  const title = document.createElement("strong");
  title.textContent = titleOf(properties);
  const close = document.createElement("button");
  close.type = "button";
  close.className = "kml-feature-card-close";
  close.setAttribute("aria-label", "Close feature information");
  close.textContent = "×";
  header.append(title, close);

  const table = document.createElement("table");
  const body = document.createElement("tbody");
  for (const [key, value] of Object.entries(properties)) {
    if (key === "name" || key.startsWith("__")) continue;
    const row = document.createElement("tr");
    const label = document.createElement("th");
    label.scope = "row";
    label.textContent = displayLabel(key);
    const content = document.createElement("td");
    content.append(valueElement(value));
    row.append(label, content);
    body.append(row);
  }
  table.append(body);

  const footer = document.createElement("footer");
  footer.textContent = sourceFilename;
  card.append(header, table, footer);
  close.addEventListener("click", () => card.remove());
  return card;
}

function showCard(map: MapLike, event: MapLayerMouseEvent, sourceFilename: string): void {
  const feature = event.features?.[0];
  if (!feature?.properties) return;
  showKmlFeatureInfo(map, event.point, feature.properties, sourceFilename);
}

export function showKmlFeatureInfo(
  map: MapLike,
  point: { x: number; y: number },
  properties: Record<string, unknown>,
  sourceFilename: string,
): void {
  const container = map.getContainer?.();
  if (!container || map.getCanvas?.().style.cursor === "crosshair") return;
  activeCards.get(map)?.remove();
  const card = createFeatureInfoCard(properties, sourceFilename);
  card.style.visibility = "hidden";
  container.append(card);
  const margin = 12;
  const desiredLeft = point.x + margin;
  const desiredTop = point.y + margin;
  card.style.left = `${Math.max(margin, Math.min(desiredLeft, container.clientWidth - card.offsetWidth - margin))}px`;
  card.style.top = `${Math.max(margin, Math.min(desiredTop, container.clientHeight - card.offsetHeight - margin))}px`;
  card.style.visibility = "visible";
  activeCards.set(map, card);
}

export function registerKmlFeatureInfo(map: MapLike, layerIds: string[], sourceFilename: string): void {
  if (!map.on || !map.getContainer) return;
  const registered = handlers.get(map) ?? [];
  for (const layerId of layerIds) {
    const handler = (event: MapLayerMouseEvent) => showCard(map, event, sourceFilename);
    map.on("click", layerId, handler);
    registered.push({ layerId, handler });
  }
  handlers.set(map, registered);
}

export function clearKmlFeatureInfo(map?: MapLike | null): void {
  if (!map) return;
  for (const item of handlers.get(map) ?? []) map.off?.("click", item.layerId, item.handler);
  handlers.delete(map);
  activeCards.get(map)?.remove();
  activeCards.delete(map);
}
