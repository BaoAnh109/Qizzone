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
            className="block text-sm font-medium text-neutral-800 select-none"
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
            "w-full rounded-lg border bg-white px-3.5 py-2.5 text-sm text-neutral-900 placeholder:text-neutral-400",
            "transition-colors duration-150 shadow-xs",
            "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-offset-1",
            error
              ? "border-rose-500 focus-visible:border-rose-500 focus-visible:ring-rose-500 text-rose-900"
              : "border-neutral-300 focus-visible:border-indigo-600 focus-visible:ring-indigo-500",
            disabled && "cursor-not-allowed bg-neutral-50 text-neutral-400 opacity-70",
            className
          )}
          {...props}
        />

        {error ? (
          <p id={`${textareaId}-error`} className="text-xs font-medium text-rose-600">
            {error}
          </p>
        ) : helperText ? (
          <p id={`${textareaId}-helper`} className="text-xs text-neutral-500">
            {helperText}
          </p>
        ) : null}
      </div>
    );
  }
);

Textarea.displayName = "Textarea";

export default Textarea;
