import type { Readable } from "node:stream";

export interface StoredObject {
  body: Readable;
  contentType: string;
  contentLength: number;
}

/**
 * Image bytes, outside the database. Keys come from `keys.ts` only. Implementations: `S3ObjectStore` (SeaweedFS
 * in compose, any S3-compatible service in production), `MemoryObjectStore` (unit tests).
 */
export interface ObjectStore {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** `null` when the object does not exist. */
  get(key: string): Promise<StoredObject | null>;
  /** Deleting a missing object is not an error. */
  delete(key: string): Promise<void>;
  /** Removes every object under `prefix` and returns how many were removed. */
  deletePrefix(prefix: string): Promise<number>;
  /** Throws when the store or the bucket cannot be reached (readiness). */
  ping(): Promise<void>;
}
