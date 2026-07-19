import type { FeatureCollection } from "geojson";

export interface MapLayerMouseEvent {
  point: { x: number; y: number };
  features?: Array<{ properties?: Record<string, unknown> }>;
}

export type MapControlPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export interface MapLike {
  addSource(id: string, source: Record<string, unknown>): void;
  getSource(id: string): unknown;
  removeSource(id: string): void;
  addLayer(layer: Record<string, unknown>, beforeId?: string): void;
  getLayer(id: string): unknown;
  removeLayer(id: string): void;
  addImage?(id: string, image: ImageBitmap | HTMLImageElement | ImageData): void;
  hasImage?(id: string): boolean;
  removeImage?(id: string): void;
  setFeatureState?(target: { source: string; id: string | number }, state: Record<string, unknown>): void;
  on?(type: "click", layerId: string, handler: (event: MapLayerMouseEvent) => void): void;
  off?(type: "click", layerId: string, handler: (event: MapLayerMouseEvent) => void): void;
  getContainer?(): HTMLElement;
  getCanvas?(): HTMLCanvasElement;
  queryTerrainElevation?(lngLat: [number, number], options?: { exaggerated?: boolean }): number | null | undefined;
}

export interface GeoLibreControl {
  onAdd(): HTMLElement;
  onRemove(): void;
}

export interface ExternalLayerRegistration {
  id: string;
  name: string;
  type?: "geojson" | "raster" | "pmtiles";
  source?: Record<string, unknown>;
  geojson?: FeatureCollection;
  nativeLayerIds: string[];
  sourceIds?: string[];
  opacity?: number;
  style?: {
    fillColor?: string;
    strokeColor?: string;
    strokeWidth?: number;
    fillOpacity?: number;
    circleRadius?: number;
    elevation3dEnabled?: boolean;
    elevation3dVerticalScale?: number;
    elevation3dOffset?: number;
  };
  metadata?: Record<string, unknown>;
  sourcePath?: string;
}

export interface GeoLibreDeckGL {
  layers: {
    GeoJsonLayer: new (properties: Record<string, unknown>) => unknown;
    IconLayer: new (properties: Record<string, unknown>) => unknown;
  };
  mapbox: {
    MapboxLayer: new (properties: Record<string, unknown>) => Record<string, unknown>;
  };
}

export interface PanelRegistration {
  id: string;
  title: string;
  dock?: "replace-style" | "right-of-style";
  defaultWidth?: number;
  render(container: HTMLElement): void | (() => void);
}

export interface GeoLibreAppAPI {
  addGeoJsonLayer(name: string, data: FeatureCollection, sourcePath?: string): string;
  fitBounds?(bounds: [number, number, number, number]): void;
  getMap?(): MapLike | null;
  getDeckGL?(): Promise<GeoLibreDeckGL>;
  addMapControl(control: GeoLibreControl, position?: MapControlPosition): boolean;
  removeMapControl(control: GeoLibreControl): void;
  registerExternalNativeLayer?(layer: ExternalLayerRegistration): void;
  unregisterExternalNativeLayer?(id: string): void;
  /**
   * Forward-compatible layer-group hook. GeoLibre's core store supports groups,
   * but this is not yet exposed by the current public external-plugin API.
   */
  addLayerGroup?(name?: string, layerIds?: string[]): string;
  registerRightPanel?(panel: PanelRegistration): () => void;
  unregisterRightPanel?(id: string): void;
  openRightPanel?(id: string): boolean;
  closeRightPanel?(id: string): void;
  registerToolbarMenu?(menu: {
    id: string;
    label: string;
    items: Array<
      | { id: string; label: string; disabled?: boolean; onSelect(): void }
      | { type: "separator"; id?: string }
    >;
  }): () => void;
}

export interface GeoLibrePlugin {
  id: string;
  name: string;
  version: string;
  activate(app: GeoLibreAppAPI): boolean | void | Promise<boolean | void>;
  deactivate(app: GeoLibreAppAPI): void;
  getMapControlPosition?(): MapControlPosition;
  setMapControlPosition?(app: GeoLibreAppAPI, position: MapControlPosition): boolean | void;
}
