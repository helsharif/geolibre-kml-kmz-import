# Verified GeoLibre plugin APIs

Verified against the current `opengeos/GeoLibre`, `opengeos/geolibre-plugins`, `opengeos/geolibre-plugin-template`, and <https://geolibre.app/plugin-api/> on 2026-07-18.

## Manifest and packaging

An external plugin ZIP contains a root `plugin.json`. `entry` and optional `style` are relative forward-slash paths without leading `/`, backslashes, or `..`. The ESM entry must be self-contained and export either `default` or named `plugin`. Its `id`, `name`, and `version` must match the manifest. Runtime-installed external plugins must not set `activeByDefault`.

## APIs used

| API | Use in this plugin |
|---|---|
| `addMapControl` / `removeMapControl` | Small KML map button and lifecycle |
| `registerToolbarMenu` | Top-level KML / KMZ menu |
| `registerRightPanel` / `openRightPanel` | Native importer workbench with plain DOM rendering |
| `addGeoJsonLayer` | Compatibility fallback for older hosts |
| `registerExternalNativeLayer` | First-class styled layers in Layers, with attributes/export data |
| `getMap` | Per-feature paint, embedded icons, and capability detection for GroundOverlay conversion |
| `getDeckGL` | Capability detection for GeoLibre's native deck.gl-backed 3D Z-value rendering |
| `fitBounds` | Zoom to imported vector/overlay extent |

All optional capabilities are optional-chained and have a fallback or warning.

## Constraints shaping the implementation

- External panels render plain DOM, not a React node, because a plugin does not share the host React instance.
- GeoLibre's flat external-layer style is not expressive enough for per-feature KML style and icon URLs. The plugin creates data-driven MapLibre paint and marks it `controlOwnsPaint` when the host supports external native layers.
- Altitude-bearing GeoJSON uses the host's `MapboxLayer`, `GeoJsonLayer`, and `IconLayer` constructors. Ground stems and billboard point symbols are registered together as one external vector layer, with deck.gl picking routed to the same information card as flat MapLibre features.
- The geometry parser applies KML altitude semantics generically. The renderer optionally calls MapLibre `queryTerrainElevation` for relative/clamped positions and creates point-extrusion stems; no filename, document name, folder, or example-data condition participates in rendering decisions.
- GeoLibre exposes COG/GeoTIFF and URL-based raster helpers, but its current COG path is Mercator/deck.gl based. GroundOverlay is therefore reprojected into an in-memory PMTiles v3 archive of PNG XYZ tiles and registered through GeoLibre's external PMTiles layer path. This keeps one host-managed source/layer, follows the active globe projection, and overzooms the highest generated level. The archive uses a session-scoped `blob:` URL because no durable local-data PMTiles API is public yet.
- GeoLibre core has layer groups, but no group creation/membership method is currently exposed to external plugins. The plugin consolidates each file's vectors into one layer, preserves KML folders as feature metadata, and calls a forward-compatible optional `addLayerGroup(name, layerIds)` hook if a future host exposes it.
- ZIP and URL-installed plugins execute as trusted code. The desktop Content Security Policy can block remote image hosts not present in its allowlist; embedded KMZ images use data URLs and avoid this issue.
- Web and mobile file pickers cannot expose arbitrary sibling files. KMZ is the reliable way to carry relative assets. Drag-and-drop depends on the browser/platform drag APIs.
- Tauri and browser installs both accept the same ZIP layout. Web installs persist bundles in IndexedDB; desktop copies the ZIP into the application plugin directory.

## Upstream opportunity

A public, durable `addLocalPMTilesLayer` API and a richer vector registration paint contract would remove the two largest compatibility gaps: restart-safe GroundOverlay and project-safe per-feature KML styling.
