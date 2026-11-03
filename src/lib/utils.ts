import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// Standard shadcn/ui helper: merges conditional class names, then resolves
// conflicting Tailwind utilities (e.g. two different `p-*` values) so the
// later one wins instead of both landing in the DOM.
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
