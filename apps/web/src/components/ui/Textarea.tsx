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
    const textareaId =
      id || (label ? label.toLowerCase().replace(/\s+/g, "-") : undefined);

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
            "theme-control w-full rounded-md border px-3 py-2.5 text-sm theme-placeholder-muted",
            "transition-colors duration-150",
            "focus-visible:outline-hidden focus-visible:ring-2",
            error
              ? "border-rose-500 focus-visible:border-rose-500 focus-visible:ring-rose-500 text-rose-900"
              : "theme-border-strong focus-visible:border-blue-600 focus-visible:ring-blue-200",
            disabled && "cursor-not-allowed theme-surface-muted theme-text-muted opacity-70",
            className
          )}
          {...props}
        />

        {error ? (
          <p id={`${textareaId}-error`} className="text-xs font-medium text-rose-600">
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
