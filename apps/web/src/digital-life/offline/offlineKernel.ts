import type { PresentationType } from "@mybrandos/shared";

const DB_NAME = "mybrandos-offline-kernel";
const DB_VERSION = 1;
const STORE = "publications";

export type OfflinePublication = {
  id: string;
  slug: string;
  title: string;
  caption: string;
  assetType: string;
  presentationTypes: PresentationType[];
  mediaUrl: string | null;
  coverUrl: string | null;
  savedAt: string;
  /** Cached media blob key hint — bytes live in Cache API when saved. */
  mediaCached: boolean;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("offline_kernel_open_failed"));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    const result = fn(store);
    tx.oncomplete = () => resolve(result ? (result as IDBRequest<T>).result : undefined);
    tx.onerror = () => reject(tx.error ?? new Error("offline_kernel_tx_failed"));
    if (result && "onsuccess" in result) {
      result.onsuccess = () => {
        /* resolved on tx complete */
      };
      result.onerror = () => reject(result.error);
    }
  });
}

export async function listOfflinePublications(): Promise<OfflinePublication[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve((req.result as OfflinePublication[]) ?? []);
    req.onerror = () => reject(req.error);
  });
}

export async function getOfflinePublication(id: string): Promise<OfflinePublication | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => resolve((req.result as OfflinePublication) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function isSavedOffline(id: string): Promise<boolean> {
  return Boolean(await getOfflinePublication(id));
}

/** Persist publication metadata + best-effort Cache API media for offline kernel. */
export async function savePublicationOffline(input: OfflinePublication): Promise<OfflinePublication> {
  let mediaCached = false;
  if (input.mediaUrl && "caches" in globalThis) {
    try {
      const cache = await caches.open("mybrandos-offline-media-v1");
      const res = await fetch(input.mediaUrl, { credentials: "include" });
      if (res.ok) {
        await cache.put(input.mediaUrl, res.clone());
        mediaCached = true;
      }
    } catch {
      mediaCached = false;
    }
  }
  if (input.coverUrl && "caches" in globalThis) {
    try {
      const cache = await caches.open("mybrandos-offline-media-v1");
      const res = await fetch(input.coverUrl, { credentials: "include" });
      if (res.ok) await cache.put(input.coverUrl, res.clone());
    } catch {
      /* cover optional */
    }
  }
  const row: OfflinePublication = { ...input, mediaCached, savedAt: new Date().toISOString() };
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(row);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  return row;
}

export async function removePublicationOffline(id: string, mediaUrl?: string | null, coverUrl?: string | null): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  if ("caches" in globalThis) {
    try {
      const cache = await caches.open("mybrandos-offline-media-v1");
      if (mediaUrl) await cache.delete(mediaUrl);
      if (coverUrl) await cache.delete(coverUrl);
    } catch {
      /* ignore */
    }
  }
}
