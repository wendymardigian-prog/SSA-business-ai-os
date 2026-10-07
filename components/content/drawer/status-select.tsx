"use client";

import { STATUS_COLOR, type StatusOption } from "@/lib/content/piece-drawer";
import type { ContentPostStatus } from "@/lib/types/database";

/**
 * El estado de la pieza como dropdown teñido (F96, Contenido v4 C4).
 *
 * Se tiñe con el color del estado ACTUAL (fondo suave, borde, texto y un
 * punto), con los mismos colores que ya usa el kanban (F17): nada nuevo, se
 * reusan. Los cuatro estados manuales (Borrador, En producción, En revisión,
 * Aprobado) se eligen; los que pone el sistema a partir de Programado se ven
 * bloqueados, con el tooltip "Lo definen las redes" en vez de un "no se
 * puede" sin explicación.
 *
 * `statusOptions` ya deja deshabilitadas, con su motivo, las opciones que
 * `canTransition` rechaza: eso es lo que hace que un estado derivado quede
 * con las cuatro opciones manuales bloqueadas sin ningún caso especial acá.
 */
export function StatusSelect({
  options,
  value,
  disabled,
  derived,
  onChange,
}: {
  options: StatusOption[];
  value: ContentPostStatus;
  disabled?: boolean;
  /** Si el estado actual lo define el sistema (no se elige a mano). */
  derived: boolean;
  onChange: (next: ContentPostStatus) => void;
}) {
  const color = STATUS_COLOR[value];

  return (
    <span
      className="inline-flex h-8 items-center gap-1.5 rounded-full border px-1.5"
      style={{ color, borderColor: color, backgroundColor: `color-mix(in srgb, ${color} 13%, var(--background))` }}
      title={derived ? "Lo definen las redes: no se elige a mano" : "Cambialo cuando quieras"}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden />
      <select
        aria-label="Estado de la pieza"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as ContentPostStatus)}
        className="bg-transparent pr-1 text-xs font-medium outline-none disabled:opacity-90"
        style={{ color }}
      >
        {options.map((o) => (
          <option
            key={o.value}
            value={o.value}
            disabled={o.disabled}
            title={o.reason}
            className="text-foreground"
          >
            {o.label}
          </option>
        ))}
      </select>
    </span>
  );
}
