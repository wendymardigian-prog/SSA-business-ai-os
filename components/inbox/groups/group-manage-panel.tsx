"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Crown, Link2, Loader2, LogOut, RefreshCw, UserMinus, UserPlus } from "lucide-react";
import {
  changeWhatsappGroupParticipants,
  getWhatsappGroupInvite,
  importWhatsappGroupMembersFromInbox,
  setWhatsappGroupSaveContacts,
  leaveWhatsappGroup,
  listWhatsappGroupParticipants,
  sendWhatsappGroupInvite,
  updateWhatsappGroupDetails,
  updateWhatsappGroupPhoto,
} from "@/lib/actions/whatsapp-group-manage";
import { GROUP_DESCRIPTION_MAX, GROUP_SUBJECT_MAX, type ManagedParticipant } from "@/lib/whatsapp-groups/manage";
import type { SelectedGroup } from "@/lib/whatsapp-groups/thread";

/**
 * «Configurar grupo» (00344): nombre, descripción, foto, permisos, link de invitación, miembros y salir. Lo ve quien
 * administra los canales (`channels.manage`); WhatsApp además exige que el número sea admin del grupo.
 *
 * Los miembros se leen en vivo de WhatsApp al abrir la sección (con un grupo grande tarda unos segundos).
 */
export function GroupManagePanel({ group, onClose }: { group: SelectedGroup; onClose: () => void }) {
  const router = useRouter();
  const manage = group.manage!;
  const [subject, setSubject] = useState(group.subject);
  const [description, setDescription] = useState(group.description ?? "");
  const [announce, setAnnounce] = useState(manage.announce);
  const [restrict, setRestrict] = useState(manage.restrict);
  const [saveContacts, setSaveContacts] = useState(manage.saveContacts);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [saving, startSaving] = useTransition();
  const [invite, setInvite] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [participants, setParticipants] = useState<ManagedParticipant[] | null>(null);
  const [loadingMembers, startLoadingMembers] = useTransition();
  const [newPhones, setNewPhones] = useState("");
  const [needsInvite, setNeedsInvite] = useState<string[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const notAdmin = manage.numberIsAdmin === false;
  const isAnnounceGroup = group.kind === "announce";
  const dirty =
    subject.trim() !== group.subject || description.trim() !== (group.description ?? "") || announce !== manage.announce || restrict !== manage.restrict;

  // Si cambia el grupo abierto, se descarta lo que se estaba editando.
  useEffect(() => {
    setSubject(group.subject);
    setDescription(group.description ?? "");
    setAnnounce(manage.announce);
    setRestrict(manage.restrict);
    setSaveContacts(manage.saveContacts);
    setInvite(null);
    setParticipants(null);
    setNeedsInvite([]);
    setMessage(null);
  }, [group.id, group.subject, group.description, manage.announce, manage.restrict, manage.saveContacts]);

  function toggleSaveContacts(next: boolean) {
    setSaveContacts(next);
    setMessage(null);
    startSaving(async () => {
      const result = await setWhatsappGroupSaveContacts(group.id, next);
      if (!result.ok) {
        setSaveContacts(!next);
        setMessage({ tone: "error", text: result.error });
        return;
      }
      setMessage({ tone: "ok", text: next ? "Desde ahora, quien se une queda como contacto." : "Ya no se guarda como contacto a quien se une." });
      router.refresh();
    });
  }

  function importMembers() {
    setMessage(null);
    startSaving(async () => {
      const result = await importWhatsappGroupMembersFromInbox(group.id);
      setMessage(
        result.ok
          ? { tone: "ok", text: "Importando los miembros. Puede tardar unos minutos; van a aparecer en Contactos (sin disparar automatizaciones)." }
          : { tone: "error", text: result.error },
      );
    });
  }

  function run(task: () => Promise<{ ok: boolean; error?: string } & Record<string, unknown>>, okText: string | null) {
    setMessage(null);
    startSaving(async () => {
      const result = await task();
      if (!result.ok) setMessage({ tone: "error", text: result.error ?? "No se pudo." });
      else {
        if (okText) setMessage({ tone: "ok", text: okText });
        router.refresh();
      }
    });
  }

  function saveDetails() {
    run(
      () =>
        updateWhatsappGroupDetails(group.id, {
          // El grupo de Avisos se llama como la comunidad: su nombre se cambia desde el celular.
          ...(isAnnounceGroup ? {} : { subject }),
          description,
          announce,
          restrict,
        }),
      "Listo, quedó guardado en WhatsApp.",
    );
  }

  async function onPhoto(file: File | undefined) {
    if (!file) return;
    try {
      const dataUrl = await squareJpegDataUrl(file);
      run(() => updateWhatsappGroupPhoto(group.id, dataUrl), "Foto actualizada.");
    } catch {
      setMessage({ tone: "error", text: "No pude leer esa imagen. Probá con un PNG o JPG." });
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function loadInvite(renew: boolean) {
    setMessage(null);
    startSaving(async () => {
      const result = await getWhatsappGroupInvite(group.id, { renew });
      if (!result.ok) setMessage({ tone: "error", text: result.error });
      else {
        setInvite(result.link);
        if (renew) setMessage({ tone: "ok", text: "Link nuevo. El anterior ya no sirve." });
      }
    });
  }

  async function copyInvite() {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setMessage({ tone: "error", text: "No pude copiar el link: seleccionalo y copialo a mano." });
    }
  }

  function loadMembers() {
    startLoadingMembers(async () => {
      const result = await listWhatsappGroupParticipants(group.id);
      if (!result.ok) setMessage({ tone: "error", text: result.error });
      else setParticipants(result.participants);
    });
  }

  function changeMembers(action: "add" | "remove" | "promote" | "demote", people: string | string[], key: string) {
    setMessage(null);
    setBusyKey(key);
    startSaving(async () => {
      const result = await changeWhatsappGroupParticipants(group.id, action, people);
      setBusyKey(null);
      if (!result.ok) {
        setMessage({ tone: "error", text: result.error });
        return;
      }
      setMessage({ tone: "ok", text: result.summary });
      setNeedsInvite(result.needsInvite);
      if (action === "add") setNewPhones("");
      router.refresh();
      if (participants) loadMembers();
    });
  }

  function sendInvites() {
    const phones = needsInvite;
    setMessage(null);
    startSaving(async () => {
      const result = await sendWhatsappGroupInvite(group.id, phones);
      if (!result.ok) {
        setMessage({ tone: "error", text: result.error });
        return;
      }
      setNeedsInvite([]);
      const skipped = result.skipped > 0 ? ` ${result.skipped} no se mandaron (no contactar o WhatsApp no lo aceptó).` : "";
      setMessage({ tone: "ok", text: `Link mandado por privado a ${result.sent === 1 ? "1 persona" : `${result.sent} personas`}.${skipped}` });
    });
  }

  function leave() {
    setMessage(null);
    startSaving(async () => {
      const result = await leaveWhatsappGroup(group.id);
      if (!result.ok) {
        setMessage({ tone: "error", text: result.error });
        return;
      }
      onClose();
      router.push("/dashboard/inbox");
      router.refresh();
    });
  }

  return (
    <aside
      className="fixed inset-0 z-40 flex flex-col bg-background md:static md:z-auto md:w-80 md:border-l md:border-border"
      aria-label="Configurar el grupo"
    >
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-3">
        <p className="text-sm font-semibold">Configurar grupo</p>
        <button type="button" onClick={onClose} className="rounded px-2 py-1 text-xs hover:bg-muted">
          Cerrar
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-3 text-sm">
        {notAdmin && (
          <p className="rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            Este número no es admin del grupo: WhatsApp no deja cambiar el grupo ni sus miembros (solo verlos). Lo de contactos sí se elige igual.
          </p>
        )}

        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Contactos</h3>
          <label className="flex items-start gap-2 text-xs">
            <input type="checkbox" checked={saveContacts} disabled={saving} onChange={(e) => toggleSaveContacts(e.target.checked)} className="mt-0.5" />
            <span>Guardar como contacto a quien se une (queda con el origen «Grupo de WhatsApp»)</span>
          </label>
          {saveContacts && (
            <button
              type="button"
              onClick={importMembers}
              disabled={saving}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
            >
              <UserPlus className="h-3 w-3" aria-hidden />
              Importar a los que ya están
            </button>
          )}
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Información</h3>
          {isAnnounceGroup ? (
            <p className="text-xs text-muted-foreground">
              Es el grupo de avisos de la comunidad: se llama como la comunidad y su nombre se cambia desde el celular.
            </p>
          ) : (
            <label className="block space-y-1">
              <span className="text-xs font-medium">Nombre</span>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                maxLength={GROUP_SUBJECT_MAX}
                disabled={notAdmin || saving}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              />
            </label>
          )}
          <label className="block space-y-1">
            <span className="text-xs font-medium">Descripción</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={GROUP_DESCRIPTION_MAX}
              rows={3}
              disabled={notAdmin || saving}
              className="w-full resize-y rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            />
          </label>
          <label className="flex items-start gap-2 text-xs">
            <input type="checkbox" checked={announce} disabled={notAdmin || saving} onChange={(e) => setAnnounce(e.target.checked)} className="mt-0.5" />
            <span>Solo los admins pueden enviar mensajes</span>
          </label>
          <label className="flex items-start gap-2 text-xs">
            <input type="checkbox" checked={restrict} disabled={notAdmin || saving} onChange={(e) => setRestrict(e.target.checked)} className="mt-0.5" />
            <span>Solo los admins pueden cambiar el nombre, la foto y la descripción</span>
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={saveDetails}
              disabled={!dirty || notAdmin || saving}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
            >
              Guardar cambios
            </button>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={notAdmin || saving}
              className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
            >
              Cambiar la foto
            </button>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => void onPhoto(e.target.files?.[0])} />
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Guardando" />}
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Link de invitación</h3>
          {invite ? (
            <div className="space-y-2">
              <p className="break-all rounded-md bg-muted px-2 py-1.5 font-mono text-xs">{invite}</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => void copyInvite()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted">
                  {copied ? <Check className="h-3 w-3" aria-hidden /> : <Copy className="h-3 w-3" aria-hidden />}
                  {copied ? "Copiado" : "Copiar"}
                </button>
                <button
                  type="button"
                  onClick={() => loadInvite(true)}
                  disabled={saving}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
                >
                  <RefreshCw className="h-3 w-3" aria-hidden />
                  Generar uno nuevo
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => loadInvite(false)}
              disabled={notAdmin || saving}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
            >
              <Link2 className="h-3 w-3" aria-hidden />
              Ver el link
            </button>
          )}
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Miembros</h3>
          <label className="block space-y-1">
            <span className="text-xs font-medium">Agregar personas</span>
            <textarea
              value={newPhones}
              onChange={(e) => setNewPhones(e.target.value)}
              rows={2}
              placeholder="+54 9 11 1234-5678, +506 7000 0000"
              disabled={notAdmin || saving}
              className="w-full resize-y rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            />
          </label>
          <button
            type="button"
            onClick={() => changeMembers("add", newPhones, "add")}
            disabled={notAdmin || saving || !newPhones.trim()}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
          >
            <UserPlus className="h-3 w-3" aria-hidden />
            Agregar
          </button>
          {needsInvite.length > 0 && (
            <div className="space-y-1 rounded-md bg-muted px-2 py-1.5 text-xs">
              <p>WhatsApp no deja agregar a {needsInvite.join(", ")} por su privacidad.</p>
              <button type="button" onClick={sendInvites} disabled={saving} className="rounded-md border border-border bg-background px-2 py-1 hover:bg-muted disabled:opacity-50">
                Mandarles el link por privado
              </button>
            </div>
          )}
          {participants === null ? (
            <button
              type="button"
              onClick={loadMembers}
              disabled={loadingMembers}
              className="inline-flex items-center gap-1 text-xs text-primary-ink hover:underline disabled:opacity-50"
            >
              {loadingMembers && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
              Ver los miembros y sus roles
            </button>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border text-xs">
              {participants.map((p) => (
                <li key={p.key} className="flex items-center gap-2 px-2 py-1.5">
                  <span className="min-w-0 flex-1 truncate" title={p.phone ?? undefined}>
                    {p.label}
                    {p.isNumber && <span className="text-muted-foreground"> (este número)</span>}
                  </span>
                  {p.admin && <Crown className="h-3 w-3 shrink-0 text-amber-600" aria-label="Admin" />}
                  {!p.isNumber && !notAdmin && (
                    <span className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        onClick={() => changeMembers(p.admin ? "demote" : "promote", [p.key], p.key)}
                        disabled={saving}
                        className="rounded px-1.5 py-0.5 hover:bg-muted disabled:opacity-50"
                      >
                        {p.admin ? "Quitar admin" : "Hacer admin"}
                      </button>
                      <button
                        type="button"
                        onClick={() => changeMembers("remove", [p.key], p.key)}
                        disabled={saving}
                        aria-label={`Sacar a ${p.label}`}
                        className="rounded px-1.5 py-0.5 text-red-700 hover:bg-muted disabled:opacity-50 dark:text-red-300"
                      >
                        {busyKey === p.key ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <UserMinus className="h-3 w-3" aria-hidden />}
                      </button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-2 border-t border-border pt-3">
          {confirmLeave ? (
            <div className="space-y-2 text-xs">
              <p>El número va a salir del grupo. El historial queda guardado, pero el grupo deja de verse y de recibir mensajes. Para volver, alguien lo tiene que agregar o usar el link.</p>
              <div className="flex gap-2">
                <button type="button" onClick={leave} disabled={saving} className="rounded-md bg-red-600 px-3 py-1.5 font-medium text-white disabled:opacity-50">
                  Sí, salir del grupo
                </button>
                <button type="button" onClick={() => setConfirmLeave(false)} className="rounded-md border border-border px-3 py-1.5 hover:bg-muted">
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmLeave(true)}
              className="inline-flex items-center gap-1 text-xs text-red-700 hover:underline dark:text-red-300"
            >
              <LogOut className="h-3 w-3" aria-hidden />
              Salir del grupo
            </button>
          )}
        </section>

        {message && (
          <p
            role={message.tone === "error" ? "alert" : "status"}
            className={
              message.tone === "error"
                ? "rounded-md bg-red-50 px-2 py-1.5 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300"
                : "rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground"
            }
          >
            {message.text}
          </p>
        )}
      </div>
    </aside>
  );
}

const PHOTO_SIDE = 640;

/** Recorta al cuadrado del centro y achica a 640 px en el navegador; el servidor vuelve a mirar los bytes. */
async function squareJpegDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = PHOTO_SIDE;
  canvas.height = PHOTO_SIDE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("sin canvas");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, PHOTO_SIDE, PHOTO_SIDE);
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, PHOTO_SIDE, PHOTO_SIDE);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.85);
}
