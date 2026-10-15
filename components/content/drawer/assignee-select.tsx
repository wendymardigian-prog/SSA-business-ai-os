"use client";

import { AssigneeAvatar } from "../assignee-avatar";

/**
 * El responsable de la pieza, en el drawer: el circulo de la persona y un
 * selector con el equipo. Cambiarlo se guarda solo, como todo el drawer.
 *
 * Deshabilitado cuando quien mira no puede reasignar (solo un administrador o
 * quien creo la pieza): se ve quien es, y el tooltip dice por que no se cambia.
 */
export function AssigneeSelect({
  team,
  value,
  onChange,
  disabled,
  disabledReason,
}: {
  team: Array<{ id: string; name: string }>;
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  disabledReason?: string;
}) {
  // Una persona que ya no esta en el equipo sigue viéndose como responsable
  // actual (sin nombre conocido), en vez de dejar el selector en blanco.
  const known = team.find((m) => m.id === value) ?? null;
  const options = value && !known ? [...team, { id: value, name: "Alguien que ya no está en el equipo" }] : team;

  return (
    <label className="inline-flex items-center gap-1.5" title={disabled ? disabledReason : undefined}>
      <span className="text-[11px] font-medium text-muted-foreground">Responsable</span>
      <AssigneeAvatar assignee={known} size="md" />
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Responsable de la pieza"
        className="h-8 max-w-[11rem] rounded-md border border-border bg-background px-2 text-xs disabled:opacity-70"
      >
        <option value="">Sin responsable</option>
        {options.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
    </label>
  );
}
