"use client";

import { ConditionBuilder } from "@/components/automations/condition-builder";
import { builderToVisibility, fieldFromSource, visibilityToBuilder, type ConditionSource } from "@/lib/forms/visibility-builder-adapter";
import type { VisibilityConfig } from "@/lib/forms/visibility-types";

export type { ConditionSource };

/**
 * El constructor de condiciones de Formularios (F5): la visibilidad de un campo
 * y el "Solo si las respuestas cumplen…" del disparador.
 *
 * Es un envoltorio del constructor general (`components/automations/condition-builder.tsx`):
 * le pasa los campos del formulario con sus operadores de siempre y traduce de
 * ida y vuelta, asi que lo que se GUARDA (`VisibilityConfig`) es exactamente lo
 * mismo que antes. Una condicion solo puede mirar campos anteriores (`sources`
 * ya viene filtrado).
 */

export function VisibilityRuleBuilder({
  value,
  onChange,
  sources,
  emptyHint = "Sin condiciones: el campo se muestra siempre.",
  leadLabel = "Mostrar si",
}: {
  value: VisibilityConfig | undefined;
  onChange: (next: VisibilityConfig | undefined) => void;
  sources: ConditionSource[];
  emptyHint?: string;
  /** Lo que va antes de "se cumplen todas": "Mostrar si" en un campo, "Disparar si" en un disparador. */
  leadLabel?: string;
}) {
  if (sources.length === 0) {
    return <p className="text-xs text-muted-foreground">Para usar condiciones tiene que haber campos antes que este.</p>;
  }

  const fields = sources.map(fieldFromSource);
  return (
    <ConditionBuilder
      value={visibilityToBuilder(value)}
      onChange={(next) => onChange(builderToVisibility(next))}
      fields={fields}
      leadLabel={leadLabel}
      emptyHint={emptyHint}
    />
  );
}
