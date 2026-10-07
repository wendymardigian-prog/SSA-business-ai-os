/**
 * Guardado automático y sesión de edición (Contenido v4, C6).
 *
 * Dos cosas distintas, que no hay que confundir: **guardar el dato no es
 * guardar una versión**. El dato se guarda siempre y al instante (dropdown al
 * elegir, texto al salir del campo). La versión es otra cosa: con el
 * autoguardado, la regla vieja (una versión por cambio) llenaría el
 * historial de decenas de filas en una tarde.
 *
 * La regla nueva: el PRIMER cambio después de `IDLE_MINUTES` sin editar esa
 * pieza crea una versión con `reason: 'edit'`. Cada cambio siguiente, dentro
 * de la misma sesión, ACTUALIZA esa misma fila (mismo `version_no`, se
 * reemplaza `snapshot` y `updated_at`). La sesión es por autor: si otra
 * persona edita, su primer cambio abre su propia versión aunque hayan
 * pasado dos minutos, porque si no el historial le atribuiría a una lo que
 * escribió la otra.
 *
 * Cuatro eventos siempre cortan la sesión y se llevan su propia versión,
 * insertando siempre (nunca actualizan): cambiar el estado, aprobar, generar
 * con IA y restaurar. No hace falta código para "cortar" nada: el PRÓXIMO
 * edit ve que la última versión no es `reason: 'edit'` y por eso inserta.
 *
 * No hace falta tocar el esquema para "la sesión": se resuelve mirando la
 * última versión guardada (`author_id`, `reason`, `updated_at`).
 */

import { IDLE_MINUTES } from "./versions";

export interface LastVersionInfo {
  authorId: string | null;
  reason: string;
  /** Cuándo se tocó por última vez esa fila. */
  updatedAt: string;
}

export type VersionWriteMode = "insert" | "update";

/**
 * Si este guardado tiene que crear una versión nueva o actualizar la última.
 *
 * `update` solo si TODO coincide: hay una última versión, es del mismo
 * autor, su motivo es `edit` (no un cambio de estado, una aprobación, IA o
 * una restauración) y pasaron menos de `IDLE_MINUTES` desde que se tocó.
 * Cualquier otra cosa es `insert`: una sesión nueva, de otro autor, o que
 * sigue a un evento que cortó la anterior.
 */
export function decideVersionWrite(params: {
  last: LastVersionInfo | null;
  authorId: string | null;
  now: Date;
}): VersionWriteMode {
  const { last } = params;
  if (!last) return "insert";
  if (last.reason !== "edit") return "insert";
  if (last.authorId !== params.authorId) return "insert";

  const lastTouch = new Date(last.updatedAt).getTime();
  if (Number.isNaN(lastTouch)) return "insert";

  const minutes = (params.now.getTime() - lastTouch) / 60_000;
  return minutes < IDLE_MINUTES ? "update" : "insert";
}
