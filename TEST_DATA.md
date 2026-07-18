# KML/KMZ test data

Only small synthetic fixtures authored for this MIT-licensed repository are committed under `test-data/kml-kmz/synthetic/`. The user's larger local corpus lives in ignored `example_kml-kmz_files/` and is never published by this project.

## Committed synthetic fixtures

| File | Source / license | Coverage | Expected behavior |
|---|---|---|---|
| `basic-mixed.kml` | Project-authored / MIT | Point, LineString, Polygon, altitude, mixed document | Three features, correct lon/lat order |
| `polygon-hole.kml` | Project-authored / MIT | innerBoundaryIs | One Polygon with two rings |
| `nested-styled-time.kml` | Project-authored / MIT | nested folders, ExtendedData, SchemaData, Style, StyleMap, MultiGeometry, TimeSpan, gx:Track, unsafe HTML | Attributes/time/style retained; script removed |
| `unsupported-model.kml` | Project-authored / MIT | usable Point plus COLLADA Model metadata | Point imports; model reported non-fatally |
| `ground-overlay.kml` | Project-authored / MIT | image reference, LatLonBox, rotation, drawOrder, alpha | Overlay parsed; rotation approximation warning |

Tests generate KMZ archives in memory for custom icons, non-`doc.kml` entry selection, nested relative paths, missing assets, corruption, and Zip Slip paths. Performance tests generate 1, 1,000, and 10,000 points in memory.

## Full matrix

| # | Scenario | Fixture/test | Expected result |
|---:|---|---|---|
| 1 | Basic points | `basic-mixed.kml` | Point imported |
| 2 | Multiple Placemarks | `basic-mixed.kml` | All Placemarks imported |
| 3 | Lines | `basic-mixed.kml` | LineString imported |
| 4 | Polygons | `basic-mixed.kml` | Polygon imported |
| 5 | Polygon holes | `polygon-hole.kml` | Hole retained |
| 6 | MultiGeometry | `nested-styled-time.kml` | Mixed geometries emitted without loss |
| 7 | Nested folders | `nested-styled-time.kml` | Full path retained |
| 8 | ExtendedData | `nested-styled-time.kml` | Data/SimpleData accessible as properties |
| 9 | Shared styles | `nested-styled-time.kml` | Style values resolved |
| 10 | StyleMap | `nested-styled-time.kml` | Normal target resolved |
| 11 | Custom icons | Generated KMZ test | Embedded icon becomes data URL |
| 12 | Embedded KMZ images | Generated KMZ test | Safe relative resolution |
| 13 | GroundOverlay | `ground-overlay.kml` | Bounds and asset parsed |
| 14 | Rotated GroundOverlay | `ground-overlay.kml` | Quad approximation and warning |
| 15 | NetworkLink | Inline test | Link classified; fetch disabled by default |
| 16 | TimeStamp / TimeSpan | Inline plus nested fixture | Values retained |
| 17 | gx:Track | `nested-styled-time.kml` | Line and timestamps retained |
| 18 | 3D Model / COLLADA | `unsupported-model.kml` | Metadata report; supported point still loads |
| 19 | Large feature collection | Generated 10,000-point test and ignored corpus | Completes within benchmark threshold |
| 20 | Malformed/archive edge cases | Inline and generated ZIP tests | Helpful rejection; no crash |
| 21 | Global and dateline GroundOverlay | Generated bounds plus ignored Dynamic Earth corpus | Image is cropped into globe-safe tiles under one logical layer |

## Optional public samples

These are not vendored. Review their license before redistributing:

- [Google KML tutorial samples](https://developers.google.com/kml/documentation/kml_tut) — point/line/polygon, overlays, styles, folders, NetworkLink examples; page content subject to Google Developers site terms.
- [Google libkml example directory](https://github.com/google/libkml/tree/master/examples/kml) — broad KML 2.2 samples including ExtendedData, StyleMap, PhotoOverlay, regions, and models; archived repository, BSD-style project license.
- [libkml `kmlsamples.kml`](https://github.com/google/libkml/blob/master/examples/kml/kmlsamples.kml) — multi-feature reference sample; use under the repository license.
- [libkml `photooverlay.kml`](https://github.com/google/libkml/blob/master/examples/kml/photooverlay.kml) — unsupported-feature detection; use under the repository license.
- [Google KML Reference](https://developers.google.com/kml/documentation/kmlreference) — normative element behavior and links to the OGC specification; reference only.

For each downloaded file, record the URL, retrieval date, upstream license, checksum, feature under test, expected import summary, and known unsupported behavior before adding it to a private/local corpus.
