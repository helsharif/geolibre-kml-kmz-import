# KML 2.2 compatibility

Legend: ✅ Supported · 🟡 Partially supported · ❌ Not supported · 🔬 Experimental

| KML concept | Status | v0.1 behavior |
|---|---:|---|
| Document | ✅ | Name and descendants imported; hierarchy retained in paths |
| Folder / nested Folder | ✅ | Retained as `folderPath` and layer names; no native nested layer groups |
| Placemark | ✅ | Metadata and all supported child geometries imported independently |
| Point | ✅ | Longitude/latitude and optional altitude retained |
| LineString | ✅ | Coordinates and altitude mode retained |
| LinearRing | ✅ | Used for Polygon outer and inner boundaries |
| Polygon | ✅ | Outer ring and all valid holes retained |
| MultiGeometry | ✅ | Like geometries combined; mixed geometries emitted as sibling features with shared attributes |
| Geometry altitude | 🟡 | Z coordinate and altitude mode retained; 2D rendering |
| tessellate / extrude | 🟡 | Original geometry remains usable; 3D display semantics not reproduced |
| name, address, phoneNumber, snippet | ✅ | GeoJSON properties |
| visibility / open | 🟡 | Preserved as properties; initial feature-level visibility/open UI not reproduced |
| description | ✅ | Sanitized allowlist HTML; escaped plain text for KML over 5 MB |
| ExtendedData Data/value | ✅ | Nested `extendedData` plus flattened properties |
| Schema / SchemaData / SimpleData | ✅ | Values and `schemaUrl` preserved; schema type validation not enforced |
| Style | ✅ | Common Icon/Label/Line/Poly values parsed and retained |
| StyleMap | 🟡 | Normal style URL followed; highlight interaction and inline Pair styles not reproduced |
| IconStyle | 🟡 | Embedded/remote HTTPS image, scale, heading metadata; hotspot/color not fully reproduced |
| LabelStyle | 🟡 | Color and scale retained; host label rendering is limited |
| LineStyle | ✅ | Color (including alpha) and width rendered where native-layer API is available |
| PolyStyle | ✅ | Color, alpha, fill, and outline rendered where available |
| KML `aabbggrr` color | ✅ | Tested channel/alpha conversion |
| GroundOverlay LatLonBox | 🔬 | MapLibre image source; color alpha/drawOrder; rotated bounds approximated |
| `gx:LatLonQuad` | 🔬 | Exact four-corner 2D image source |
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
- GroundOverlay depends on direct MapLibre access and is not guaranteed to survive a project restore or basemap style replacement until GeoLibre exposes a native arbitrary image layer API.
- Desktop Content Security Policy can block remote images from unlisted hosts. Embedded KMZ images use data URLs.
- Drag-and-drop availability varies on touch/mobile platforms; the file picker remains available.
