/**
 * OrthogonalPixelSource - Wrapper for viewing 3D zarr data in different orientations
 *
 * For a [z, y, x] zarr with 256³ chunks:
 * - XY view: Standard view, tiles in y,x, select z (no wrapper needed)
 * - XZ view: Tiles in z,x, select y - fetches only z-slices within the y-chunk
 * - YZ view: Tiles in z,y, select x - fetches only z-slices within the x-chunk
 */

export type ViewOrientation = "XY" | "XZ" | "YZ";

interface RasterResult {
  data: any;
  width: number;
  height: number;
}

/**
 * Creates an orthogonal pixel source that wraps an existing ZarrPixelSource
 * and presents the data in a different orientation for XZ or YZ views.
 */
export function createOrthogonalPixelSource(
  source: any,
  orientation: ViewOrientation,
  dimensions: { sizeX: number; sizeY: number; sizeZ: number }
) {
  if (orientation === "XY") {
    // XY is the native orientation, no wrapping needed
    return source;
  }

  const { sizeX, sizeY, sizeZ } = dimensions;

  // For XZ view: display z (height) vs x (width), selecting y
  // For YZ view: display z (height) vs y (width), selecting x
  const virtualWidth = orientation === "XZ" ? sizeX : sizeY;
  const virtualHeight = sizeZ;

  // Get chunk size from source metadata
  const zarrArray = source._data;
  const chunkShape = zarrArray?.meta?.chunks || [256, 256, 256];
  const chunkZ = chunkShape[0];

  console.log(`OrthogonalPixelSource created for ${orientation}:`, {
    virtualWidth,
    virtualHeight,
    chunkShape,
    sizeX,
    sizeY,
    sizeZ,
  });

  // Cache for raster slices
  const sliceCache = new Map<number, any>();
  const MAX_CACHE_SIZE = 50;

  // Get TypedArray constructor based on dtype
  function getTypedArrayConstructor(dtype: string): any {
    const dtypeMap: Record<string, any> = {
      Uint8: Uint8Array,
      Uint16: Uint16Array,
      Uint32: Uint32Array,
      Int8: Int8Array,
      Int16: Int16Array,
      Int32: Int32Array,
      Float32: Float32Array,
      Float64: Float64Array,
      "<i2": Int16Array,
      "<u2": Uint16Array,
      ">i2": Int16Array,
      ">u2": Uint16Array,
      "<f4": Float32Array,
      "|u1": Uint8Array,
      "|i1": Int8Array,
    };
    return dtypeMap[dtype] || Uint16Array;
  }

  async function fetchZSlice(z: number): Promise<any> {
    if (sliceCache.has(z)) {
      return sliceCache.get(z);
    }

    try {
      const raster = await source.getRaster({ selection: { z } });

      // Cache management
      if (sliceCache.size >= MAX_CACHE_SIZE) {
        const firstKey = sliceCache.keys().next().value;
        if (firstKey !== undefined) sliceCache.delete(firstKey);
      }
      sliceCache.set(z, raster);

      return raster;
    } catch (err) {
      console.error(`Error fetching z-slice ${z}:`, err);
      return null;
    }
  }

  // Calculate downsampled dimensions (must match getRaster output)
  const DOWNSAMPLE_Z = Math.max(1, Math.floor(sizeZ / 50));
  const DOWNSAMPLE_XY = Math.max(1, Math.floor(Math.max(sizeX, sizeY) / 500));
  const sampledZCount = Math.ceil(sizeZ / DOWNSAMPLE_Z);
  const sampledWidth = Math.ceil(virtualWidth / DOWNSAMPLE_XY);

  return {
    get shape() {
      return [sampledZCount, sampledWidth];
    },

    get dtype() {
      return source.dtype;
    },

    get labels() {
      return ["y", "x"];
    },

    get tileSize() {
      return source.tileSize || 256;
    },

    /**
     * Get raster data for the orthogonal view
     * Uses DOWNSAMPLING for fast preview - fetches every Nth slice/pixel
     * Selection contains the slice position in the "depth" dimension:
     * - XZ view: selection.y = the y-slice to show
     * - YZ view: selection.x = the x-slice to show
     */
    async getRaster({
      selection,
    }: {
      selection: Record<string, number>;
    }): Promise<RasterResult> {
      const slicePos =
        orientation === "XZ" ? selection.y || 0 : selection.x || 0;

      console.log(`getRaster for ${orientation} at position ${slicePos}`, {
        DOWNSAMPLE_Z,
        DOWNSAMPLE_XY,
        sampledZCount,
        sampledWidth,
        originalZ: sizeZ,
        originalWidth: virtualWidth,
      });

      const TypedArrayConstructor = getTypedArrayConstructor(source.dtype);
      const outputData = new TypedArrayConstructor(sampledWidth * sampledZCount);

      // Fetch downsampled z-slices in parallel
      const slicePromises: Promise<void>[] = [];

      for (let zSample = 0; zSample < sampledZCount; zSample++) {
        const z = Math.min(zSample * DOWNSAMPLE_Z, sizeZ - 1);

        slicePromises.push(
          (async () => {
            const xySlice = await fetchZSlice(z);
            if (!xySlice) return;

            const dstRowStart = zSample * sampledWidth;

            if (orientation === "XZ") {
              // Extract downsampled row at y=slicePos
              const srcRowStart = slicePos * xySlice.width;
              for (let xSample = 0; xSample < sampledWidth; xSample++) {
                const x = Math.min(xSample * DOWNSAMPLE_XY, sizeX - 1);
                outputData[dstRowStart + xSample] = xySlice.data[srcRowStart + x];
              }
            } else {
              // YZ view: extract downsampled column at x=slicePos
              for (let ySample = 0; ySample < sampledWidth; ySample++) {
                const y = Math.min(ySample * DOWNSAMPLE_XY, sizeY - 1);
                const srcIdx = y * xySlice.width + slicePos;
                outputData[dstRowStart + ySample] = xySlice.data[srcIdx];
              }
            }
          })()
        );
      }

      await Promise.all(slicePromises);

      return {
        data: outputData,
        width: sampledWidth,
        height: sampledZCount,
      };
    },

    async getTile({
      x,
      y,
      selection,
    }: {
      x: number;
      y: number;
      selection: Record<string, number>;
    }) {
      const raster = await this.getRaster({ selection });
      const tileSize = this.tileSize;

      const x0 = x * tileSize;
      const y0 = y * tileSize;
      const x1 = Math.min(x0 + tileSize, raster.width);
      const y1 = Math.min(y0 + tileSize, raster.height);
      const tileWidth = x1 - x0;
      const tileHeight = y1 - y0;

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

    clearCache() {
      sliceCache.clear();
    },

    onTileError(err: Error) {
      console.error("Orthogonal tile error:", err);
    },
  };
}

/**
 * Get the dimension info for a specific orientation
 */
export function getOrthogonalDimensions(
  orientation: ViewOrientation,
  dimensions: { sizeX: number; sizeY: number; sizeZ: number }
) {
  const { sizeX, sizeY, sizeZ } = dimensions;

  switch (orientation) {
    case "XY":
      return {
        width: sizeX,
        height: sizeY,
        depthLabel: "Z",
        depthSize: sizeZ,
        widthLabel: "X",
        heightLabel: "Y",
      };
    case "XZ":
      return {
        width: sizeX,
        height: sizeZ,
        depthLabel: "Y",
        depthSize: sizeY,
        widthLabel: "X",
        heightLabel: "Z",
      };
    case "YZ":
      return {
        width: sizeY,
        height: sizeZ,
        depthLabel: "X",
        depthSize: sizeX,
        widthLabel: "Y",
        heightLabel: "Z",
      };
  }
}
