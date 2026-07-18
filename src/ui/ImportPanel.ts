import type { GeoLibreAppAPI } from "../host-api";
import { importKmlKmz } from "../importer";
import { addParsedKmlToGeoLibre } from "../kmlToGeoLibre";
import type { ImportSummary, ImportWarning } from "../types";

export class ImportPanel {
  private status: HTMLElement | null = null;
  private results: HTMLElement | null = null;
  private input: HTMLInputElement | null = null;
  private networkLinks = false;

  constructor(private readonly app: GeoLibreAppAPI) {}

  render(container: HTMLElement): () => void {
    const root = document.createElement("div");
    root.className = "kml-import-panel";
    const intro = document.createElement("p");
    intro.textContent = "Import KML or KMZ as styled, usable GeoLibre layers. Files are parsed locally in your browser or desktop app.";
    const drop = document.createElement("button");
    drop.type = "button";
    drop.className = "kml-import-dropzone";
    drop.textContent = "Choose or drop a .kml / .kmz file";
    drop.addEventListener("click", () => this.openFilePicker());
    for (const eventName of ["dragenter", "dragover"]) drop.addEventListener(eventName, (event) => { event.preventDefault(); drop.classList.add("is-dragging"); });
    for (const eventName of ["dragleave", "drop"]) drop.addEventListener(eventName, (event) => { event.preventDefault(); drop.classList.remove("is-dragging"); });
    drop.addEventListener("drop", (event) => {
      const file = (event as DragEvent).dataTransfer?.files[0];
      if (file) void this.handleFile(file);
    });
    const networkLabel = document.createElement("label");
    networkLabel.className = "kml-import-option";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.addEventListener("change", () => { this.networkLinks = checkbox.checked; });
    networkLabel.append(checkbox, document.createTextNode(" Load linked HTTPS and in-archive KML resources (maximum depth 2)"));
    const security = document.createElement("p");
    security.className = "kml-import-note";
    security.textContent = "Safety limits: 100 MB input, 2,000 archive files, 250 MB extracted, no scripts or unsafe URL schemes.";
    this.status = document.createElement("div");
    this.status.className = "kml-import-status";
    this.status.setAttribute("role", "status");
    this.results = document.createElement("div");
    this.results.className = "kml-import-results";
    root.append(intro, drop, networkLabel, security, this.status, this.results);
    container.appendChild(root);
    return () => {
      root.remove();
      this.status = null;
      this.results = null;
      this.input?.remove();
      this.input = null;
    };
  }

  openFilePicker(): void {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".kml,.kmz,application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz";
    input.hidden = true;
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (file) void this.handleFile(file);
      input.remove();
      if (this.input === input) this.input = null;
    }, { once: true });
    document.body.appendChild(input);
    this.input = input;
    input.click();
  }

  private setStatus(message: string, kind: "working" | "success" | "error" = "working"): void {
    if (!this.status) return;
    this.status.textContent = message;
    this.status.dataset.kind = kind;
  }

  private async handleFile(file: File): Promise<void> {
    this.results?.replaceChildren();
    this.setStatus(`Reading ${file.name}…`);
    try {
      const parsed = await importKmlKmz(file, { loadNetworkLinks: this.networkLinks, onStatus: (message) => this.setStatus(message) });
      if (parsed.summary.features === 0 && parsed.summary.groundOverlays === 0) throw new Error("No supported geographic features or GroundOverlays were found.");
      this.setStatus(`Adding ${file.name} to GeoLibre…`);
      const added = await addParsedKmlToGeoLibre(this.app, parsed, file.name);
      this.setStatus(`${file.name} imported into ${added.layerIds.length} layer${added.layerIds.length === 1 ? "" : "s"}.`, "success");
      this.renderSummary(parsed.summary, added.warnings);
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : String(error), "error");
    }
  }

  private renderSummary(summary: ImportSummary, warnings: ImportWarning[]): void {
    if (!this.results) return;
    const title = document.createElement("h3");
    title.textContent = "Import summary";
    const list = document.createElement("ul");
    const rows: Array<[string, number]> = [
      ["points", summary.points], ["lines", summary.lines], ["polygons", summary.polygons],
      ["ground overlays", summary.groundOverlays], ["folders", summary.folders],
      ["shared styles / maps", summary.styles], ["unsupported 3D models", summary.models],
    ];
    for (const [label, value] of rows) {
      if (value === 0) continue;
      const item = document.createElement("li");
      item.textContent = `${value.toLocaleString()} ${label}`;
      list.appendChild(item);
    }
    this.results.append(title, list);
    if (warnings.length) {
      const details = document.createElement("details");
      const summaryElement = document.createElement("summary");
      summaryElement.textContent = `${warnings.length} warning${warnings.length === 1 ? "" : "s"}`;
      const warningList = document.createElement("ul");
      for (const warning of warnings) {
        const item = document.createElement("li");
        item.textContent = `${warning.count && warning.count > 1 ? `${warning.count}× ` : ""}${warning.message}`;
        warningList.appendChild(item);
      }
      details.append(summaryElement, warningList);
      this.results.appendChild(details);
    }
  }
}
