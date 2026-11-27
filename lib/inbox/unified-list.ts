/**
 * Chats y grupos de WhatsApp en una sola lista. PURO.
 *
 * Son dos tablas (un grupo no es una conversacion con un lead, 00280), asi que la base no los pagina juntos. Las
 * conversaciones se cargan de a tandas al bajar (scroll infinito) y los grupos llegan todos de una vez (son pocos: se
 * activan a mano); cada grupo aparece cuando lo cargado llega a la fecha de su ultimo mensaje, en su lugar.
 */

import type { InboxFilters } from "@/lib/inbox/filters";

function timeOf(iso: string | null | undefined): number {
  if (!iso) return Number.NEGATIVE_INFINITY;
  const time = Date.parse(iso);
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

/**
 * Si un grupo puede cumplir estos filtros. Un grupo no tiene estado, etiquetas, responsable ni agente: con cualquiera
 * de esos filtros puestos no entra, porque nada dice que los cumpla. Se considera siempre abierto. "Ocultar conocidos"
 * y "Ocultar clientes" no lo sacan: esconden contactos, y un grupo no es ninguno de los dos.
 */
export function groupsCanMatch(filters: InboxFilters): boolean {
  if (filters.listType === "chats") return false;
  if (filters.status === "closed" || filters.status === "snoozed") return false;
  if (filters.platforms.length > 0 && !filters.platforms.includes("whatsapp")) return false;
  return (
    filters.tagIds.length === 0 &&
    !filters.assignment &&
    !filters.agentError &&
    !filters.needsHuman &&
    !filters.awaiting &&
    !filters.onlyUnidentified
  );
}

/**
 * Las comunidades para el filtro de la bandeja (00344), una por JID, por nombre. Una comunidad sin nombre guardado
 * se llama «Comunidad».
 */
export function communityOptions(rows: ReadonlyArray<{ parent_group_jid: string | null; community_subject: string | null }>): Array<{ jid: string; subject: string }> {
  const byJid = new Map<string, string>();
  for (const row of rows) {
    if (!row.parent_group_jid) continue;
    const current = byJid.get(row.parent_group_jid);
    if (!current || current === "Comunidad") byJid.set(row.parent_group_jid, row.community_subject?.trim() || "Comunidad");
  }
  return [...byJid.entries()]
    .map(([jid, subject]) => ({ jid, subject }))
    .sort((a, b) => a.subject.localeCompare(b.subject, "es", { sensitivity: "base" }));
}

/**
 * Los grupos que se muestran con lo cargado hasta ahora (scroll infinito): los que tienen un mensaje igual o mas
 * nuevo que la conversacion mas vieja cargada. Los mas viejos aparecen al bajar; cuando ya no queda nada para
 * cargar, van todos (tambien los que no tienen mensajes, abajo de todo).
 */
export function groupsForLoaded<G extends { lastMessageAt: string | null }>(
  groups: G[],
  oldestLoaded: string | null | undefined,
  hasMore: boolean,
): G[] {
  if (!hasMore || oldestLoaded === undefined) return groups;
  const limit = timeOf(oldestLoaded);
  return groups.filter((g) => timeOf(g.lastMessageAt) >= limit);
}

export type InboxListItem<C, G> = { kind: "conversation"; row: C } | { kind: "group"; row: G };

/**
 * Las dos listas en una, de mas nuevo a mas viejo. Intercala en vez de reordenar todo: cada lista conserva el orden
 * que trae (el de las conversaciones lo decide la base y el tiempo real).
 */
export function mergeInboxRows<C extends { last_message_at: string | null }, G extends { lastMessageAt: string | null }>(
  conversations: C[],
  groups: G[],
): InboxListItem<C, G>[] {
  const items: InboxListItem<C, G>[] = [];
  let c = 0;
  let g = 0;
  while (c < conversations.length || g < groups.length) {
    const takeGroup =
      c >= conversations.length ||
      (g < groups.length && timeOf(groups[g].lastMessageAt) > timeOf(conversations[c].last_message_at));
    if (takeGroup) items.push({ kind: "group", row: groups[g++] });
    else items.push({ kind: "conversation", row: conversations[c++] });
  }
  return items;
}
