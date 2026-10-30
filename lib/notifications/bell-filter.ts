/**
 * Que muestra la campana de cada persona (Mi cuenta → Notificaciones).
 *
 * PURO. Dos reglas, encima de la RLS (`can_see_notification`, que no cambia):
 * 1. Lo PROPIO y lo GENERAL: los avisos dirigidos a esta persona
 *    (`recipient_id` = ella) y los que no tienen destinatario (los generales
 *    del negocio, que la RLS ya limita a Owner/Admin o a quien ve esa
 *    conversacion). Un Owner/Admin ya no ve en su campana los avisos
 *    personales de otros (antes la RLS se los dejaba ver todos).
 * 2. Sin los tipos que la persona silencio en Campana.
 *
 * Silenciar es de pantalla: el aviso existe igual y vuelve a aparecer si se
 * prende de nuevo.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPE = /^[a-z0-9_]+$/;

/** El filtro `or` de PostgREST: para esta persona, o sin destinatario. */
export function bellRecipientFilter(userId: string): string {
  if (!UUID.test(userId)) throw new Error("bellRecipientFilter: el usuario no es un uuid");
  return `recipient_id.eq.${userId},recipient_id.is.null`;
}

/** La lista para `.not("type", "in", …)`, o null si no hay nada silenciado. */
export function mutedTypesList(types: readonly string[]): string | null {
  const safe = [...new Set(types)].filter((t) => TYPE.test(t));
  return safe.length ? `(${safe.join(",")})` : null;
}
