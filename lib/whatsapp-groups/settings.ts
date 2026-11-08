/**
 * La lista de grupos de la seccion «Grupos» de un numero de WhatsApp. Modulo PURO.
 *
 * Junta lo que dice WhatsApp (los grupos en los que esta el numero, `fetchAllGroups`) con lo que el negocio activo
 * (`whatsapp_groups`). Un grupo activado del que el numero ya no es parte sigue en la lista (marcado), para que se
 * pueda apagar.
 */

import type { EvolutionGroup } from "@/lib/evolution-client";

export type GroupKind = "group" | "announce";

export interface SavedGroupSettings {
  id: string;
  group_jid: string;
  subject: string;
  in_inbox: boolean;
  save_contacts: boolean;
  left_at: string | null;
  kind?: string | null;
  parent_group_jid?: string | null;
  community_subject?: string | null;
}

export interface GroupListItem {
  jid: string;
  subject: string;
  size: number | null;
  kind: GroupKind;
  /** La comunidad a la que pertenece, o null si es un grupo suelto. */
  communityJid: string | null;
  communitySubject: string | null;
  /** true = solo los admins pueden escribir. */
  announce: boolean;
  /** Si el numero es admin; null = no se sabe. */
  numberIsAdmin: boolean | null;
  /** El grupo ya no aparece entre los del numero (salio o lo sacaron). */
  missing: boolean;
  /** La fila guardada, si el grupo se activo alguna vez. */
  saved: { id: string; inInbox: boolean; saveContacts: boolean } | null;
}

/** Una comunidad con sus grupos, o los grupos sueltos (`community` null, siempre al final). */
export interface GroupListSection {
  community: { jid: string; subject: string } | null;
  items: GroupListItem[];
}

export function isActiveItem(item: GroupListItem): boolean {
  return !!item.saved && (item.saved.inInbox || item.saved.saveContacts);
}

/** El nombre de cada comunidad del numero (las "madre", que no se listan). */
export function communityNames(live: readonly EvolutionGroup[]): Map<string, string> {
  return new Map(live.filter((g) => g.isCommunity).map((g) => [g.jid, g.subject]));
}

/** Lo que se guarda de un grupo segun WhatsApp. `number_is_admin` solo si se sabe: un "no se" no pisa lo anterior. */
export function liveGroupColumns(group: EvolutionGroup, communitySubject: string | null) {
  return {
    subject: group.subject,
    size: group.size,
    picture_url: group.pictureUrl,
    announce: group.announce,
    restrict: group.restrict,
    description: group.description ? group.description.slice(0, 4000) : null,
    kind: (group.isCommunityAnnounce && group.parentJid ? "announce" : "group") as GroupKind,
    parent_group_jid: group.parentJid,
    community_subject: group.parentJid ? communitySubject : null,
    ...(group.numberIsAdmin === null ? {} : { number_is_admin: group.numberIsAdmin }),
  };
}

/**
 * Junta lo que dice WhatsApp con lo guardado. La comunidad madre no es un item (no se puede activar): da el nombre
 * a sus grupos. Un grupo guardado y activo que ya no aparece queda marcado, para poder apagarlo.
 */
export function mergeGroupLists(live: readonly EvolutionGroup[], saved: readonly SavedGroupSettings[]): GroupListItem[] {
  const names = communityNames(live);
  const byJid = new Map(saved.map((row) => [row.group_jid, row]));
  const items: GroupListItem[] = [];
  for (const group of live) {
    if (group.isCommunity) continue;
    const row = byJid.get(group.jid);
    byJid.delete(group.jid);
    const communityJid = group.parentJid;
    items.push({
      jid: group.jid,
      subject: group.subject,
      size: group.size,
      kind: group.isCommunityAnnounce && communityJid ? "announce" : "group",
      communityJid,
      communitySubject: communityJid ? (names.get(communityJid) ?? row?.community_subject ?? null) : null,
      announce: group.announce,
      numberIsAdmin: group.numberIsAdmin,
      missing: false,
      saved: row ? { id: row.id, inInbox: row.in_inbox, saveContacts: row.save_contacts } : null,
    });
  }
  for (const row of byJid.values()) {
    if (!row.in_inbox && !row.save_contacts) continue;
    const communityJid = row.parent_group_jid ?? null;
    items.push({
      jid: row.group_jid,
      subject: row.subject,
      size: null,
      kind: row.kind === "announce" && communityJid ? "announce" : "group",
      communityJid,
      communitySubject: communityJid ? (names.get(communityJid) ?? row.community_subject ?? null) : null,
      announce: false,
      numberIsAdmin: null,
      missing: true,
      saved: { id: row.id, inInbox: row.in_inbox, saveContacts: row.save_contacts },
    });
  }
  const active = (item: GroupListItem) => (isActiveItem(item) ? 0 : 1);
  return items.sort((a, b) => active(a) - active(b) || compareNames(a.subject, b.subject));
}

function compareNames(a: string, b: string): number {
  return a.localeCompare(b, "es", { sensitivity: "base" });
}

/**
 * La lista de la seccion Grupos: cada comunidad (por nombre) con sus grupos (Avisos primero, despues los activos y
 * despues por nombre), y al final los grupos sueltos (activos primero). Una comunidad sin nombre conocido se llama
 * «Comunidad».
 */
export function groupListSections(items: readonly GroupListItem[]): GroupListSection[] {
  const communities = new Map<string, GroupListSection>();
  const loose: GroupListItem[] = [];
  for (const item of items) {
    if (!item.communityJid) {
      loose.push(item);
      continue;
    }
    let section = communities.get(item.communityJid);
    if (!section) {
      section = { community: { jid: item.communityJid, subject: item.communitySubject ?? "Comunidad" }, items: [] };
      communities.set(item.communityJid, section);
    } else if (section.community && section.community.subject === "Comunidad" && item.communitySubject) {
      section.community.subject = item.communitySubject;
    }
    section.items.push(item);
  }
  const rank = (item: GroupListItem) => (item.kind === "announce" ? 0 : isActiveItem(item) ? 1 : 2);
  const sorted = [...communities.values()].sort((a, b) => compareNames(a.community!.subject, b.community!.subject));
  for (const section of sorted) section.items.sort((a, b) => rank(a) - rank(b) || compareNames(a.subject, b.subject));
  const out = sorted;
  if (loose.length > 0) {
    const looseRank = (item: GroupListItem) => (isActiveItem(item) ? 0 : 1);
    out.push({ community: null, items: [...loose].sort((a, b) => looseRank(a) - looseRank(b) || compareNames(a.subject, b.subject)) });
  }
  return out;
}

/** Como se muestra un grupo fuera de la lista de su comunidad: «Comunidad › grupo», o «Comunidad › Avisos». */
export function groupDisplayName(input: { subject: string; kind?: string | null; communitySubject?: string | null }): {
  community: string | null;
  name: string;
} {
  const community = input.communitySubject?.trim() || null;
  if (input.kind === "announce") return { community, name: "Avisos" };
  return { community, name: input.subject };
}

/** Si el numero no puede escribir en el grupo: solo admins envian y el numero no es admin (si no se sabe, se deja). */
export function cannotWriteReason(input: { announce: boolean; numberIsAdmin: boolean | null }): string | null {
  if (input.announce && input.numberIsAdmin === false) return "Solo los admins pueden enviar mensajes en este grupo, y este número no es admin.";
  return null;
}

/** Cuantos miembros se importan por vuelta del trabajo de la cola. */
export const IMPORT_BATCH = 150;

/** Espera antes de volver a intentar una importacion que fallo por Evolution: 1, 5 y 15 minutos; despues, se deja. */
export function importRetryDelayMinutes(attempt: number): number | null {
  return [1, 5, 15][attempt - 1] ?? null;
}
