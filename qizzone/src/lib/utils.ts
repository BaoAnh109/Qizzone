import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Combines conditional class names with Tailwind merge support
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
