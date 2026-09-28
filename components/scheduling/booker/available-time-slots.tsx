"use client";

/**
 * Los horarios del dia elegido (F25).
 *
 * Se muestran en la zona del invitado. La lista es de botones: con teclado se
 * recorre con tabulador, sin trucos.
 */

import type { Slot } from "@/lib/scheduling/types";
import { capitalize, formatDateLong, formatSlotLabel } from "@/lib/scheduling/booker/format";

export function AvailableTimeSlots({
  date,
  slots,
  timezone,
  timeFormat,
  onPick,
  loading,
}: {
  date: string | null;
  slots: Slot[];
  timezone: string;
  timeFormat: "12h" | "24h";
  onPick: (slot: Slot) => void;
  loading: boolean;
}) {
  if (!date) {
    return (
      <div className="flex flex-col gap-2 border-t border-border p-5 md:border-l md:border-t-0">
        <p className="text-sm text-muted-foreground">Elegí un día para ver los horarios.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 border-t border-border p-5 md:border-l md:border-t-0">
      <p className="font-semibold">{capitalize(formatDateLong(`${date}T12:00:00.000Z`, "UTC"))}</p>
      <p className="text-xs text-muted-foreground">Horarios en tu zona</p>

      {loading && <p className="mt-2 text-sm text-muted-foreground">Buscando horarios…</p>}

      {!loading && slots.length === 0 && <p className="mt-2 text-sm text-muted-foreground">Ese día no quedan horarios.</p>}

      <div className="mt-1 flex max-h-[22rem] flex-col gap-2 overflow-y-auto pr-1">
        {slots.map((slot) => (
          <button
            key={slot.startUtc}
            type="button"
            onClick={() => onPick(slot)}
            className="w-full rounded-lg border border-border px-3 py-2.5 text-sm font-medium tabular-nums hover:border-ring hover:bg-muted"
          >
            {formatSlotLabel(slot.startUtc, timezone, timeFormat)}
          </button>
        ))}
      </div>
    </div>
  );
}
