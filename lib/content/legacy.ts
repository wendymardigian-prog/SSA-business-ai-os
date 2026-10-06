/**
 * Lo que quedo del modelo viejo de texto (F90).
 *
 * Hasta la v3 una idea tenia `hook` + `angle` + `notes` y una pieza tenia un
 * `copy` de cuatro campos. Ahora son un texto unico (`content`) y un guion
 * (`script`) con sus notas de grabacion (`recording_notes`).
 *
 * El codigo nuevo NO lee ni escribe las columnas viejas: asi la 00118 las
 * puede borrar sin romper nada. Pero hay una cosa que si sigue teniendo la
 * forma vieja y no se puede migrar: el historial. Cada version guardada
 * antes de la v3 lleva el `copy` DENTRO de su jsonb, y "nada se pisa sin dejar
 * version" quiere decir que esas versiones se siguen pudiendo leer, comparar y
 * restaurar. Esto es lo unico que sabe como.
 *
 * Las tres funciones reproducen letra por letra lo que hace el backfill de la
 * 00117 (recortar, saltear lo vacio, juntar con una linea en blanco), para que
 * una version vieja y la pieza ya migrada digan lo mismo y comparar no invente
 * diferencias. `migrate-copy.test.ts` fija que las dos cosas no se separen.
 */

const clean = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** Junta lo que no esta vacio con una linea en blanco; null si no queda nada. */
export function joinText(parts: unknown[]): string | null {
  const kept = parts.map(clean).filter((part) => part !== "");
  return kept.length > 0 ? kept.join("\n\n") : null;
}

/** El guion de una pieza vieja: hook + desarrollo + CTA. */
export function scriptFromLegacyCopy(copy: unknown): string | null {
  const c = (copy && typeof copy === "object" ? copy : {}) as Record<string, unknown>;
  return joinText([c.hook, c.body, c.cta]);
}

/** Las notas de grabacion de una pieza vieja. */
export function recordingNotesFromLegacyCopy(copy: unknown): string | null {
  const c = (copy && typeof copy === "object" ? copy : {}) as Record<string, unknown>;
  return clean(c.recording_notes) || null;
}

/** El texto unico de una idea vieja: hook + angulo + notas. */
export function ideaContentFromLegacy(idea: {
  hook?: unknown;
  angle?: unknown;
  notes?: unknown;
}): string | null {
  return joinText([idea.hook, idea.angle, idea.notes]);
}
