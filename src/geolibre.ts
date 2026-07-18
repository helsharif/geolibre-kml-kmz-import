import type { GeoLibreAppAPI, GeoLibrePlugin, MapControlPosition } from "./host-api";
import { clearKmlFeatureInfo } from "./featureInfo";
import { ImportControl } from "./ui/ImportControl";
import { ImportPanel } from "./ui/ImportPanel";
import "./style.css";

const PANEL_ID = "kml-kmz-import-panel";
const MENU_ID = "kml-kmz-import-menu";
let control: ImportControl | null = null;
let panel: ImportPanel | null = null;
let position: MapControlPosition = "top-right";
let disposePanel: (() => void) | null = null;
let disposeMenu: (() => void) | null = null;

function openImporter(app: GeoLibreAppAPI): void {
  if (!app.openRightPanel?.(PANEL_ID)) panel?.openFilePicker();
}

export const plugin: GeoLibrePlugin = {
  id: "kml-kmz-import",
  name: "KML / KMZ Import",
  version: "0.2.1",
  activate(app) {
    panel = new ImportPanel(app);
    disposePanel = app.registerRightPanel?.({
      id: PANEL_ID,
      title: "Import KML / KMZ",
      dock: "replace-style",
      defaultWidth: 360,
      render: (container) => panel?.render(container),
    }) ?? null;
    disposeMenu = app.registerToolbarMenu?.({
      id: MENU_ID,
      label: "KML / KMZ",
      items: [{ id: "import", label: "Import KML / KMZ…", onSelect: () => openImporter(app) }],
    }) ?? null;
    control = new ImportControl(() => openImporter(app));
    if (!app.addMapControl(control, position)) {
      disposeMenu?.();
      disposePanel?.();
      panel = null;
      control = null;
      return false;
    }
  },
  deactivate(app) {
    clearKmlFeatureInfo(app.getMap?.());
    disposeMenu?.();
    disposeMenu = null;
    disposePanel?.();
    disposePanel = null;
    app.closeRightPanel?.(PANEL_ID);
    if (control) app.removeMapControl(control);
    control = null;
    panel = null;
  },
  getMapControlPosition: () => position,
  setMapControlPosition(app, nextPosition) {
    position = nextPosition;
    if (!control) return;
    app.removeMapControl(control);
    if (!app.addMapControl(control, position)) {
      control = null;
      return false;
    }
  },
};

export default plugin;
