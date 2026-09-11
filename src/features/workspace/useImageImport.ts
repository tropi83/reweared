import { useCallback, useEffect, useRef, useState } from "react";
import { navigate } from "@/app/router";
import { useProjectsStore } from "@/app/stores/projects-store";
import { toast } from "@/app/stores/toast-store";
import { MAX_IMPORT_BYTES, toGenerationError } from "@/domain/models";
import { t } from "@/i18n";
import { createLogger } from "@/lib/logger";

const log = createLogger("import");

/** Creates a project from a file and navigates to it. Shared by every import entry point. */
export async function importImageFile(file: Blob, fileName?: string): Promise<boolean> {
  try {
    const doc = await useProjectsStore.getState().createFromFile(file, fileName ?? (file instanceof File ? file.name : undefined));
    navigate({ name: "project", id: doc.project.id });
    return true;
  } catch (err) {
    const error = toGenerationError(err);
    log.warn("import failed", error.code);
    const maxMb = Math.round(MAX_IMPORT_BYTES / 1024 / 1024);
    const message =
      error.detail === "TOO_LARGE"
        ? t("import.error.tooLarge", { maxMb })
        : error.code === "UNSUPPORTED_FORMAT"
          ? t("import.error.unsupported")
          : error.code === "INVALID_IMAGE"
            ? t("import.error.decode")
            : t("import.error.generic");
    toast.error(message);
    return false;
  }
}

export function firstImageFile(list: FileList | DataTransferItemList | null | undefined): File | null {
  if (!list) return null;
  for (const item of Array.from(list as ArrayLike<File | DataTransferItem>)) {
    if (item instanceof File) {
      if (item.type.startsWith("image/") || item.type === "") return item;
    } else if (item.kind === "file") {
      const file = item.getAsFile();
      if (file && (file.type.startsWith("image/") || file.type === "")) return file;
    }
  }
  return null;
}

/** Opens the platform file picker (native dialog on Tauri, <input type=file> on the web). */
export async function pickImageFile(): Promise<File | null> {
  const { getPlatform } = await import("@/infrastructure/platform/capabilities");
  if (getPlatform().nativeDialogs) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const { readFile } = await import("@tauri-apps/plugin-fs");
    const path = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif"] }],
    });
    if (!path) return null;
    const bytes = await readFile(path);
    const name = path.split(/[\\/]/).pop() ?? "image";
    return new File([bytes as Uint8Array<ArrayBuffer>], name);
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif";
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/** Global paste + window-level drag/drop so an image can be imported from anywhere. */
export function useGlobalImport() {
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.isContentEditable)) {
        // Allow images pasted into the prompt editor too; text pastes are left alone.
        if (!firstImageFile(e.clipboardData?.items)) return;
      }
      const file = firstImageFile(e.clipboardData?.items);
      if (!file) return;
      e.preventDefault();
      const named = file.name && !/^image\.(png|jpe?g|webp|gif)$/i.test(file.name) ? file.name : "Pasted image";
      void importImageFile(file, named);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);
}

/** Drag-and-drop state for a drop zone element. */
export function useDropZone(onFile: (file: File) => void) {
  const [active, setActive] = useState(false);
  const depth = useRef(0);

  const onDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    depth.current++;
    if (e.dataTransfer.types.includes("Files")) setActive(true);
  }, []);
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);
  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setActive(false);
  }, []);
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      depth.current = 0;
      setActive(false);
      const file = firstImageFile(e.dataTransfer.files);
      if (file) onFile(file);
      else toast.error(t("import.error.unsupported"));
    },
    [onFile],
  );

  return { active, handlers: { onDragEnter, onDragOver, onDragLeave, onDrop } };
}
