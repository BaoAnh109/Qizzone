import React from "react";
import { cn } from "@/lib/utils";

export type BadgeVariant =
  | "default"
  | "primary"
  | "secondary"
  | "success"
  | "warning"
  | "destructive"
  | "outline"
  | "draft"
  | "published"
  | "closed"
  | "active";

export type BadgeSize = "sm" | "md";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: BadgeSize;
  dot?: boolean;
}

const variantStyles: Record<BadgeVariant, string> = {
  default: "theme-surface-muted theme-text-secondary theme-border",
  primary: "theme-status-info",
  secondary: "theme-surface-inset theme-text-secondary theme-border",
  success: "theme-status-success",
  warning: "theme-status-warning",
  destructive: "theme-status-danger",
  outline: "bg-transparent theme-text-secondary theme-border",
  // Quiz Status Variants
  draft: "theme-surface-muted theme-text-secondary theme-border",
  published: "theme-status-success",
  closed: "theme-status-danger",
  active: "theme-status-info",
};

const dotColors: Record<BadgeVariant, string> = {
  default: "theme-dot-muted",
  primary: "theme-dot-info",
  secondary: "theme-dot-secondary",
  success: "theme-dot-success",
  warning: "theme-dot-warning",
  destructive: "theme-dot-danger",
  outline: "theme-dot-muted",
  draft: "theme-dot-muted",
  published: "theme-dot-success",
  closed: "theme-dot-danger",
  active: "theme-dot-info",
};

const sizeStyles: Record<BadgeSize, string> = {
  sm: "px-2 py-0.5 text-xs gap-1",
  md: "px-2.5 py-1 text-xs font-medium gap-1.5",
};

export function Badge({
  className,
  variant = "default",
  size = "md",
  dot = false,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border font-medium transition-colors select-none",
        sizeStyles[size],
        variantStyles[variant],
        className
      )}
      {...props}
    >
      {dot && (
        <span
          className={cn("h-1.5 w-1.5 rounded-full shrink-0", dotColors[variant])}
          aria-hidden="true"
        />
      )}
      {children}
    </span>
  );
}

export default Badge;
