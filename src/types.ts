import type { Feature, FeatureCollection, Geometry } from "geojson";

export type WarningCode =
  | "invalid-geometry"
  | "missing-asset"
  | "unsupported-feature"
  | "partial-support"
  | "network-link"
  | "security-limit";

export interface ImportWarning {
  code: WarningCode;
  message: string;
  count?: number;
}

export interface KmlColor {
  css: string;
  hex: string;
  opacity: number;
  raw: string;
}

export interface KmlStyle {
  id?: string;
  iconHref?: string;
  iconScale?: number;
  iconHeading?: number;
  labelColor?: KmlColor;
  labelScale?: number;
  lineColor?: KmlColor;
  lineWidth?: number;
  polyColor?: KmlColor;
  fill?: boolean;
  outline?: boolean;
  raw?: Record<string, unknown>;
}

export interface KmlFeatureProperties extends Record<string, unknown> {
  name?: string;
  description?: string;
  folderPath: string;
  sourceFilename: string;
  styleUrl?: string;
  __kmlStyle?: KmlStyle;
  altitudeMode?: string;
}

export type KmlFeature = Feature<Geometry, KmlFeatureProperties>;

export interface GroundOverlay {
  name: string;
  href?: string;
  imageUrl?: string;
  bounds?: [number, number, number, number];
  coordinates?: [[number, number], [number, number], [number, number], [number, number]];
  rotation: number;
  drawOrder: number;
  opacity: number;
  folderPath: string;
}

export interface NetworkLinkInfo {
  name: string;
  href?: string;
  folderPath: string;
  kind: "https" | "archive" | "unsafe" | "missing";
}

export interface KmlModel {
  name: string;
  folderPath: string;
  href?: string;
  longitude?: number;
  latitude?: number;
  altitude?: number;
  altitudeMode?: string;
  heading?: number;
  tilt?: number;
  roll?: number;
  scaleX?: number;
  scaleY?: number;
  scaleZ?: number;
}

export interface ImportSummary {
  points: number;
  lines: number;
  polygons: number;
  groundOverlays: number;
  folders: number;
  styles: number;
  models: number;
  networkLinks: number;
  features: number;
}

export interface ParsedKml {
  featureCollection: FeatureCollection<Geometry, KmlFeatureProperties>;
  overlays: GroundOverlay[];
  networkLinks: NetworkLinkInfo[];
  models: KmlModel[];
  warnings: ImportWarning[];
  summary: ImportSummary;
  documentName?: string;
}

export interface AssetResolver {
  resolve(href: string, basePath?: string): Promise<string | undefined>;
  has?(href: string, basePath?: string): boolean;
}

export interface ParseOptions {
  sourceFilename: string;
  basePath?: string;
  assetResolver?: AssetResolver;
}
