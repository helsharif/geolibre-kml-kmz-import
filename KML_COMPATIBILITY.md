# KML 2.2 compatibility

Legend: ✅ Supported · 🟡 Partially supported · ❌ Not supported · 🔬 Experimental

| KML concept | Status | v0.3 behavior |
|---|---:|---|
| Document | ✅ | Name and descendants imported; hierarchy retained in paths |
| Folder / nested Folder | ✅ | Retained as a readable `Folder` field inside one consolidated file-named vector layer |
| Placemark | ✅ | Metadata and all supported child geometries imported independently |
| Point | ✅ | Longitude/latitude and optional altitude retained |
| LineString | ✅ | Coordinates and altitude mode retained |
| LinearRing | ✅ | Used for Polygon outer and inner boundaries |
| Polygon | ✅ | Outer ring and all valid holes retained |
| MultiGeometry | ✅ | Like geometries combined; mixed geometries emitted as sibling features with shared attributes |
| Geometry altitude | ✅ | Omitted/default and explicit clamp modes ignore Z; absolute and relative modes render in 3D; `gx:altitudeOffset` is applied |
| tessellate / extrude | 🟡 | Point extrusion renders a terrain-connected stem; line/polygon extrusion flags are retained but wall extrusion is not yet reproduced |
| name, address, phoneNumber, snippet | ✅ | GeoJSON properties |
| visibility / open | 🟡 | Effective Document/Folder/Placemark visibility is honored for vectors; hidden vectors can be included from the importer; GroundOverlays become independently switchable raster layers and retain original visibility in metadata; `open` is preserved as a property |
| description | ✅ | Two-column tables and bold `Key: Value` info windows become clean fields; other HTML is sanitized; escaped plain text for non-tabular descriptions over 5 MB |
| ExtendedData Data/value | ✅ | Values are flattened for clean Identify cards and exports; raw importer bookkeeping stays private |
| Schema / SchemaData / SimpleData | ✅ | Values and `schemaUrl` preserved; schema type validation not enforced |
| Style | ✅ | Common Icon/Label/Line/Poly values parsed and retained |
| StyleMap | 🟡 | Normal style URL followed; highlight interaction and inline Pair styles not reproduced |
| IconStyle | 🟡 | Embedded/remote HTTPS image, color, scale, and heading rendered; hotspot is not yet reproduced |
| LabelStyle | 🟡 | Color and scale retained; host label rendering is limited |
| LineStyle | ✅ | Color (including alpha) and width rendered where native-layer API is available |
| PolyStyle | ✅ | Color, alpha, fill, and outline rendered where available |
| KML `aabbggrr` color | ✅ | Tested channel/alpha conversion |
| GroundOverlay LatLonBox | 🔬 | Color alpha/drawOrder; images are locally reprojected into one PMTiles v3 archive of multi-resolution PNG XYZ tiles, including rotated and dateline-crossing bounds, and retained as one Layers-panel item |
| `gx:LatLonQuad` | 🔬 | Four-corner overlays are inverse-bilinearly sampled into the same globe-compatible PMTiles raster |
| ScreenOverlay | ❌ | Detected and warned |
| PhotoOverlay | ❌ | Detected and warned |
| NetworkLink | 🟡 | Detected; optional HTTPS and same-KMZ KML/KMZ loading with limits |
| NetworkLink refresh/viewRefresh | ❌ | Not scheduled or view-driven |
| NetworkLinkControl | ❌ | Detected and warned |
| Region / Lod | 🟡 | Region metadata retained on Placemark; LOD/view loading not reproduced |
| TimeStamp | ✅ | `when` property |
| TimeSpan | ✅ | `begin` and `end` properties |
| `gx:Track` | ✅ | LineString plus ordered `trackWhen` array |
| `gx:MultiTrack` | ✅ | Multiple tracks parsed; homogeneous tracks can combine |
| Camera / LookAt | 🟡 | Placemark-attached values retained; view not changed |
| Model / COLLADA | ❌ | Location, altitude, orientation, scale, and href retained in model report; not GeoJSON/rendered |
| ResourceMap | ❌ | Model is reported; COLLADA alias mapping not interpreted |
| `gx:Tour` | ❌ | Detected and warned |

## Environment notes

- Styled native layers require current GeoLibre `getMap` and `registerExternalNativeLayer`. Older hosts receive native GeoJSON with default styling.
- `relativeToGround` uses GeoLibre's available terrain elevation. `relativeToSeaFloor` currently falls back to terrain/zero because the host does not expose bathymetric sampling; clamp-to-sea-floor likewise uses the available map surface.
- GroundOverlay uses GeoLibre's native PMTiles raster synchronization and survives basemap style replacement during the active session. Its in-memory `blob:` archive cannot survive an application restart until GeoLibre exposes durable local raster storage. Polar image content beyond Web Mercator's finite latitude is cropped at approximately 85.05°.
- Desktop Content Security Policy can block remote images from unlisted hosts. Embedded KMZ images use data URLs.
- Drag-and-drop availability varies on touch/mobile platforms; the file picker remains available.
