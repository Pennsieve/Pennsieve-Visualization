// Composable for loading OME-TIFF and OME-Zarr data

import { ref, type Ref } from "vue";
import { loadOmeZarr } from "@vivjs/loaders";
import * as GeoTIFF from "geotiff";
import type {
  OmeLoaderResult,
  OmeMetadata,
  OmeDimensions,
  SourceType,
  OnUrlExpired,
} from "./types";
import { getTileCached, setTileCached } from "../../utils/tileCache";

export function useOmeLoader() {
  const isLoading = ref(false);
  const error: Ref<Error | null> = ref(null);

  async function loadOmeTiff(source: string | File, options?: { onUrlExpired?: OnUrlExpired; tileDB?: IDBDatabase }): Promise<OmeLoaderResult> {
    const onUrlExpired = options?.onUrlExpired;
    const tileDB = options?.tileDB;
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

    // Create a custom loader with LRU tile cache and URL expiry handling
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
      _onUrlExpired: onUrlExpired,
      _refreshingUrl: null as Promise<void> | null,
      _tileDB: tileDB as IDBDatabase | undefined,

      // LRU tile cache: keyed on "x-y-c-z-t", capped at 500 entries
      _tileCache: new Map<string, any>(),
      _tileCacheKeys: [] as string[],
      _maxCacheSize: 500,

      _cacheGet(key: string): any | undefined {
        if (!this._tileCache.has(key)) return undefined;
        // Move to end for LRU
        const idx = this._tileCacheKeys.indexOf(key);
        if (idx > -1) this._tileCacheKeys.splice(idx, 1);
        this._tileCacheKeys.push(key);
        return this._tileCache.get(key);
      },

      _cacheSet(key: string, value: any) {
        if (this._tileCache.has(key)) {
          const idx = this._tileCacheKeys.indexOf(key);
          if (idx > -1) this._tileCacheKeys.splice(idx, 1);
        }
        while (this._tileCacheKeys.length >= this._maxCacheSize) {
          const evict = this._tileCacheKeys.shift()!;
          this._tileCache.delete(evict);
        }
        this._tileCache.set(key, value);
        this._tileCacheKeys.push(key);
      },

      _isUrlExpiredError(err: any): boolean {
        const msg = String(err?.message || err || '');
        return /\b(400|403|Bad Request|Forbidden|expired)\b/i.test(msg);
      },

      async _refreshTiff(): Promise<boolean> {
        if (!this._onUrlExpired) return false;
        // Deduplicate concurrent refresh attempts
        if (!this._refreshingUrl) {
          this._refreshingUrl = (async () => {
            const newUrl = await this._onUrlExpired!();
            if (newUrl) {
              this._tiff = await GeoTIFF.fromUrl(newUrl);
              this._tiff.getImageCount(); // re-index IFDs
            }
          })();
        }
        try {
          await this._refreshingUrl;
          return true;
        } finally {
          this._refreshingUrl = null;
        }
      },

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

        const c = selection.c || 0;
        const z = selection.z || 0;
        const t = selection.t || 0;
        const cacheKey = `${x}-${y}-${c}-${z}-${t}`;

        // 1. Check in-memory cache — instant return for already-loaded tiles
        const cached = this._cacheGet(cacheKey);
        if (cached) return { data: cached, width: x1 - x0, height: y1 - y0 };

        // 2. Check IndexedDB (if available) — survives page reloads
        if (this._tileDB) {
          try {
            const persisted = await getTileCached(this._tileDB, cacheKey);
            if (persisted) {
              this._cacheSet(cacheKey, persisted);
              return { data: persisted, width: x1 - x0, height: y1 - y0 };
            }
          } catch {
            // IndexedDB read failed — fall through to fetch
          }
        }

        // 3. Fetch via readRasters — store in both memory and IndexedDB
        const fetchAndCache = async () => {
          const ifdIndex = this._getIfdIndex(selection);
          const image = await this._tiff.getImage(ifdIndex);
          const rasters = await image.readRasters({ window: [x0, y0, x1, y1] });

          if (this._isInterleaved) {
            // Cache ALL bands — the big win for channel toggling.
            // readRasters already returned all bands; don't discard them.
            for (let band = 0; band < this._sizeC; band++) {
              const bandKey = `${x}-${y}-${band}-${z}-${t}`;
              const bandData = (rasters as any)[band] || rasters[0];
              this._cacheSet(bandKey, bandData);
              // Fire-and-forget write to IndexedDB
              if (this._tileDB) setTileCached(this._tileDB, bandKey, bandData);
            }
            return (rasters as any)[c] || rasters[0];
          } else {
            this._cacheSet(cacheKey, rasters[0]);
            // Fire-and-forget write to IndexedDB
            if (this._tileDB) setTileCached(this._tileDB, cacheKey, rasters[0] as ArrayBufferView);
            return rasters[0];
          }
        };

        try {
          const data = await fetchAndCache();
          return { data, width: x1 - x0, height: y1 - y0 };
        } catch (err: any) {
          // Detect presigned URL expiry and attempt refresh
          if (this._isUrlExpiredError(err)) {
            const refreshed = await this._refreshTiff();
            if (refreshed) {
              const data = await fetchAndCache();
              return { data, width: x1 - x0, height: y1 - y0 };
            }
          }
          throw err;
        }
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
    sourceType: SourceType,
    options?: { onUrlExpired?: OnUrlExpired; tileDB?: IDBDatabase }
  ): Promise<OmeLoaderResult | null> {
    isLoading.value = true;
    error.value = null;

    try {
      if (sourceType === "ome-tiff") {
        return await loadOmeTiff(source, options);
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
