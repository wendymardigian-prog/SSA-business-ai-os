"use client";

import type { ContentPostStatus } from "@/lib/types/database";
import type { StatusOption } from "@/lib/content/piece-drawer";
import { cn } from "@/lib/utils";

/**
 * El estado de la pieza como dropdown (F96).
 *
 * Ofrece los estados que se pueden elegir; los que no, quedan deshabilitados
 * con el motivo en el `title`: "no se puede" sin explicacion obliga a
 * adivinar. El cambio lo ejecuta quien lo usa (mandar a revision y aprobar
 * avisan; devolver pide un motivo).
 */
export function StatusSelect({
  options,
  value,
  disabled,
  onChange,
}: {
  options: StatusOption[];
  value: ContentPostStatus;
  disabled?: boolean;
  onChange: (next: ContentPostStatus) => void;
}) {
  return (
    <select
      aria-label="Estado de la pieza"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as ContentPostStatus)}
      className={cn(
        "h-8 rounded-lg border border-border bg-background px-2 text-xs font-medium disabled:opacity-70",
        value === "failed" && "text-red-600 dark:text-red-400",
      )}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled} title={o.reason}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
