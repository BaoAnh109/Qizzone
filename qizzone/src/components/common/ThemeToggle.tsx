import { Monitor, Moon, Sun } from "lucide-react";
import { useThemeStore } from "@/store/themeStore";
import { cn } from "@/lib/utils";

interface ThemeToggleProps {
  variant?: "full" | "compact";
  className?: string;
}

export function ThemeToggle({ variant = "full", className }: ThemeToggleProps) {
  const preference = useThemeStore((state) => state.preference);
  const isDark = useThemeStore((state) => state.isDark);
  const setPreference = useThemeStore((state) => state.setPreference);

  const toggleTheme = () => setPreference(isDark ? "light" : "dark");

  if (variant === "compact") {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={isDark}
        aria-label={isDark ? "Chuyển sang giao diện sáng" : "Chuyển sang giao diện tối"}
        title={isDark ? "Chuyển sang giao diện sáng" : "Chuyển sang giao diện tối"}
        onClick={toggleTheme}
        className={cn(
          "theme-toggle-compact flex h-11 w-11 items-center justify-center rounded-full border theme-border theme-surface-raised theme-text-secondary shadow-xs transition-colors theme-hover-surface focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary",
          className
        )}
      >
        {isDark ? <Sun className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}
      </button>
    );
  }

  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {isDark ? (
            <Moon className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          ) : (
            <Sun className="h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
          )}
          <div className="min-w-0">
            <p className="text-sm font-medium theme-text-secondary">Giao diện tối</p>
            <p className="text-[11px] theme-text-muted">
              {preference === "system" ? "Tự động theo thiết bị" : isDark ? "Đang bật" : "Đang tắt"}
            </p>
          </div>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={isDark}
          aria-label="Giao diện tối"
          onClick={toggleTheme}
          className="theme-toggle-track relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          <span
            className={cn(
              "theme-switch-thumb pointer-events-none h-5 w-5 rounded-full shadow-sm transition-transform",
              isDark ? "translate-x-5" : "translate-x-0.5"
            )}
          />
        </button>
      </div>

      {preference !== "system" && (
        <button
          type="button"
          onClick={() => setPreference("system")}
          className="theme-link inline-flex min-h-11 items-center gap-1.5 rounded px-1 text-[11px] font-medium transition focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Monitor className="h-3.5 w-3.5" aria-hidden="true" />
          Dùng theo giao diện thiết bị
        </button>
      )}
    </div>
  );
}

export default ThemeToggle;
