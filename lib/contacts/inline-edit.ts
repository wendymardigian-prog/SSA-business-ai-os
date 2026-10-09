/**
 * Editar un dato de la ficha en el lugar: que pasa al confirmar.
 *
 * Valida con las MISMAS funciones que el servidor (`validateContactField`): aca
 * sirve para avisar mientras se escribe, alla es la barrera de verdad (nunca al
 * reves: si esta fuera la unica, bastaria llamar a la accion desde afuera).
 *
 * Un cambio que no cambia nada ("  ana " por "ana", un telefono escrito de
 * otra forma pero igual al guardado) no llama al servidor: no ensucia el
 * historial con una edicion que no edito nada.
 *
 * Puro.
 */

import { validateContactField, type ContactFieldKey } from "@/lib/contacts/fields";

export type InlineCommit =
  | { kind: "unchanged" }
  | { kind: "invalid"; error: string }
  /** `value` es lo que se manda; `normalized` es como lo va a guardar el servidor (para mostrarlo ya). */
  | { kind: "save"; value: string; normalized: string };

export function planInlineCommit(
  field: ContactFieldKey,
  draft: string,
  current: string | null | undefined,
  timeZone?: string,
): InlineCommit {
  const next = validateContactField(field, draft, timeZone);
  if (!next.ok) return { kind: "invalid", error: next.error };

  // Lo guardado se normaliza igual; si por algun motivo no valida (un dato viejo
  // raro), se compara tal cual.
  const before = validateContactField(field, current ?? "", timeZone);
  const beforeValue = before.ok ? before.value : (current ?? "").trim() || null;

  if ((next.value ?? null) === (beforeValue ?? null)) return { kind: "unchanged" };
  return { kind: "save", value: draft, normalized: next.value ?? "" };
}
