import { isTauri } from "@/infrastructure/platform/capabilities";
import { IndexedDbStorage } from "./IndexedDbStorage";
import type { StorageProvider } from "./StorageProvider";
import { TauriFsStorage } from "./TauriFsStorage";

export type { ImageBucket, StorageProvider, StorageUsage } from "./StorageProvider";

export function createStorageProvider(): StorageProvider {
  return isTauri() ? new TauriFsStorage() : new IndexedDbStorage();
}
