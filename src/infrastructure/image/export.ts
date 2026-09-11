import { zip, type Zippable } from "fflate";
import type { ImageMimeType } from "@/domain/models";
import { getPlatform } from "@/infrastructure/platform/capabilities";
import { convertForExport, extensionFor } from "./image-processing";

export interface ExportItem {
  blob: Blob;
  /** Base name without extension; sanitized here. */
  name: string;
}

export interface ExportOptions {
  type: ImageMimeType;
  quality?: number;
}

function sanitizeName(name: string): string {
  return (
    name
      .replace(/[^a-zA-Z0-9-_ ]+/g, "_")
      .trim()
      .slice(0, 80) || "image"
  );
}

/** Saves one file: native save dialog on Tauri, anchor download on the web. */
export async function saveFile(blob: Blob, fileName: string): Promise<boolean> {
  if (getPlatform().isTauri) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeFile } = await import("@tauri-apps/plugin-fs");
    const ext = fileName.split(".").pop() ?? "";
    const path = await save({ defaultPath: fileName, filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : [] });
    if (!path) return false;
    await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
    return true;
  }
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  return true;
}

export async function exportSingle(item: ExportItem, options: ExportOptions): Promise<boolean> {
  const blob = await convertForExport(item.blob, options.type, options.quality);
  return saveFile(blob, `${sanitizeName(item.name)}.${extensionFor(options.type)}`);
}

/** Builds a ZIP off the main thread as far as fflate allows (async, chunked). */
export async function buildZip(items: ExportItem[], options: ExportOptions): Promise<Blob> {
  const entries: Zippable = {};
  const used = new Set<string>();
  for (const item of items) {
    const converted = await convertForExport(item.blob, options.type, options.quality);
    let name = `${sanitizeName(item.name)}.${extensionFor(options.type)}`;
    let i = 2;
    while (used.has(name)) name = `${sanitizeName(item.name)}-${i++}.${extensionFor(options.type)}`;
    used.add(name);
    // Images are already compressed; store them without deflate to keep it fast.
    entries[name] = [new Uint8Array(await converted.arrayBuffer()), { level: 0 }];
  }
  const bytes = await new Promise<Uint8Array>((resolve, reject) => zip(entries, (err, data) => (err ? reject(err) : resolve(data))));
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/zip" });
}

export async function exportMany(items: ExportItem[], options: ExportOptions, archiveName: string): Promise<boolean> {
  if (items.length === 1 && items[0]) return exportSingle(items[0], options);
  const archive = await buildZip(items, options);
  return saveFile(archive, `${sanitizeName(archiveName)}.zip`);
}
