# GeoLibre KML / KMZ Import

A standalone GeoLibre plugin for opening Google Earth `.kml` and `.kmz` files as usable map layers. It imports common 2D geometry, folder metadata, attributes, shared styles, embedded marker icons, GroundOverlays, time data, and selected `gx` extensions while degrading safely when a KML feature cannot be represented by GeoLibre.

Version `0.1.1` targets the current external-plugin contract documented by GeoLibre on 2026-07-18.

## Highlights

- Point, LineString, Polygon (including holes), MultiGeometry, and mixed documents
- Document/Folder hierarchy retained in `folderPath`, with one organized vector layer per imported file
- `ExtendedData`, `Data`, `SchemaData`, `SimpleData`, names, descriptions, addresses, visibility, snippets, and source filenames
- KML `aabbggrr` colors, Style, StyleMap normal state, IconStyle, LabelStyle, LineStyle, and PolyStyle
- KMZ archives with non-`doc.kml` main documents, nested paths, embedded images, and custom icons
- GroundOverlay with LatLonBox, rotation approximation, draw order, alpha, and `gx:LatLonQuad`
- TimeStamp, TimeSpan, `gx:Track`, and `gx:MultiTrack` timestamps preserved as attributes
- Optional, bounded NetworkLink loading for HTTPS and in-archive KML/KMZ resources
- Detection and non-fatal warnings for models, tours, screen/photo overlays, and other unsupported content
- Drag-and-drop, file picker, progress text, auto-zoom, summary, and expandable warnings
- No server upload: normal imports are processed locally

See [KML_COMPATIBILITY.md](KML_COMPATIBILITY.md) for the detailed matrix.

## Install in GeoLibre

1. Download `kml-kmz-import-0.1.1.zip` from the repository release or build it as described below.
2. Open GeoLibre.
3. Open **Settings → Manage Plugins → Settings**.
4. Select **Install from file**.
5. Choose `kml-kmz-import-0.1.1.zip`.
6. Activate **KML / KMZ Import** from the Plugins menu if it is not already active.
7. Use the **KML / KMZ** toolbar menu, the small **KML** map button, or the importer panel.

GeoLibre accepts a ZIP with `plugin.json` at the archive root. This repository's package command produces exactly that layout:

```text
plugin.json
dist/index.js
dist/style.css
```

For local development, GeoLibre can also scan the unpacked `geolibre-plugin/` directory through its additional plugin directories setting.

## Build

Requires Node.js 20 or newer.

```bash
npm install
npm run lint
npm run typecheck
npm test
npm run package:geolibre
npm run validate:package
```

The installable archive is written to:

```text
geolibre-plugin/kml-kmz-import-0.1.1.zip
```

`npm run package:geolibre` runs the production build first. The bundle is a self-contained ESM entry; GeoLibre's external-plugin loader does not resolve relative JavaScript imports inside the ZIP.

## Architecture

The parser is deliberately modular:

- `src/kmzArchive.ts` — lazy ZIP access, primary-KML selection, extraction limits
- `src/assetResolver.ts` — safe virtual archive paths and data URLs
- `src/kmlParser.ts` — hierarchy, attributes, time, feature detection, orchestration
- `src/geometry.ts` — coordinate and GeoJSON geometry conversion
- `src/styleParser.ts` — KML colors, styles, StyleMaps
- `src/groundOverlayParser.ts` — image bounds and quadrilaterals
- `src/networkLinkParser.ts` / `src/importer.ts` — detection and bounded loading
- `src/kmlToGeoLibre.ts` — styled native layers, image overlays, bounds fitting
- `src/ui/` — GeoLibre control and plain-DOM right panel

GeoLibre's current API provides `registerToolbarMenu`, `registerRightPanel`, `addGeoJsonLayer`, `registerExternalNativeLayer`, `getMap`, and `fitBounds`. The plugin uses the native external-layer registry when available and falls back to `addGeoJsonLayer` on older hosts. Details are in [GEOLIBRE_API_NOTES.md](GEOLIBRE_API_NOTES.md).

## Security

KML/KMZ is treated as untrusted input:

- rejects XML `DOCTYPE` and entity declarations
- rejects invalid XML and malformed ZIP structures
- rejects absolute, protocol-bearing, or escaping archive paths
- limits input to 100 MB, archive files to 2,000, an entry to 100 MB, and total declared extraction to 250 MB
- limits embedded renderable assets to 10 MB and compression ratio to 1,000:1
- sanitizes description HTML with an element/attribute/protocol allowlist
- uses escaped plain text for descriptions in KML documents over 5 MB to avoid thousands of expensive HTML parses
- accepts only HTTPS for fetched NetworkLinks, with depth/resource/response-size limits and a visited set
- never writes KMZ contents to disk

External GeoLibre plugins are trusted executable code, so install only from a source you trust. See [SECURITY.md](SECURITY.md) for reporting and threat-model details.

## Performance

Measured under Vitest/jsdom on the development machine:

- 1 point: under 20 ms
- 1,000 points: about 0.2 s
- 10,000 points: about 3.5 s
- supplied 20.4 MB uncompressed / 48,818-Placemark KMZ: about 12 s
- supplied 38.8 MB uncompressed / 16,087-description KMZ: about 38 s

Browser engines differ from jsdom. Parsing currently runs on the UI thread; very large documents can temporarily block interaction. Moving parsing to a Web Worker is the top v0.2 performance item.

## Known limitations

- GeoLibre has no native arbitrary georeferenced image registration helper. GroundOverlays use `getMap()` and a MapLibre image source, then register the existing layer with GeoLibre. They work in the current session, but exact project restore and style-reload persistence depend on host support.
- GeoLibre's core supports layer groups, but the current external-plugin API does not expose group creation. The plugin creates one vector layer per imported file and keeps every KML folder path in feature attributes. GroundOverlays remain adjacent layers. A forward-compatible `addLayerGroup` hook creates a real file-named group when a future host exposes it.
- Data-driven KML paint and custom icons are created directly in MapLibre. Older GeoLibre hosts receive default vector styling.
- Rotated LatLonBox overlays use a geographic-coordinate approximation. `gx:LatLonQuad` is exact in 2D.
- Remote relative assets inside a fetched NetworkLink are not resolved in v0.1.
- NetworkLink refresh/view-refresh semantics are not implemented.
- 3D Model/COLLADA, tours, ScreenOverlay, and PhotoOverlay are detected and reported, not rendered.
- Altitude is retained in coordinate Z values and `altitudeMode` attributes but GeoLibre renders in 2D.
- KML regions/LOD, cameras, and LookAt are retained as metadata where attached to a Placemark; view behavior is not reproduced.

## Test data

Small redistribution-safe fixtures live in `test-data/kml-kmz/synthetic/`. The large local corpus is intentionally ignored by Git. [TEST_DATA.md](TEST_DATA.md) describes the test matrix, sources, licenses, and expected behavior.

## v0.2 recommendations

1. Move ZIP/XML parsing and sanitization into a Web Worker with cancellable progress messages.
2. Add a GeoLibre-native arbitrary image/quad layer API so GroundOverlays persist and restyle like other raster layers.
3. Add host-level data-driven vector paint/icon registration to preserve per-feature KML style across project restore.
4. Resolve relative assets for remote NetworkLinks with origin-aware URL bases and stricter allowlists.
5. Add refresh semantics, user-controlled domain allowlists, and a linked-resource preview.
6. Add temporal playback for TimeStamp/TimeSpan and `gx:Track`.
7. Add optional Supercluster/vector tiling for 100,000+ Placemarks.

## License

MIT. See [LICENSE](LICENSE).
