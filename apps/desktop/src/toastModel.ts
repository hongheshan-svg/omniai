export type ToastKind = "success" | "error" | "info";

export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
  createdAt: string;
}

export const TOAST_TTL_MS = 5000;
export const MAX_TOASTS = 5;

export function pushToast(toasts: readonly Toast[], toast: Toast): Toast[] {
  const next = [...toasts, toast];
  return next.length > MAX_TOASTS ? next.slice(next.length - MAX_TOASTS) : next;
}

export function expireToasts(toasts: readonly Toast[], nowIso: string): Toast[] {
  const now = Date.parse(nowIso);
  return toasts.filter((toast) => Date.parse(toast.createdAt) + TOAST_TTL_MS > now);
}

export function dismissToast(toasts: readonly Toast[], id: string): Toast[] {
  return toasts.filter((toast) => toast.id !== id);
}
