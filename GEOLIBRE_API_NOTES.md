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
| `getMap` | Per-feature paint, embedded icons, and GroundOverlay image sources |
| `fitBounds` | Zoom to imported vector/overlay extent |

All optional capabilities are optional-chained and have a fallback or warning.

## Constraints shaping the implementation

- External panels render plain DOM, not a React node, because a plugin does not share the host React instance.
- GeoLibre's flat external-layer style is not expressive enough for per-feature KML style and icon URLs. The plugin creates data-driven MapLibre paint and marks it `controlOwnsPaint` when the host supports external native layers.
- The documented raster helpers accept XYZ, WMTS, WMS, and COG—not arbitrary images. GroundOverlay therefore uses a MapLibre `image` source through `getMap`.
- No nested layer-group API is currently exposed. KML folders become names and feature metadata.
- ZIP and URL-installed plugins execute as trusted code. The desktop Content Security Policy can block remote image hosts not present in its allowlist; embedded KMZ images use data URLs and avoid this issue.
- Web and mobile file pickers cannot expose arbitrary sibling files. KMZ is the reliable way to carry relative assets. Drag-and-drop depends on the browser/platform drag APIs.
- Tauri and browser installs both accept the same ZIP layout. Web installs persist bundles in IndexedDB; desktop copies the ZIP into the application plugin directory.

## Upstream opportunity

A native `addImageLayer(name, url, coordinates, options)` API and a richer vector registration paint contract would remove the two largest compatibility gaps: persistent GroundOverlay and project-safe per-feature KML styling.
