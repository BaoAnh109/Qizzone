import { createContext } from "react";
import type { ToastType } from "@/components/ui/Toast";

export interface ToastContextValue {
  showToast: (options: {
    type?: ToastType;
    title?: string;
    message: string;
    duration?: number;
  }) => void;
  success: (message: string, title?: string) => void;
  error: (message: string, title?: string) => void;
  warning: (message: string, title?: string) => void;
  info: (message: string, title?: string) => void;
  dismissToast: (id: string) => void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);
