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
    const sizeCMatch = description.match(/SizeC="(\d+)"/);
    const sizeTMatch = description.match(/SizeT="(\d+)"/);
    const sizeZMatch = description.match(/SizeZ="(\d+)"/);
    const typeMatch = description.match(/Type="(\w+)"/);

    if (sizeCMatch) sizeC = parseInt(sizeCMatch[1]);
    if (sizeTMatch) sizeT = parseInt(sizeTMatch[1]);
    if (sizeZMatch) sizeZ = parseInt(sizeZMatch[1]);
    if (typeMatch) pixelType = typeMatch[1];

    // Calculate image count from dimensions (much faster than getImageCount() which traverses all IFDs)
    const imageCount = sizeC * sizeT * sizeZ;

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

    // Create a custom loader that wraps geotiff with caching
    const customLoader = {
      dtype,
      shape,
      labels,
      tileSize: 512,
      _tiff: tiff,
      _imageCount: imageCount,
      _sizeC: sizeC,
      _sizeZ: sizeZ,
      // Cache for raster data: key is "t-c-z", value is the raster result
      _rasterCache: new Map<
        string,
        { data: any; width: number; height: number }
      >(),
      _maxCacheSize: 10, // Keep last 10 slices in memory

      _getCacheKey(selection: Record<string, number>): string {
        const t = selection.t || 0;
        const c = selection.c || 0;
        const z = selection.z || 0;
        return `${t}-${c}-${z}`;
      },

      async getRaster({ selection }: { selection: Record<string, number> }) {
        const cacheKey = this._getCacheKey(selection);

        // Check cache first
        if (this._rasterCache.has(cacheKey)) {
          return this._rasterCache.get(cacheKey)!;
        }

        const t = selection.t || 0;
        const c = selection.c || 0;
        const z = selection.z || 0;
        // Calculate IFD index based on dimension order (assuming XYZCT)
        const ifdIndex = t * this._sizeC * this._sizeZ + c * this._sizeZ + z;
        const image = await this._tiff.getImage(
          Math.min(ifdIndex, this._imageCount - 1)
        );
        const raster = await image.readRasters();
        const result = {
          data: raster[0],
          width: image.getWidth(),
          height: image.getHeight(),
        };

        // Add to cache, evicting oldest if necessary
        if (this._rasterCache.size >= this._maxCacheSize) {
          const firstKey = this._rasterCache.keys().next().value;
          if (firstKey !== undefined) {
            this._rasterCache.delete(firstKey);
          }
        }
        this._rasterCache.set(cacheKey, result);

        return result;
      },

      async getTile({ x, y, selection }: any) {
        // Get raster from cache or load it
        const raster = await this.getRaster({ selection });
        const tileSize = this.tileSize;
        const x0 = x * tileSize;
        const y0 = y * tileSize;
        const x1 = Math.min(x0 + tileSize, raster.width);
        const y1 = Math.min(y0 + tileSize, raster.height);
        const tileWidth = x1 - x0;
        const tileHeight = y1 - y0;

        // Extract tile data
        const TypedArrayConstructor = raster.data.constructor as any;
        const tileData = new TypedArrayConstructor(tileWidth * tileHeight);
        for (let row = 0; row < tileHeight; row++) {
          const srcOffset = (y0 + row) * raster.width + x0;
          const dstOffset = row * tileWidth;
          tileData.set(
            raster.data.subarray(srcOffset, srcOffset + tileWidth),
            dstOffset
          );
        }

        return { data: tileData, width: tileWidth, height: tileHeight };
      },

      // Clear cache when no longer needed
      clearCache() {
        this._rasterCache.clear();
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
