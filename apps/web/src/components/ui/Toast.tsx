import React from "react";
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type ToastType = "success" | "error" | "warning" | "info";

export interface ToastItem {
  id: string;
  type: ToastType;
  title?: string;
  message: string;
  duration?: number;
}

export interface ToastProps {
  toast: ToastItem;
  onDismiss: (id: string) => void;
}

const icons: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle2 className="h-5 w-5 text-status-success shrink-0" aria-hidden="true" />,
  error: <AlertCircle className="h-5 w-5 text-status-danger shrink-0" aria-hidden="true" />,
  warning: <AlertTriangle className="h-5 w-5 text-status-warning shrink-0" aria-hidden="true" />,
  info: <Info className="h-5 w-5 text-status-accent shrink-0" aria-hidden="true" />,
};

const typeStyles: Record<ToastType, string> = {
  success: "theme-status-success",
  error: "theme-status-danger",
  warning: "theme-status-warning",
  info: "theme-status-accent",
};

export function Toast({ toast, onDismiss }: ToastProps) {
  return (
    <div
      role="alert"
      className={cn(
        "pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border p-4 shadow-lg",
        "animate-in slide-in-from-top-2 sm:slide-in-from-bottom-2 duration-200 transition-all",
        typeStyles[toast.type]
      )}
    >
      <div className="mt-0.5">{icons[toast.type]}</div>

      <div className="flex-1 min-w-0">
        {toast.title && (
          <h4 className="text-sm font-semibold leading-none mb-1">
            {toast.title}
          </h4>
        )}
        <p className="text-xs leading-relaxed opacity-90">{toast.message}</p>
      </div>

      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Đóng thông báo"
        className="flex min-h-8 min-w-8 items-center justify-center rounded-md p-1 opacity-75 hover:opacity-100 theme-hover-surface focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-focus transition cursor-pointer"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

export default Toast;
