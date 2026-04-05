// IndexedDB persistence layer for OME tile data.
// Wraps the raw IndexedDB API in simple promise-based helpers.
// Each tile is stored as its own IndexedDB row keyed by "x-y-c-z-t".

const STORE_NAME = 'tiles';

/**
 * Hash a cacheId (typically a file path) into a short, safe string
 * suitable for use as an IndexedDB database name.
 */
async function hashCacheId(cacheId: string): Promise<string> {
  const encoded = new TextEncoder().encode(cacheId);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function openTileDB(cacheId: string): Promise<IDBDatabase> {
  const hash = await hashCacheId(cacheId);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(`ome-tiles-${hash}`, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function getTileCached(db: IDBDatabase, key: string): Promise<ArrayBufferView | null> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(key);

    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

export function setTileCached(db: IDBDatabase, key: string, data: ArrayBufferView): void {
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(data, key);
  } catch {
    // Fire-and-forget — silently ignore write failures
  }
}

export function clearTileDB(db: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.clear();

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
