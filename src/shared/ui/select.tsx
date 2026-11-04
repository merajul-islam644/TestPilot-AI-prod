// App-wide select dropdown -- replaces every native <select> so the popup
// is themed like the rest of the UI (the native one renders white in dark
// mode and is unreadable). Built on Radix's select primitive: portal,
// flip/shift positioning, arrow-key + typeahead navigation, Esc-to-close
// and outside-click come free; the styling mirrors dropdown-menu.tsx's
// token classes so menus and selects read as one system.
//
// Call sites stay native-select-shaped: pass `items` ({value, label},
// optionally disabled/icon), `value` and `onChange`. Empty string means
// "no selection" and shows the placeholder in muted text -- Radix forbids
// "" as an item value, so the sentinel below translates at the boundary.

import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "../../lib/utils";

export type SelectItem = {
  value: string;
  label: string;
  disabled?: boolean;
  /** Optional leading glyph rendered in the row and in the trigger when
   *  this item is selected (e.g. the project icon picker). */
  icon?: React.ReactNode;
};

/** Radix throws on "" item values; "" (no selection) rides as this. */
const NONE = "__none__";

export function Select({ ariaLabel, className, disabled, items, onChange, placeholder, size, title, value }: {
  ariaLabel?: string;
  /** Extra trigger classes -- pass "w-full" inside form fields. */
  className?: string;
  disabled?: boolean;
  items: SelectItem[];
  onChange: (value: string) => void;
  /** Shown (muted) in the trigger while value is "". */
  placeholder?: string;
  /** "sm" fits compact chrome (workbench panel header). */
  size?: "sm";
  title?: string;
  value: string;
}) {
  const selected = items.find((item) => item.value === value);
  return (
    <SelectPrimitive.Root
      disabled={disabled}
      onValueChange={(next) => onChange(next === NONE ? "" : next)}
      value={value === "" ? NONE : value}
    >
      <SelectPrimitive.Trigger
        aria-label={ariaLabel}
        className={cn(
          "flex items-center justify-between gap-2 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-left text-[hsl(var(--foreground))] transition-colors",
          "data-[state=open]:border-[hsl(var(--primary))] focus:border-[hsl(var(--primary))] focus:outline-none",
          "disabled:cursor-not-allowed disabled:opacity-50 [&>span]:min-w-0",
          size === "sm"
            ? "h-7 gap-1.5 rounded-md px-2 text-[12.5px]"
            : "h-9 px-3 text-[13.5px]",
          className
        )}
        title={title}
      >
        <span className="flex min-w-0 items-center gap-2 truncate">
          {selected
            ? (
                <>
                  {selected.icon}
                  <span className="truncate">{selected.label}</span>
                </>
              )
            : <span className="truncate text-[hsl(var(--muted-foreground))]">{placeholder ?? " "}</span>}
        </span>
        <SelectPrimitive.Icon className="shrink-0 text-[hsl(var(--muted-foreground))]">
          <ChevronDown size={size === "sm" ? 12 : 14} />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          className={cn(
            // Above the app's modal backdrop (z-80), below the command
            // palette (z-100): selects open INSIDE modals all the time.
            "z-[90] max-h-[320px] overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--popover))] text-[hsl(var(--foreground))] shadow-lg",
            "data-[state=open]:animate-[blocks-menu-in_0.12s_ease-out]"
          )}
          position="popper"
          sideOffset={6}
        >
          <SelectPrimitive.Viewport
            className={cn("min-w-[var(--radix-select-trigger-width)] p-1.5", size === "sm" ? "text-[12.5px]" : "text-[13.5px]")}
          >
            {items.map((item) => (
              <SelectPrimitive.Item
                className={cn(
                  "flex cursor-pointer select-none items-center gap-2 rounded-lg py-2 pl-2.5 pr-2 font-medium outline-none",
                  "data-[highlighted]:bg-[hsl(var(--secondary))]",
                  "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
                  size === "sm" ? "text-[12.5px]" : "text-[13.5px]",
                  item.disabled ? "opacity-50" : undefined
                )}
                disabled={item.disabled}
                key={item.value}
                value={item.value === "" ? NONE : item.value}
              >
                <SelectPrimitive.ItemText asChild>
                  <span className="flex min-w-0 items-center gap-2 truncate">
                    {item.icon}
                    <span className="truncate">{item.label}</span>
                  </span>
                </SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="ml-auto shrink-0 text-[hsl(var(--foreground))]">
                  <Check size={13} />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
