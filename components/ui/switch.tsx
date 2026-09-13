"use client";

import { cn } from "@/lib/utils";

/**
 * Interruptor accesible (role="switch"). Un solo lugar para el switch de
 * encendido: la bandeja y la pantalla de Agentes lo usan igual.
 */
export function Switch({
  checked,
  onChange,
  disabled = false,
  label,
  size = "md",
  describedBy,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  /** Nombre accesible. Obligatorio: un switch sin nombre no se entiende con lector de pantalla. */
  label: string;
  size?: "sm" | "md";
  describedBy?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        size === "sm" ? "h-4 w-7" : "h-5 w-9",
        checked ? "bg-emerald-600" : "bg-muted-foreground/30",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <span
        className={cn(
          "inline-block transform rounded-full bg-white shadow transition-transform",
          size === "sm" ? "h-3 w-3" : "h-4 w-4",
          checked ? (size === "sm" ? "translate-x-3.5" : "translate-x-4.5") : "translate-x-0.5",
        )}
      />
    </button>
  );
}
