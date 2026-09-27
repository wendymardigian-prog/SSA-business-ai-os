"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { ConfigShell } from "./config-shell";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Notice, inputClass } from "@/components/agents/fields";
import { listTimeZones } from "@/lib/timezone";
import { saveSchedulingProfile, uploadSchedulingAvatar } from "@/lib/actions/scheduling/profile";
import { validateUsername, TIME_FORMATS, type TimeFormatOption } from "@/lib/scheduling/profile";

interface ProfileForm {
  username: string;
  displayName: string;
  timezone: string;
  timeFormat: TimeFormatOption;
  welcomeMessage: string;
  avatarUrl: string | null;
}

/**
 * Ajustes del perfil de agenda (F3). Primer ingreso: la persona completa
 * usuario y zona horaria antes de seguir (el resto de la configuracion lo
 * necesita). Cambiar el usuario con eventos activos pide confirmar.
 */
export function ProfileSettingsView({
  targetUserId,
  isSelf,
  canManageOthers,
  canManageSettings,
  members,
  initial,
  exists,
  publicBase,
}: {
  targetUserId: string;
  isSelf: boolean;
  canManageOthers: boolean;
  canManageSettings: boolean;
  members: Array<{ userId: string; label: string; username: string | null }>;
  initial: ProfileForm;
  exists: boolean;
  publicBase: string;
}) {
  const router = useRouter();
  const [form, setForm] = useState<ProfileForm>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmLinks, setConfirmLinks] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const zones = listTimeZones();

  const usernameCheck = validateUsername(form.username);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  function save(confirmBrokenLinks = false) {
    setError(null);
    setSaved(false);
    start(async () => {
      const result = await saveSchedulingProfile({
        username: form.username,
        displayName: form.displayName,
        timezone: form.timezone,
        timeFormat: form.timeFormat,
        welcomeMessage: form.welcomeMessage,
        forUserId: isSelf ? null : targetUserId,
        confirmBrokenLinks,
      });
      if (!result.ok) {
        if (result.needsConfirmation) setConfirmLinks(result.error);
        else setError(result.error);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  function upload(file: File) {
    setError(null);
    const data = new FormData();
    data.set("file", file);
    if (!isSelf) data.set("forUserId", targetUserId);
    start(async () => {
      const result = await uploadSchedulingAvatar(data);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setForm((f) => ({ ...f, avatarUrl: result.data.url }));
      router.refresh();
    });
  }

  const initials = form.displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

  return (
    <ConfigShell
      route="/dashboard/agenda/configuracion/ajustes"
      right={
        <button
          type="button"
          onClick={() => save()}
          disabled={pending || !usernameCheck.ok || form.displayName.trim().length < 2}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Guardar cambios
        </button>
      }
      filters={
        canManageOthers && members.length > 0 ? (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Persona</span>
            <select
              aria-label="Persona"
              value={targetUserId}
              onChange={(e) => router.push(`/dashboard/agenda/configuracion/ajustes?persona=${e.target.value}`)}
              className="h-8 rounded-lg border border-input bg-background px-2 text-sm text-foreground"
            >
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
        ) : undefined
      }
    >
      {!exists && (
        <Notice tone="info">
          {isSelf ? "Para usar tu agenda, elegí tu usuario (va en tus links) y confirmá tu zona horaria." : "Esta persona todavía no tiene perfil de agenda."}
        </Notice>
      )}

      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold">{isSelf ? "Tu agenda" : "Agenda de esta persona"}</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-[200px_1fr] md:items-center">
          <label htmlFor="sp-username" className="text-sm text-muted-foreground">
            Usuario <span className="text-xs">(va en los links)</span>
          </label>
          <div>
            <div className="flex items-center rounded-lg border border-input bg-background focus-within:ring-2 focus-within:ring-ring">
              <span className="hidden truncate pl-3 text-xs text-muted-foreground sm:inline">{publicBase}</span>
              <input
                id="sp-username"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value.toLowerCase() })}
                className="min-w-0 flex-1 bg-transparent px-2 py-2 text-sm focus:outline-none"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            {!usernameCheck.ok && form.username.length > 0 && <p className="mt-1 text-xs text-red-600">{usernameCheck.message}</p>}
            {exists && form.username !== initial.username && (
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">Cambiar el usuario rompe los links que ya compartiste: te lo vamos a advertir.</p>
            )}
          </div>

          <label htmlFor="sp-name" className="text-sm text-muted-foreground">
            Nombre visible
          </label>
          <input id="sp-name" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} className={inputClass} maxLength={80} />

          <span className="text-sm text-muted-foreground">Foto</span>
          <div className="flex items-center gap-3">
            {form.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={form.avatarUrl} alt={`Foto de ${form.displayName || "perfil"}`} className="h-10 w-10 rounded-full object-cover" />
            ) : (
              <span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                {initials || "?"}
              </span>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              aria-label="Elegir foto de perfil"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload(f);
                e.target.value = "";
              }}
            />
            <button type="button" disabled={!exists || pending} onClick={() => fileRef.current?.click()} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50">
              Cambiar
            </button>
            {!exists && <span className="text-xs text-muted-foreground">Primero guardá el perfil</span>}
            <span className="text-xs text-muted-foreground">jpg, png o webp · hasta 2 MB</span>
          </div>

          <label htmlFor="sp-tz" className="text-sm text-muted-foreground">
            Zona horaria
          </label>
          <select id="sp-tz" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} className={inputClass}>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, " ")}
              </option>
            ))}
          </select>

          <span className="text-sm text-muted-foreground">Formato de hora</span>
          <div role="radiogroup" aria-label="Formato de hora" className="flex gap-2">
            {TIME_FORMATS.map((tf) => (
              <button
                key={tf}
                type="button"
                role="radio"
                aria-checked={form.timeFormat === tf}
                onClick={() => setForm({ ...form, timeFormat: tf })}
                className={`rounded-lg border px-3 py-1.5 text-sm ${form.timeFormat === tf ? "border-primary bg-primary/10 font-medium" : "border-border hover:bg-muted"}`}
              >
                {tf === "12h" ? "12 horas" : "24 horas"}
              </button>
            ))}
          </div>

          <label htmlFor="sp-welcome" className="text-sm text-muted-foreground">
            Mensaje de bienvenida <span className="text-xs">(opcional)</span>
          </label>
          <textarea id="sp-welcome" value={form.welcomeMessage} onChange={(e) => setForm({ ...form, welcomeMessage: e.target.value })} className={`${inputClass} min-h-20`} maxLength={500} placeholder="Se muestra en tus páginas de reserva, debajo de tu nombre." />
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
          <span>No hay página pública del usuario: cada evento se comparte por su propio link.</span>
          {saved && !dirty && <span className="text-emerald-600">Guardado.</span>}
        </div>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </section>

      {canManageSettings && (
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold">Del workspace</h2>
          <p className="mt-1 text-xs text-muted-foreground">Solo Owner y Admin. Las opciones de flujos sugeridos y dominio propio se suman con los Bloques 7 y 6.</p>
        </section>
      )}

      <ConfirmDialog
        open={confirmLinks !== null}
        title="Cambiar el usuario rompe links"
        message={confirmLinks ?? ""}
        confirmLabel="Cambiar igual"
        cancelLabel="Dejar como estaba"
        destructive
        onConfirm={() => {
          setConfirmLinks(null);
          save(true);
        }}
        onCancel={() => setConfirmLinks(null)}
      />
    </ConfigShell>
  );
}
