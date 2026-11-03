"use client";

import { useState, useTransition } from "react";
import { Loader2, UserPlus, Users } from "lucide-react";
import { importWhatsappGroupMembers, listWhatsappGroups, saveWhatsappGroup } from "@/lib/actions/whatsapp-groups";
import type { GroupListItem } from "@/lib/whatsapp-groups/settings";

/**
 * Los grupos de un número de WhatsApp (00280), en su tarjeta de canal.
 *
 * Por grupo, dos interruptores: verlo en la bandeja (para leer, escribir, mandar encuestas y armar
 * automatizaciones con sus mensajes) y guardar como contacto a quien se une. Más «Importar miembros» para traer a
 * los que ya están. Se carga al abrir: leer los grupos es una consulta a WhatsApp.
 */
export function WhatsappGroupSettings({ channelId }: { channelId: string }) {
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<GroupListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyJid, setBusyJid] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const [, startSaving] = useTransition();

  function load() {
    setError(null);
    startLoading(async () => {
      const result = await listWhatsappGroups(channelId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setGroups(result.groups);
    });
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && groups === null) load();
  }

  function change(item: GroupListItem, patch: { inInbox?: boolean; saveContacts?: boolean }) {
    const inInbox = patch.inInbox ?? item.saved?.inInbox ?? false;
    const saveContacts = patch.saveContacts ?? item.saved?.saveContacts ?? false;
    setError(null);
    setNotice(null);
    setBusyJid(item.jid);
    startSaving(async () => {
      const result = await saveWhatsappGroup(channelId, { jid: item.jid, subject: item.subject, inInbox, saveContacts });
      setBusyJid(null);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setGroups((list) =>
        (list ?? []).map((g) => (g.jid === item.jid ? { ...g, saved: { id: result.groupId, inInbox, saveContacts } } : g)),
      );
    });
  }

  function importMembers(item: GroupListItem) {
    if (!item.saved) return;
    const groupId = item.saved.id;
    setError(null);
    setNotice(null);
    setBusyJid(item.jid);
    startSaving(async () => {
      const result = await importWhatsappGroupMembers(channelId, groupId);
      setBusyJid(null);
      if (!result.ok) setError(result.error);
      else setNotice(`Importando los miembros de «${item.subject}». Puede tardar unos minutos; van a aparecer en Contactos.`);
    });
  }

  return (
    <div className="rounded-lg border border-border">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[11px] font-medium hover:bg-muted"
      >
        <Users className="h-3 w-3" aria-hidden />
        Grupos
      </button>
      {open && (
        <div className="space-y-2 border-t border-border px-2.5 py-2 text-[11px]">
          <p className="text-muted-foreground">
            Activá los grupos que querés ver en la bandeja o usar para sumar contactos. Quien se une a un grupo que guarda contactos queda
            con el origen «Grupo de WhatsApp». Las automatizaciones de grupos (alguien se une, reacciona o vota) se arman en Automatizaciones.
          </p>
          {loading && groups === null ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Cargando" />
          ) : groups && groups.length === 0 ? (
            <p className="text-muted-foreground">Este número no está en ningún grupo.</p>
          ) : groups ? (
            <ul className="divide-y divide-border rounded-md border border-border">
              {groups.map((item) => {
                const busy = busyJid === item.jid;
                const active = !!item.saved && (item.saved.inInbox || item.saved.saveContacts);
                return (
                  <li key={item.jid} className="space-y-1.5 px-2 py-1.5">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate font-medium" title={item.subject}>
                        {item.subject}
                      </span>
                      {item.size !== null && <span className="shrink-0 text-muted-foreground">{item.size} miembros</span>}
                      {busy && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" aria-label="Guardando" />}
                    </div>
                    {item.missing && <p className="text-amber-700 dark:text-amber-300">El número ya no está en este grupo.</p>}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <label className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={item.saved?.inInbox ?? false}
                          disabled={busy}
                          onChange={(e) => change(item, { inInbox: e.target.checked })}
                        />
                        Ver en la bandeja
                      </label>
                      <label className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={item.saved?.saveContacts ?? false}
                          disabled={busy}
                          onChange={(e) => change(item, { saveContacts: e.target.checked })}
                        />
                        Guardar como contacto a quien se une
                      </label>
                      {active && !item.missing && (
                        <button
                          type="button"
                          onClick={() => importMembers(item)}
                          disabled={busy}
                          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 hover:bg-muted disabled:opacity-50"
                        >
                          <UserPlus className="h-3 w-3" aria-hidden />
                          Importar miembros
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {notice && <p className="rounded-md bg-muted px-2 py-1 text-muted-foreground">{notice}</p>}
          {error && (
            <p role="alert" className="rounded-md bg-red-50 px-2 py-1 text-red-700 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
