import type { Toast } from "../toastModel";

export interface ToastHostProps {
  toasts: Toast[];
  onDismiss(id: string): void;
}

export function ToastHost({ toasts, onDismiss }: ToastHostProps) {
  return (
    <div className="toasts" aria-label="通知">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast toast--${toast.kind}`}
          role={toast.kind === "error" ? "alert" : "status"}
        >
          <span>{toast.message}</span>
          <button type="button" aria-label="关闭通知" onClick={() => onDismiss(toast.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
