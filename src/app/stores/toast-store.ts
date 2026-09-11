import { create } from "zustand";

export type ToastKind = "info" | "success" | "error";

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  /** Optional undo/retry style action. */
  action?: { label: string; onClick: () => void };
}

interface ToastState {
  toasts: Toast[];
  push(kind: ToastKind, message: string, action?: Toast["action"], ttlMs?: number): number;
  dismiss(id: number): void;
}

let nextId = 1;

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push(kind, message, action, ttlMs = kind === "error" ? 8000 : 4000) {
    const id = nextId++;
    const toast: Toast = { id, kind, message, ...(action ? { action } : {}) };
    set({ toasts: [...get().toasts, toast].slice(-4) });
    if (ttlMs > 0) setTimeout(() => get().dismiss(id), ttlMs);
    return id;
  },
  dismiss(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
}));

export const toast = {
  info: (message: string, action?: Toast["action"]) => useToastStore.getState().push("info", message, action),
  success: (message: string, action?: Toast["action"]) => useToastStore.getState().push("success", message, action),
  error: (message: string, action?: Toast["action"]) => useToastStore.getState().push("error", message, action),
};
