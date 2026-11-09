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
  primary: "theme-button-primary shadow-xs hover:shadow-sm focus-visible:ring-primary",
  default: "theme-button-default shadow-xs focus-visible:ring-primary",
  secondary: "theme-button-secondary focus-visible:ring-primary",
  outline: "theme-button-outline focus-visible:ring-primary",
  destructive: "theme-button-destructive shadow-xs focus-visible:ring-rose-500",
  ghost: "theme-button-ghost focus-visible:ring-primary",
  link:
    "theme-link min-h-11 rounded-md px-2 underline-offset-4 hover:underline focus-visible:ring-primary font-medium",
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: "h-9 px-3 text-xs gap-1.5 rounded-md",
  md: "h-11 px-4 text-sm gap-2 rounded-lg",
  lg: "h-12 px-6 text-base gap-2 rounded-lg",
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
          "inline-flex items-center justify-center font-semibold transition-[background-color,border-color,color,box-shadow] duration-150 cursor-pointer select-none",
          "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]",
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
