/**
 * Chats y grupos de WhatsApp en una sola lista. PURO.
 *
 * Son dos tablas (un grupo no es una conversacion con un lead, 00280), asi que la base no los pagina juntos. Las
 * conversaciones se siguen paginando como siempre y cada grupo cae en LA pagina que le toca por la fecha de su ultimo
 * mensaje: con las paginas ordenadas de mas nuevo a mas viejo, le toca a la pagina N si es mas viejo que el primero de
 * esa pagina y mas nuevo que el primero de la siguiente. Asi cada grupo sale una sola vez y en su lugar. Los grupos
 * son pocos (se activan a mano) y no cuentan para el tamaño de la pagina.
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

export interface PageBounds {
  page: number;
  /** El ultimo mensaje de la primera conversacion de esta pagina. `undefined` si la pagina no tiene ninguna. */
  newestOnPage: string | null | undefined;
  /** El de la primera conversacion de la pagina siguiente. `undefined` si esta es la ultima. */
  newestOnNextPage: string | null | undefined;
}

/** Los grupos que van en esta pagina. */
export function groupsForPage<G extends { lastMessageAt: string | null }>(groups: G[], bounds: PageBounds): G[] {
  // Sin conversaciones en la pagina: en la primera van todos (no hay con que intercalarlos); en otra, ninguno.
  if (bounds.newestOnPage === undefined) return bounds.page === 1 ? groups : [];
  const upper = bounds.page === 1 ? Number.POSITIVE_INFINITY : timeOf(bounds.newestOnPage);
  const hasNextPage = bounds.newestOnNextPage !== undefined;
  return groups.filter((g) => {
    const time = timeOf(g.lastMessageAt);
    if (time > upper) return false;
    // Un grupo sin mensajes va en la ultima pagina, abajo de todo.
    return hasNextPage ? time > timeOf(bounds.newestOnNextPage) : true;
  });
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
