import React from "react";
import { cn } from "@/lib/utils";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  helperText?: string;
  error?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      type = "text",
      label,
      helperText,
      error,
      leftIcon,
      rightIcon,
      id,
      disabled,
      ...props
    },
    ref
  ) => {
    const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, "-") : undefined);

    return (
      <div className="w-full space-y-1.5 text-left">
        {label && (
          <label
            htmlFor={inputId}
            className="block text-sm font-medium text-neutral-800 select-none"
          >
            {label}
          </label>
        )}

        <div className="relative flex items-center">
          {leftIcon && (
            <div className="pointer-events-none absolute left-3 flex items-center text-neutral-400">
              {leftIcon}
            </div>
          )}

          <input
            ref={ref}
            id={inputId}
            type={type}
            disabled={disabled}
            aria-invalid={!!error}
            aria-describedby={
              error
                ? `${inputId}-error`
                : helperText
                ? `${inputId}-helper`
                : undefined
            }
            className={cn(
              "w-full rounded-lg border bg-white px-3.5 py-2 text-sm text-neutral-900 placeholder:text-neutral-400",
              "transition-colors duration-150 shadow-xs",
              "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-offset-1",
              error
                ? "border-rose-500 focus-visible:border-rose-500 focus-visible:ring-rose-500 text-rose-900"
                : "border-neutral-300 focus-visible:border-indigo-600 focus-visible:ring-indigo-500",
              disabled && "cursor-not-allowed bg-neutral-50 text-neutral-400 opacity-70",
              leftIcon && "pl-10",
              rightIcon && "pr-10",
              className
            )}
            {...props}
          />

          {rightIcon && (
            <div className="absolute right-3 flex items-center text-neutral-400">
              {rightIcon}
            </div>
          )}
        </div>

        {error ? (
          <p id={`${inputId}-error`} className="text-xs font-medium text-rose-600">
            {error}
          </p>
        ) : helperText ? (
          <p id={`${inputId}-helper`} className="text-xs text-neutral-500">
            {helperText}
          </p>
        ) : null}
      </div>
    );
  }
);

Input.displayName = "Input";

export default Input;
