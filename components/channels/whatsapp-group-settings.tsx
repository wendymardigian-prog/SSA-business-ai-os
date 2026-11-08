"use client";

import { useState, useTransition } from "react";
import { Loader2, Megaphone, Plus, UserPlus, Users, UsersRound } from "lucide-react";
import { importWhatsappGroupMembers, listWhatsappGroups, saveWhatsappGroup } from "@/lib/actions/whatsapp-groups";
import { createWhatsappGroup } from "@/lib/actions/whatsapp-group-manage";
import { GROUP_DESCRIPTION_MAX, GROUP_SUBJECT_MAX } from "@/lib/whatsapp-groups/manage";
import { groupListSections, isActiveItem, type GroupListItem } from "@/lib/whatsapp-groups/settings";

/**
 * Los grupos de un número de WhatsApp (00280), en su tarjeta de canal.
 *
 * Agrupados por comunidad (00344): cada comunidad con su grupo de Avisos y sus grupos, y al final los grupos sueltos.
 * WhatsApp solo deja ver los grupos de una comunidad en los que está el número.
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
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ subject: "", description: "", participants: "" });
  const [createPending, startCreate] = useTransition();

  function create() {
    setError(null);
    setNotice(null);
    startCreate(async () => {
      const result = await createWhatsappGroup(channelId, draft);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setCreating(false);
      setDraft({ subject: "", description: "", participants: "" });
      setNotice(
        `Grupo «${draft.subject.trim()}» creado y visible en la bandeja.${result.summary ? ` ${result.summary}` : ""} Para sumarlo a una comunidad, vinculalo desde el celular.`,
      );
      load();
    });
  }

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

  async function activateCommunity(items: GroupListItem[]) {
    const pending = items.filter((item) => !item.missing && !item.saved?.inInbox);
    if (pending.length === 0) return;
    setError(null);
    setNotice(null);
    for (const item of pending) {
      setBusyJid(item.jid);
      const saveContacts = item.saved?.saveContacts ?? false;
      const result = await saveWhatsappGroup(channelId, { jid: item.jid, subject: item.subject, inInbox: true, saveContacts });
      if (!result.ok) {
        setBusyJid(null);
        setError(result.error);
        return;
      }
      setGroups((list) =>
        (list ?? []).map((g) => (g.jid === item.jid ? { ...g, saved: { id: result.groupId, inInbox: true, saveContacts } } : g)),
      );
    }
    setBusyJid(null);
    setNotice(`Listo: ${pending.length === 1 ? "1 grupo quedó" : `${pending.length} grupos quedaron`} en la bandeja.`);
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

  function renderItem(item: GroupListItem) {
    const busy = busyJid === item.jid;
    const active = isActiveItem(item);
    return (
      <li key={item.jid} className="space-y-1.5 px-2 py-1.5">
        <div className="flex items-center gap-2">
          {item.kind === "announce" && <Megaphone className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />}
          <span className="min-w-0 flex-1 truncate font-medium" title={item.subject}>
            {item.kind === "announce" ? "Avisos" : item.subject}
          </span>
          {item.numberIsAdmin && <span className="shrink-0 rounded bg-muted px-1 text-muted-foreground">Admin</span>}
          {item.size !== null && <span className="shrink-0 text-muted-foreground">{item.size} miembros</span>}
          {busy && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" aria-label="Guardando" />}
        </div>
        {item.kind === "announce" && (
          <p className="text-muted-foreground">El grupo de avisos de la comunidad: están todos sus miembros{item.announce ? " y solo escriben los admins" : ""}.</p>
        )}
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
          {creating ? (
            <div className="space-y-1.5 rounded-md border border-border p-2">
              <p className="font-semibold">Crear un grupo</p>
              <input
                value={draft.subject}
                onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
                maxLength={GROUP_SUBJECT_MAX}
                placeholder="Nombre del grupo"
                aria-label="Nombre del grupo"
                className="w-full rounded-md border border-border bg-background px-2 py-1"
              />
              <textarea
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                maxLength={GROUP_DESCRIPTION_MAX}
                rows={2}
                placeholder="Descripción (opcional)"
                aria-label="Descripción del grupo"
                className="w-full resize-y rounded-md border border-border bg-background px-2 py-1"
              />
              <textarea
                value={draft.participants}
                onChange={(e) => setDraft({ ...draft, participants: e.target.value })}
                rows={2}
                placeholder="Teléfonos de quienes entran, con código de país (WhatsApp pide al menos uno)"
                aria-label="Teléfonos de los miembros"
                className="w-full resize-y rounded-md border border-border bg-background px-2 py-1"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={create}
                  disabled={createPending || !draft.subject.trim() || !draft.participants.trim()}
                  className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 font-medium text-primary-foreground disabled:opacity-50"
                >
                  {createPending && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
                  Crear grupo
                </button>
                <button type="button" onClick={() => setCreating(false)} className="rounded-md border border-border px-2 py-1 hover:bg-muted">
                  Cancelar
                </button>
              </div>
              <p className="text-muted-foreground">Las comunidades se crean desde el celular: WhatsApp no deja crearlas ni vincular grupos desde acá.</p>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 hover:bg-muted"
            >
              <Plus className="h-3 w-3" aria-hidden />
              Crear un grupo
            </button>
          )}
          {loading && groups === null ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Cargando" />
          ) : groups && groups.length === 0 ? (
            <p className="text-muted-foreground">Este número no está en ningún grupo.</p>
          ) : groups ? (
            <div className="space-y-2">
              {groupListSections(groups).map((section) => {
                const pendingInSection = section.items.filter((item) => !item.missing && !item.saved?.inInbox).length;
                return (
                  <section key={section.community?.jid ?? "sueltos"} className="space-y-1">
                    <div className="flex items-center gap-1.5">
                      {section.community ? (
                        <UsersRound className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
                      ) : (
                        <Users className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
                      )}
                      <h4 className="min-w-0 flex-1 truncate font-semibold">
                        {section.community ? `Comunidad · ${section.community.subject}` : "Grupos sueltos"}
                      </h4>
                      {section.community && pendingInSection > 0 && (
                        <button
                          type="button"
                          onClick={() => void activateCommunity(section.items)}
                          disabled={busyJid !== null}
                          className="shrink-0 rounded-md border border-border px-2 py-0.5 hover:bg-muted disabled:opacity-50"
                        >
                          Ver todos en la bandeja
                        </button>
                      )}
                    </div>
                    <ul className="divide-y divide-border rounded-md border border-border">
                      {section.items.map((item) => renderItem(item))}
                    </ul>
                  </section>
                );
              })}
              {groups.some((g) => g.communityJid) && (
                <p className="text-muted-foreground">
                  De una comunidad solo aparecen los grupos donde está este número. Para sumar otro, unite a ese grupo desde el
                  celular y volvé a abrir esta lista.
                </p>
              )}
            </div>
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
