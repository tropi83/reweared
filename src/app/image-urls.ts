import { useEffect, useState } from "react";
import type { ImageBucket } from "@/infrastructure/storage";
import { getServices } from "./services";

/**
 * Object-URL cache for images loaded from storage. Bounded LRU: evicted URLs are revoked so
 * a listing with hundreds of images does not pin every blob in memory.
 */
const MAX_ENTRIES = 400;
const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();

function key(listingId: string, bucket: ImageBucket, assetId: string) {
  return `${listingId}/${bucket}/${assetId}`;
}

function touch(k: string, url: string) {
  cache.delete(k);
  cache.set(k, url);
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    const old = cache.get(oldest);
    cache.delete(oldest);
    if (old) URL.revokeObjectURL(old);
  }
}

export async function loadImageUrl(listingId: string, bucket: ImageBucket, assetId: string): Promise<string | null> {
  const k = key(listingId, bucket, assetId);
  const hit = cache.get(k);
  if (hit) {
    touch(k, hit);
    return hit;
  }
  const pending = inflight.get(k);
  if (pending) return pending;
  const promise = (async () => {
    const blob = await getServices().storage.readImage(listingId, bucket, assetId);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    touch(k, url);
    return url;
  })().finally(() => inflight.delete(k));
  inflight.set(k, promise);
  return promise;
}

/** Registers a blob that was just written, avoiding an immediate re-read from storage. */
export function primeImageUrl(listingId: string, bucket: ImageBucket, assetId: string, blob: Blob): string {
  const k = key(listingId, bucket, assetId);
  const existing = cache.get(k);
  if (existing) URL.revokeObjectURL(existing);
  const url = URL.createObjectURL(blob);
  touch(k, url);
  return url;
}

export function evictImageUrls(listingId: string, assetId?: string) {
  for (const [k, url] of [...cache.entries()]) {
    if (!k.startsWith(`${listingId}/`)) continue;
    if (assetId && !k.endsWith(`/${assetId}`)) continue;
    cache.delete(k);
    URL.revokeObjectURL(url);
  }
}

export function useImageUrl(listingId: string | undefined, bucket: ImageBucket, assetId: string | undefined): string | null {
  const k = listingId && assetId ? key(listingId, bucket, assetId) : null;
  const [state, setState] = useState<{ k: string | null; url: string | null }>(() => ({ k, url: k ? (cache.get(k) ?? null) : null }));

  // Reset synchronously when the target changes (React's "adjust state on prop change" pattern).
  if (state.k !== k) setState({ k, url: k ? (cache.get(k) ?? null) : null });

  useEffect(() => {
    if (!listingId || !assetId || !k || cache.has(k)) return;
    let cancelled = false;
    void loadImageUrl(listingId, bucket, assetId).then((url) => {
      if (!cancelled) setState((prev) => (prev.k === k ? { k, url } : prev));
    });
    return () => {
      cancelled = true;
    };
  }, [listingId, bucket, assetId, k]);

  return state.k === k ? state.url : null;
}
