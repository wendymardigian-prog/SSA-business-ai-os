"use client";

/**
 * Cuando el horario elegido se acaba de ocupar, los huecos libres siguientes como botones. Elegir uno solo
 * cambia el horario del formulario: la reserva se confirma otra vez con el botón de siempre (y pasa por toda la
 * comprobación del servidor). Sirve a la página pública y a «Agendar» del equipo.
 */
import { capitalize, formatSlotSummary } from "@/lib/scheduling/booker/format";

export function NextSlotsOffer({
  alternatives,
  durationMinutes,
  timezone,
  timeFormat,
  onPick,
  disabled,
}: {
  alternatives: readonly string[];
  durationMinutes: number;
  timezone: string;
  timeFormat: "12h" | "24h";
  onPick: (slot: { startUtc: string; endUtc: string }) => void;
  disabled?: boolean;
}) {
  if (alternatives.length === 0) return null;
  return (
    <div role="group" aria-label="Próximos horarios libres" className="mt-3 rounded-lg border border-border bg-muted/40 p-3">
      <p className="text-sm font-medium">Próximos horarios libres</p>
      <p className="mt-0.5 text-xs text-muted-foreground">Elegí uno y volvé a confirmar. Hasta entonces no se reserva nada.</p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {alternatives.map((startUtc) => {
          const endUtc = new Date(Date.parse(startUtc) + durationMinutes * 60_000).toISOString();
          return (
            <li key={startUtc}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onPick({ startUtc, endUtc })}
                className="rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:border-primary-edge focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-edge disabled:opacity-50"
              >
                {capitalize(formatSlotSummary(startUtc, endUtc, timezone, timeFormat))}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
