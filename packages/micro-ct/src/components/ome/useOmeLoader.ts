// Composable for loading OME-TIFF and OME-Zarr data

import { ref, type Ref } from "vue";
import { loadOmeZarr } from "@vivjs/loaders";
import * as GeoTIFF from "geotiff";
import type {
  OmeLoaderResult,
  OmeMetadata,
  OmeDimensions,
  SourceType,
} from "./types";

export function useOmeLoader() {
  const isLoading = ref(false);
  const error: Ref<Error | null> = ref(null);

  async function loadOmeTiff(source: string | File): Promise<OmeLoaderResult> {
    // Load OME-TIFF using geotiff directly to avoid strict OME-XML validation
    const tiff =
      typeof source === "string"
        ? await GeoTIFF.fromUrl(source)
        : await GeoTIFF.fromBlob(source);

    const firstImage = await tiff.getImage(0);

    // Parse OME-XML from the image description to get dimension info
    // We extract dimensions from metadata instead of calling getImageCount() which is very slow
    const description = firstImage.getFileDirectory().ImageDescription || "";
    let sizeC = 1,
      sizeT = 1,
      sizeZ = 1;
    let pixelType = "uint8";

    // Extract dimensions from OME-XML
    // Use Pixels-specific regex to avoid matching attributes on other elements
    // (e.g. <Microscope Type="Upright" /> before <Pixels Type="uint8">)
    const sizeCMatch = description.match(/SizeC="(\d+)"/);
    const sizeTMatch = description.match(/SizeT="(\d+)"/);
    const sizeZMatch = description.match(/SizeZ="(\d+)"/);
    const typeMatch = description.match(/<Pixels[^>]*\bType="(\w+)"/);

    if (sizeCMatch) sizeC = parseInt(sizeCMatch[1]);
    if (sizeTMatch) sizeT = parseInt(sizeTMatch[1]);
    if (sizeZMatch) sizeZ = parseInt(sizeZMatch[1]);
    if (typeMatch) pixelType = typeMatch[1];

    // Detect interleaved RGB: when SamplesPerPixel > 1, all channels are
    // packed into each IFD rather than stored as separate IFDs per channel.
    const samplesPerPixel = firstImage.fileDirectory.SamplesPerPixel || 1;
    const isInterleaved = samplesPerPixel > 1;

    // For interleaved images, each IFD contains all channels, so the
    // actual IFD count is sizeZ * sizeT (not sizeC * sizeZ * sizeT).
    const imageCount = isInterleaved
      ? sizeZ * sizeT
      : sizeC * sizeT * sizeZ;

    console.log('[ome-loader] Detected:', {
      sizeC, sizeZ, sizeT, samplesPerPixel, isInterleaved, imageCount, pixelType
    });

    // Pre-index all IFDs in background for fast random access later
    tiff.getImageCount();

    const width = firstImage.getWidth();
    const height = firstImage.getHeight();
    const bitsPerSample = firstImage.getBitsPerSample()[0];

    // Map pixel type to dtype
    const dtypeMap: Record<string, string> = {
      uint8: "Uint8",
      uint16: "Uint16",
      uint32: "Uint32",
      int8: "Int8",
      int16: "Int16",
      int32: "Int32",
      float: "Float32",
      double: "Float64",
    };
    const dtype =
      dtypeMap[pixelType] ||
      (bitsPerSample <= 8
        ? "Uint8"
        : bitsPerSample <= 16
        ? "Uint16"
        : "Float32");

    // Create a simple pixel source wrapper
    const shape = [sizeT, sizeC, sizeZ, height, width];
    const labels = ["t", "c", "z", "y", "x"];

    // Create a custom loader that uses windowed reads (no full-image caching)
    const customLoader = {
      dtype,
      shape,
      labels,
      tileSize: 512,
      _tiff: tiff,
      _imageCount: imageCount,
      _sizeC: sizeC,
      _sizeZ: sizeZ,
      _isInterleaved: isInterleaved,

      _getIfdIndex(selection: Record<string, number>): number {
        const t = selection.t || 0;
        const c = selection.c || 0;
        const z = selection.z || 0;

        let ifdIndex: number;
        if (this._isInterleaved) {
          // Interleaved: each IFD has all channels, index by z and t only
          ifdIndex = t * this._sizeZ + z;
        } else {
          // Planar: separate IFD per channel (assuming XYZCT order)
          ifdIndex = t * this._sizeC * this._sizeZ + c * this._sizeZ + z;
        }
        return Math.min(ifdIndex, this._imageCount - 1);
      },

      async getRaster({ selection }: { selection: Record<string, number> }) {
        const ifdIndex = this._getIfdIndex(selection);
        const image = await this._tiff.getImage(ifdIndex);
        const imgWidth = image.getWidth();
        const imgHeight = image.getHeight();

        const MAX_PIXELS = 4096 * 4096;
        const SAMPLE_SIZE = 512;
        let rasters: any;
        let outWidth: number;
        let outHeight: number;

        if (imgWidth * imgHeight > MAX_PIXELS) {
          // Image too large to read in full — read a small center crop
          // to satisfy Viv's initialization (contrast stats, dtype check)
          const cx = Math.max(0, Math.floor((imgWidth - SAMPLE_SIZE) / 2));
          const cy = Math.max(0, Math.floor((imgHeight - SAMPLE_SIZE) / 2));
          const x1 = Math.min(cx + SAMPLE_SIZE, imgWidth);
          const y1 = Math.min(cy + SAMPLE_SIZE, imgHeight);
          rasters = await image.readRasters({ window: [cx, cy, x1, y1] });
          outWidth = x1 - cx;
          outHeight = y1 - cy;
        } else {
          rasters = await image.readRasters({ window: [0, 0, imgWidth, imgHeight] });
          outWidth = imgWidth;
          outHeight = imgHeight;
        }

        const c = selection.c || 0;
        const data = this._isInterleaved
          ? ((rasters as any)[c] || rasters[0])
          : rasters[0];

        return { data, width: outWidth, height: outHeight };
      },

      async getTile({ x, y, selection }: any) {
        const tileSize = this.tileSize;
        const imgWidth = this.shape[this.labels.indexOf('x')];
        const imgHeight = this.shape[this.labels.indexOf('y')];

        const x0 = x * tileSize;
        const y0 = y * tileSize;
        const x1 = Math.min(x0 + tileSize, imgWidth);
        const y1 = Math.min(y0 + tileSize, imgHeight);

        const ifdIndex = this._getIfdIndex(selection);
        const image = await this._tiff.getImage(ifdIndex);
        const rasters = await image.readRasters({ window: [x0, y0, x1, y1] });

        const c = selection.c || 0;
        const data = this._isInterleaved
          ? ((rasters as any)[c] || rasters[0])
          : rasters[0];

        return { data, width: x1 - x0, height: y1 - y0 };
      },

      onTileError(err: Error) {
        console.error("Tile error:", err);
      },
    };

    const metadata: OmeMetadata = {
      Name: typeof source === "string" ? source : (source as File).name,
      Pixels: {
        SizeX: width,
        SizeY: height,
        SizeC: sizeC,
        SizeZ: sizeZ,
        SizeT: sizeT,
        Type: pixelType,
        Channels: Array(sizeC)
          .fill(null)
          .map((_, i) => ({
            ID: `Channel:0:${i}`,
            Name: `Channel ${i}`,
          })),
      },
    };

    const dimensions: OmeDimensions = {
      sizeX: width,
      sizeY: height,
      sizeC,
      sizeZ,
      sizeT,
      shape,
      labels,
      dtype,
    };

    return {
      loader: [customLoader],
      metadata,
      dimensions,
      isCustomLoader: true,
    };
  }

  async function loadOmeZarrData(source: string): Promise<OmeLoaderResult> {
    const result = await loadOmeZarr(source, {
      type: "multiscales",
    });

    const loader = result.data;
    const metadata = result.metadata as any;

    // Get loader info
    const { dtype, shape, labels } = loader[0];

    // Find dimension indices
    const cIndex = labels.indexOf("c");
    const zIndex = labels.indexOf("z");
    const tIndex = labels.indexOf("t");

    // Get sizes from shape
    const sizeC = cIndex >= 0 ? shape[cIndex] : 1;
    const sizeZ = zIndex >= 0 ? shape[zIndex] : 1;
    const sizeT = tIndex >= 0 ? shape[tIndex] : 1;
    const sizeY = shape[shape.length - 2];
    const sizeX = shape[shape.length - 1];

    const dimensions: OmeDimensions = {
      sizeX,
      sizeY,
      sizeC,
      sizeZ,
      sizeT,
      shape,
      labels,
      dtype,
    };

    return {
      loader,
      metadata,
      dimensions,
      isCustomLoader: false,
    };
  }

  async function load(
    source: string | File,
    sourceType: SourceType
  ): Promise<OmeLoaderResult | null> {
    isLoading.value = true;
    error.value = null;

    try {
      if (sourceType === "ome-tiff") {
        return await loadOmeTiff(source);
      } else {
        if (typeof source !== "string") {
          throw new Error("OME-Zarr only supports URL sources");
        }
        return await loadOmeZarrData(source);
      }
    } catch (e) {
      error.value =
        e instanceof Error ? e : new Error("Failed to load OME data");
      console.error("Load error:", e);
      return null;
    } finally {
      isLoading.value = false;
    }
  }

  return {
    load,
    isLoading,
    error,
  };
}
