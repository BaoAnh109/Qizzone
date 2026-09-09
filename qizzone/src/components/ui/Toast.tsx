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
  success: <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />,
  error: <AlertCircle className="h-5 w-5 text-rose-600 shrink-0" />,
  warning: <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />,
  info: <Info className="h-5 w-5 text-indigo-600 shrink-0" />,
};

const typeStyles: Record<ToastType, string> = {
  success: "border-emerald-200 bg-emerald-50/90 text-emerald-950",
  error: "border-rose-200 bg-rose-50/90 text-rose-950",
  warning: "border-amber-200 bg-amber-50/90 text-amber-950",
  info: "border-indigo-200 bg-indigo-50/90 text-indigo-950",
};

export function Toast({ toast, onDismiss }: ToastProps) {
  return (
    <div
      role="alert"
      className={cn(
        "pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border bg-white p-4 shadow-lg",
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
        className="rounded-md p-1 opacity-60 hover:opacity-100 hover:bg-black/5 transition cursor-pointer"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export default Toast;
