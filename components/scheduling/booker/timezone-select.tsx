"use client";

import { listTimeZones } from "@/lib/timezone";
import { gmtOffsetLabel } from "@/lib/scheduling/booker/format";
import { Globe } from "lucide-react";

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
  // La zona del navegador puede no estar en el catálogo: se suma adelante.
  const all = listTimeZones();
  const options = all.includes(value) ? all : [value, ...all];
  const now = new Date();

  return (
    <label htmlFor={id} className="flex items-center gap-2 text-sm text-muted-foreground">
      <Globe className="h-4 w-4 shrink-0" aria-hidden />
      <span className="sr-only">Zona horaria</span>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-0 flex-1 truncate rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
      >
        {options.map((tz) => (
          <option key={tz} value={tz}>
            {tz.replace(/_/g, " ")} ({gmtOffsetLabel(now, tz)})
          </option>
        ))}
      </select>
    </label>
  );
}
