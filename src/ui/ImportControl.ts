import type { GeoLibreControl } from "../host-api";

export class ImportControl implements GeoLibreControl {
  private container: HTMLElement | null = null;

  constructor(private readonly onOpen: () => void) {}

  onAdd(): HTMLElement {
    const container = document.createElement("div");
    container.className = "maplibregl-ctrl maplibregl-ctrl-group kml-import-control";
    const button = document.createElement("button");
    button.type = "button";
    button.title = "Import KML / KMZ";
    button.setAttribute("aria-label", "Import KML / KMZ");
    button.textContent = "KML";
    button.addEventListener("click", this.onOpen);
    container.appendChild(button);
    this.container = container;
    return container;
  }

  onRemove(): void {
    this.container?.remove();
    this.container = null;
  }
}
