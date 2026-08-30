import React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type ButtonVariant =
  | "default"
  | "primary"
  | "secondary"
  | "outline"
  | "destructive"
  | "ghost"
  | "link";

export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    "bg-indigo-600 text-white shadow-xs hover:bg-indigo-700 active:bg-indigo-800 focus-visible:ring-indigo-500",
  default:
    "bg-neutral-900 text-white shadow-xs hover:bg-neutral-800 active:bg-neutral-950 focus-visible:ring-neutral-500",
  secondary:
    "bg-neutral-100 text-neutral-900 shadow-xs hover:bg-neutral-200 active:bg-neutral-300 focus-visible:ring-neutral-400",
  outline:
    "border border-neutral-300 bg-white text-neutral-700 shadow-xs hover:bg-neutral-50 hover:text-neutral-900 active:bg-neutral-100 focus-visible:ring-neutral-400",
  destructive:
    "bg-rose-600 text-white shadow-xs hover:bg-rose-700 active:bg-rose-800 focus-visible:ring-rose-500",
  ghost:
    "text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900 active:bg-neutral-200 focus-visible:ring-neutral-400",
  link:
    "text-indigo-600 underline-offset-4 hover:underline focus-visible:ring-indigo-500 p-0 h-auto font-normal",
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs gap-1.5 rounded-md",
  md: "h-10 px-4 text-sm gap-2 rounded-lg",
  lg: "h-12 px-6 text-base gap-2.5 rounded-xl",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "primary",
      size = "md",
      isLoading = false,
      leftIcon,
      rightIcon,
      disabled,
      children,
      type = "button",
      ...props
    },
    ref
  ) => {
    const isLink = variant === "link";

    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || isLoading}
        aria-busy={isLoading}
        className={cn(
          "inline-flex items-center justify-center font-medium transition-all duration-150 cursor-pointer select-none",
          "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-offset-2",
          "disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none",
          !isLink && sizeStyles[size],
          variantStyles[variant],
          className
        )}
        {...props}
      >
        {isLoading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin shrink-0" />
            <span>{children}</span>
          </>
        ) : (
          <>
            {leftIcon && <span className="shrink-0">{leftIcon}</span>}
            {children}
            {rightIcon && <span className="shrink-0">{rightIcon}</span>}
          </>
        )}
      </button>
    );
  }
);

Button.displayName = "Button";

export default Button;
