"use client";

import { Globe } from "lucide-react";
import { TimezoneSelect as BaseSelect } from "@/components/ui/timezone-select";

/**
 * El selector de zona horaria del invitado (F25).
 *
 * Arranca en la zona del navegador. Cambiarla recalcula los horarios: son los
 * mismos momentos, contados desde otra zona.
 */
export function TimezoneSelect({
  value,
  onChange,
  id = "booker-tz",
}: {
  value: string;
  onChange: (tz: string) => void;
  id?: string;
}) {
  return (
    <label htmlFor={id} className="flex items-center gap-2 text-sm text-muted-foreground">
      <Globe className="h-4 w-4 shrink-0" aria-hidden />
      <span className="sr-only">Zona horaria</span>
      <BaseSelect
        id={id}
        value={value}
        onChange={onChange}
        className="min-w-0 flex-1 truncate rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
      />
    </label>
  );
}
