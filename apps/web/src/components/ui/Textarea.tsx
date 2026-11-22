import React from "react";
import { cn } from "@/lib/utils";

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  helperText?: string;
  error?: string;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    { className, label, helperText, error, id, disabled, rows = 4, ...props },
    ref
  ) => {
    const generatedId = React.useId();
    const textareaId =
      id || (label ? label.toLowerCase().replace(/\s+/g, "-") : generatedId);

    return (
      <div className="w-full space-y-1.5 text-left">
        {label && (
          <label
            htmlFor={textareaId}
            className="block text-sm font-medium theme-text-secondary select-none"
          >
            {label}
          </label>
        )}

        <textarea
          ref={ref}
          id={textareaId}
          rows={rows}
          disabled={disabled}
          aria-invalid={!!error}
          aria-describedby={
            error
              ? `${textareaId}-error`
              : helperText
              ? `${textareaId}-helper`
              : undefined
          }
          className={cn(
            "theme-control w-full rounded-lg border px-3.5 py-2.5 text-base sm:text-sm theme-placeholder-muted",
            "transition-colors duration-150",
            "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]",
            error
              ? "border-[var(--status-danger-border)] focus-visible:border-[var(--status-danger-foreground)] focus-visible:ring-[var(--status-danger-foreground)] text-[var(--status-danger-foreground)]"
              : "focus-visible:border-focus focus-visible:ring-focus",
            disabled && "cursor-not-allowed theme-surface-muted theme-text-muted opacity-70",
            className
          )}
          {...props}
        />

        {error ? (
          <p id={`${textareaId}-error`} className="text-xs font-medium text-status-danger">
            {error}
          </p>
        ) : helperText ? (
          <p id={`${textareaId}-helper`} className="text-xs theme-text-muted">
            {helperText}
          </p>
        ) : null}
      </div>
    );
  }
);

Textarea.displayName = "Textarea";

export default Textarea;
