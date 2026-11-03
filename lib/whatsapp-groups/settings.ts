/**
 * La lista de grupos de la seccion «Grupos» de un numero de WhatsApp. Modulo PURO.
 *
 * Junta lo que dice WhatsApp (los grupos en los que esta el numero, `fetchAllGroups`) con lo que el negocio activo
 * (`whatsapp_groups`). Un grupo activado del que el numero ya no es parte sigue en la lista (marcado), para que se
 * pueda apagar.
 */

import type { EvolutionGroup } from "@/lib/evolution-client";

export interface SavedGroupSettings {
  id: string;
  group_jid: string;
  subject: string;
  in_inbox: boolean;
  save_contacts: boolean;
  left_at: string | null;
}

export interface GroupListItem {
  jid: string;
  subject: string;
  size: number | null;
  /** El grupo ya no aparece entre los del numero (salio o lo sacaron). */
  missing: boolean;
  /** La fila guardada, si el grupo se activo alguna vez. */
  saved: { id: string; inInbox: boolean; saveContacts: boolean } | null;
}

export function mergeGroupLists(live: readonly EvolutionGroup[], saved: readonly SavedGroupSettings[]): GroupListItem[] {
  const byJid = new Map(saved.map((row) => [row.group_jid, row]));
  const items: GroupListItem[] = live.map((group) => {
    const row = byJid.get(group.jid);
    byJid.delete(group.jid);
    return {
      jid: group.jid,
      subject: group.subject,
      size: group.size,
      missing: false,
      saved: row ? { id: row.id, inInbox: row.in_inbox, saveContacts: row.save_contacts } : null,
    };
  });
  for (const row of byJid.values()) {
    if (!row.in_inbox && !row.save_contacts) continue;
    items.push({ jid: row.group_jid, subject: row.subject, size: null, missing: true, saved: { id: row.id, inInbox: row.in_inbox, saveContacts: row.save_contacts } });
  }
  const active = (item: GroupListItem) => (item.saved && (item.saved.inInbox || item.saved.saveContacts) ? 0 : 1);
  return items.sort((a, b) => active(a) - active(b) || a.subject.localeCompare(b.subject, "es", { sensitivity: "base" }));
}

/** Cuantos miembros se importan por vuelta del trabajo de la cola. */
export const IMPORT_BATCH = 150;

/** Espera antes de volver a intentar una importacion que fallo por Evolution: 1, 5 y 15 minutos; despues, se deja. */
export function importRetryDelayMinutes(attempt: number): number | null {
  return [1, 5, 15][attempt - 1] ?? null;
}
