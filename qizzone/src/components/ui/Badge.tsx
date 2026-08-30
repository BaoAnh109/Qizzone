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
  default: "bg-neutral-100 text-neutral-800 border-neutral-200",
  primary: "bg-indigo-50 text-indigo-700 border-indigo-200",
  secondary: "bg-neutral-200 text-neutral-800 border-neutral-300",
  success: "bg-emerald-50 text-emerald-700 border-emerald-200",
  warning: "bg-amber-50 text-amber-800 border-amber-200",
  destructive: "bg-rose-50 text-rose-700 border-rose-200",
  outline: "bg-transparent text-neutral-700 border-neutral-300",
  // Quiz Status Variants
  draft: "bg-neutral-100 text-neutral-700 border-neutral-300",
  published: "bg-emerald-50 text-emerald-700 border-emerald-200",
  closed: "bg-rose-50 text-rose-700 border-rose-200",
  active: "bg-indigo-50 text-indigo-700 border-indigo-200",
};

const dotColors: Record<BadgeVariant, string> = {
  default: "bg-neutral-500",
  primary: "bg-indigo-500",
  secondary: "bg-neutral-600",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  destructive: "bg-rose-500",
  outline: "bg-neutral-400",
  draft: "bg-neutral-500",
  published: "bg-emerald-500",
  closed: "bg-rose-500",
  active: "bg-indigo-500",
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
        "inline-flex items-center rounded-full border font-medium transition-colors select-none",
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
