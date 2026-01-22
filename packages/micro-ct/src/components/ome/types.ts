// Shared types for OME viewer components

export interface OmeLoaderResult {
  loader: any[];
  metadata: OmeMetadata;
  dimensions: OmeDimensions;
  isCustomLoader: boolean;
}

export interface OmeMetadata {
  Name?: string;
  Pixels?: {
    SizeX: number;
    SizeY: number;
    SizeC: number;
    SizeZ: number;
    SizeT: number;
    Type: string;
    Channels?: OmeChannel[];
  };
  omero?: {
    channels?: OmeroChannel[];
  };
}

export interface OmeChannel {
  ID: string;
  Name?: string;
  Color?: [number, number, number, number];
}

export interface OmeroChannel {
  color?: string;
  label?: string;
  active?: boolean;
  window?: {
    start: number;
    end: number;
    min?: number;
    max?: number;
  };
}

export interface OmeDimensions {
  sizeX: number;
  sizeY: number;
  sizeC: number;
  sizeZ: number;
  sizeT: number;
  shape: number[];
  labels: string[];
  dtype: string;
}

export interface ViewerLayerProps {
  isCustomLoader: boolean;
  contrastLimits: [number, number][];
  channelsVisible: boolean[];
  colors: [number, number, number][];
  dtype: string;
  numChannels: number;
  cIndex: number;
  zIndex: number;
  tIndex: number;
}

export interface SlicePosition {
  z: number;
  t: number;
  c?: number;
}

export type SourceType = "ome-zarr" | "ome-tiff";
