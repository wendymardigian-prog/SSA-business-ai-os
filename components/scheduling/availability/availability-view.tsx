"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { ConfigShell } from "../config-shell";
import { WeeklyEditor } from "./weekly-editor";
import { OverrideDialog } from "./override-dialog";
import { OutOfOfficeDialog } from "./out-of-office-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ContentDialog, DialogField } from "@/components/content/dialog";
import { Notice } from "@/components/agents/fields";
import { Switch } from "@/components/ui/switch";
import { useUnsavedChanges } from "@/lib/hooks/use-unsaved-changes";
import { listTimeZones } from "@/lib/timezone";
import { summarizeSchedule, shortTime } from "@/lib/scheduling/schedules";
import { upcomingOverrides } from "@/lib/scheduling/availability-schema";
import { dateInTz } from "@/lib/scheduling/time/tz";
import { formatDateLong, formatDateTimeWithZone, gmtOffsetLabel, timezoneCityLabel } from "@/lib/scheduling/booker/format";
import { OUT_OF_OFFICE_REASON_LABELS } from "@/lib/scheduling/out-of-office";
import { eventsForSchedule } from "@/lib/scheduling/schedule-rules";
import type { AvailabilitySchedule, DateOverride, WeeklyHours } from "@/lib/scheduling/types";
import type { EventUsingSchedule, OutOfOfficeRow } from "@/lib/scheduling/data/schedules";
import {
  createSchedule,
  deleteOverride,
  deleteSchedule,
  duplicateSchedule,
  saveScheduleHours,
  setDefaultSchedule,
  toggleEventSchedule,
} from "@/lib/actions/scheduling/schedules";
import { deleteOutOfOffice } from "@/lib/actions/scheduling/out-of-office";

/**
 * Configuracion de agenda > Disponibilidad (F10 a F14), de arriba abajo:
 * tarjetas de horarios -> editor del elegido (Horario semanal | Excepciones)
 * -> tarjeta Tiempo fuera.
 */
export function AvailabilityView({
  schedules,
  selectedId,
  outOfOffice,
  events,
  viewerTimezone,
  targetUserId,
  isSelf,
  canManageOthers,
  members,
}: {
  schedules: AvailabilitySchedule[];
  selectedId: string | null;
  outOfOffice: OutOfOfficeRow[];
  events: EventUsingSchedule[];
  viewerTimezone: string;
  targetUserId: string;
  isSelf: boolean;
  canManageOthers: boolean;
  members: Array<{ userId: string; label: string }>;
}) {
  const router = useRouter();
  const selected = schedules.find((s) => s.id === selectedId) ?? schedules[0] ?? null;
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [guardRef, setGuardRef] = useState<{ dirty: boolean; guard: (n: () => void) => void }>({ dirty: false, guard: (n) => n() });
  const [pending, start] = useTransition();
  const [modal, setModal] = useState<
    | { kind: "new" }
    | { kind: "override"; editing: DateOverride | null }
    | { kind: "ooo"; editing: OutOfOfficeRow | null }
    | { kind: "delete"; scheduleId: string; replacement: string | null; events: number }
    | null
  >(null);
  const [newName, setNewName] = useState("");
  const [newTz, setNewTz] = useState(viewerTimezone);

  const zones = useMemo(() => listTimeZones(), []);
  const query = (id: string) => `/dashboard/agenda/configuracion/disponibilidad?horario=${id}${isSelf ? "" : `&persona=${targetUserId}`}`;

  const flash = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 4000);
  }, []);

  function run(action: () => Promise<{ ok: boolean; error?: string }>, done?: (r: { ok: boolean }) => void) {
    setError(null);
    start(async () => {
      const r = await action();
      if (!r.ok) setError(r.error ?? "No se pudo");
      done?.(r);
      router.refresh();
    });
  }

  const usesOf = (s: AvailabilitySchedule) => eventsForSchedule(events, s).filter((e) => e.on).map((e) => e.title);

  return (
    <ConfigShell
      route="/dashboard/agenda/configuracion/disponibilidad"
      right={
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setModal({ kind: "ooo", editing: null })} className="inline-flex h-9 items-center whitespace-nowrap rounded-lg border border-border px-3 text-sm font-medium hover:bg-muted">
            + Tiempo fuera
          </button>
          <button type="button" onClick={() => { setNewName(""); setNewTz(viewerTimezone); setModal({ kind: "new" }); }} className="inline-flex h-9 items-center whitespace-nowrap rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground">
            <span className="sm:hidden">+ Horario</span>
            <span className="hidden sm:inline">+ Nuevo horario</span>
          </button>
        </div>
      }
      filters={
        canManageOthers && members.length > 1 ? (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Persona</span>
            <select aria-label="Persona" value={targetUserId} onChange={(e) => router.push(`/dashboard/agenda/configuracion/disponibilidad?persona=${e.target.value}`)} className="h-8 rounded-lg border border-input bg-background px-2 text-sm text-foreground">
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>{m.label}</option>
              ))}
            </select>
          </label>
        ) : undefined
      }
    >
      {toast && <Notice tone="success">{toast}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}

      {schedules.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center">
          <h2 className="text-base font-semibold">Todavía no hay horarios</h2>
          <p className="mt-1 text-sm text-muted-foreground">Creá tu primer horario: nombre y zona horaria, y después las horas de cada día.</p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {schedules.map((s) => {
            const uses = usesOf(s);
            const active = selected?.id === s.id;
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={active}
                onClick={() => guardRef.guard(() => router.push(query(s.id)))}
                className={`rounded-xl border p-4 text-left transition-colors ${active ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-muted/40"}`}
              >
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold">{s.name}</h3>
                  {s.is_default && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">Por defecto</span>}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{summarizeSchedule(s.weekly_hours)} · {timezoneCityLabel(s.timezone)}</p>
                <p className="mt-1 text-xs text-muted-foreground">Lo usan: {uses.length > 0 ? uses.join(", ") : "ningún evento todavía"}</p>
              </button>
            );
          })}
        </div>
      )}

      {selected && (
        <ScheduleEditorCard
          key={selected.id}
          selected={selected}
          schedules={schedules}
          events={events}
          zones={zones}
          pending={pending}
          onGuard={setGuardRef}
          onError={setError}
          onFlash={flash}
          onOpen={setModal}
          run={run}
        />
      )}

      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold">Tiempo fuera</h2>
          <span className="text-xs text-muted-foreground">Vacaciones, viajes, días libres. <strong>Bloquea todos tus horarios y todos tus eventos.</strong></span>
          <button type="button" onClick={() => setModal({ kind: "ooo", editing: null })} className="ml-auto rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted">+ Agregar tiempo fuera</button>
        </div>
        {outOfOffice.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No hay tiempo fuera cargado.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {outOfOffice.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <span className="font-medium tabular-nums">
                  {o.all_day
                    ? `${formatDateLong(o.starts_at, viewerTimezone)} – ${formatDateLong(new Date(new Date(o.ends_at).getTime() - 1), viewerTimezone)}`
                    : `${formatDateTimeWithZone(o.starts_at, viewerTimezone)} – ${formatDateTimeWithZone(o.ends_at, viewerTimezone)}`}
                </span>
                <span className="rounded-full border border-border px-2 py-0.5 text-xs">{OUT_OF_OFFICE_REASON_LABELS[o.reason]}</span>
                {o.note && <span className="text-xs text-muted-foreground">{o.note}</span>}
                <span className="ml-auto flex gap-2 text-xs">
                  <button type="button" onClick={() => setModal({ kind: "ooo", editing: o })} className="text-primary">Editar</button>
                  <button type="button" disabled={pending} onClick={() => run(() => deleteOutOfOffice({ id: o.id, forUserId: isSelf ? null : targetUserId }), (r) => r.ok && flash("Tiempo fuera borrado"))} className="text-red-600">Borrar</button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {modal?.kind === "new" && (
        <ContentDialog
          title="Nuevo horario"
          label="Nuevo horario"
          onClose={() => setModal(null)}
          footer={
            <div className="flex w-full justify-end gap-2">
              <button type="button" data-close onClick={() => setModal(null)} className="rounded-lg border border-border px-3 py-2 text-sm">Cancelar</button>
              <button
                type="button"
                disabled={pending || newName.trim().length === 0}
                onClick={() =>
                  run(() => createSchedule({ name: newName, timezone: newTz, forUserId: isSelf ? null : targetUserId }), (r) => {
                    const d = r as { ok: boolean; data?: { id: string } };
                    if (d.ok && d.data) {
                      setModal(null);
                      router.push(query(d.data.id));
                    }
                  })
                }
                className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                Crear horario
              </button>
            </div>
          }
        >
          <div className="space-y-3">
            <DialogField label="Nombre" hint='Por ejemplo "Solo tardes" o "Llamadas de venta"'>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={60} className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm" />
            </DialogField>
            <DialogField label="Zona horaria">
              <select value={newTz} onChange={(e) => setNewTz(e.target.value)} className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm">
                {zones.map((z) => (
                  <option key={z} value={z}>{z.replace(/_/g, " ")}</option>
                ))}
              </select>
            </DialogField>
          </div>
        </ContentDialog>
      )}

      {modal?.kind === "override" && selected && (
        <OverrideDialog
          scheduleId={selected.id}
          scheduleName={selected.name}
          timezone={selected.timezone}
          weeklyHours={selected.weekly_hours}
          editing={modal.editing}
          onClose={() => setModal(null)}
          onSaved={(m) => { setModal(null); flash(m); router.refresh(); }}
        />
      )}

      {modal?.kind === "ooo" && (
        <OutOfOfficeDialog
          timezone={viewerTimezone}
          scheduleNames={schedules.map((s) => s.name)}
          editing={modal.editing}
          forUserId={isSelf ? null : targetUserId}
          onClose={() => setModal(null)}
          onSaved={(m) => { setModal(null); flash(m); router.refresh(); }}
        />
      )}

      {modal?.kind === "delete" && (
        <ContentDialog
          title="Borrar horario"
          label="Borrar horario"
          onClose={() => setModal(null)}
          footer={
            <div className="flex w-full justify-end gap-2">
              <button type="button" data-close onClick={() => setModal(null)} className="rounded-lg border border-border px-3 py-2 text-sm">Cancelar</button>
              <button
                type="button"
                disabled={pending || (modal.events > 0 && !modal.replacement)}
                onClick={() => run(() => deleteSchedule({ scheduleId: modal.scheduleId, replacementId: modal.replacement }), (r) => { if (r.ok) { setModal(null); flash("Horario borrado"); router.push(query(schedules.find((s) => s.is_default)?.id ?? "")); } })}
                className="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                Borrar
              </button>
            </div>
          }
        >
          {modal.events > 0 ? (
            <div className="space-y-2 text-sm">
              <p>{modal.events === 1 ? "1 evento usa" : `${modal.events} eventos usan`} este horario. Elegí a qué horario pasan:</p>
              <select value={modal.replacement ?? ""} onChange={(e) => setModal({ ...modal, replacement: e.target.value || null })} className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm">
                <option value="">Elegí un horario</option>
                {schedules.filter((s) => s.id !== modal.scheduleId).map((s) => (
                  <option key={s.id} value={s.id}>{s.name}{s.is_default ? " (por defecto)" : ""}</option>
                ))}
              </select>
            </div>
          ) : (
            <p className="text-sm">Ningún evento usa este horario. Se puede recuperar durante 30 días.</p>
          )}
        </ContentDialog>
      )}

    </ConfigShell>
  );
}

type ModalState =
  | { kind: "new" }
  | { kind: "override"; editing: DateOverride | null }
  | { kind: "ooo"; editing: OutOfOfficeRow | null }
  | { kind: "delete"; scheduleId: string; replacement: string | null; events: number }
  | null;

/**
 * El editor del horario elegido. Es un componente aparte con `key` por
 * horario: asi el estado (nombre, zona, rangos, huella de cambios) nace
 * limpio cada vez que se elige otro.
 */
function ScheduleEditorCard({
  selected,
  schedules,
  events,
  zones,
  pending,
  onGuard,
  onError,
  onFlash,
  onOpen,
  run,
}: {
  selected: AvailabilitySchedule;
  schedules: AvailabilitySchedule[];
  events: EventUsingSchedule[];
  zones: string[];
  pending: boolean;
  onGuard: (g: { dirty: boolean; guard: (n: () => void) => void }) => void;
  onError: (e: string | null) => void;
  onFlash: (m: string) => void;
  onOpen: (m: ModalState) => void;
  run: (action: () => Promise<{ ok: boolean; error?: string }>, done?: (r: { ok: boolean }) => void) => void;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"horario" | "excepciones">("horario");
  const [name, setName] = useState(selected.name);
  const [timezone, setTimezone] = useState(selected.timezone);
  const [weekly, setWeekly] = useState<WeeklyHours>(selected.weekly_hours);
  const [errorDay, setErrorDay] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const setModal = onOpen;
  const setError = onError;
  const flash = onFlash;

  const current = JSON.stringify({ name, timezone, weekly });
  const initial = JSON.stringify({ name: selected.name, timezone: selected.timezone, weekly: selected.weekly_hours });
  const unsaved = useUnsavedChanges({ current, initial });
  const { dirty, guard } = unsaved;
  useEffect(() => {
    onGuard({ dirty, guard });
  }, [dirty, guard, onGuard]);

  function saveHours() {
    setError(null);
    setErrorDay(null);
    startSave(async () => {
      const r = await saveScheduleHours({ scheduleId: selected.id, name, timezone, weeklyHours: weekly });
      if (!r.ok) {
        setError(r.error);
        setErrorDay(r.day ?? null);
        return;
      }
      unsaved.markSaved();
      flash("Horario guardado");
      router.refresh();
    });
  }

  const today = dateInTz(new Date(), selected.timezone);
  const upcoming = upcomingOverrides(selected.date_overrides, today);
  const busy = pending || saving;

  return (
    <>
      <section className="rounded-xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold">Editar: {selected.name}</h2>
            {unsaved.dirty && <span className="text-xs text-amber-700 dark:text-amber-400">Cambios sin guardar</span>}
            <div role="tablist" aria-label="Vista del horario" className="ml-auto inline-flex rounded-lg border border-border p-0.5">
              {(["horario", "excepciones"] as const).map((t) => (
                <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`rounded-md px-3 py-1 text-xs font-medium ${tab === t ? "bg-muted" : "text-muted-foreground"}`}>
                  {t === "horario" ? "Horario semanal" : "Excepciones"}
                </button>
              ))}
            </div>
          </div>

          {tab === "horario" ? (
            <div className="mt-4 space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs font-medium">
                  Nombre
                  <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm font-normal" />
                </label>
                <label className="block text-xs font-medium">
                  Zona horaria del horario
                  <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm font-normal">
                    {(zones.includes(timezone) ? zones : [timezone, ...zones]).map((z) => (
                      <option key={z} value={z}>{z.replace(/_/g, " ")}</option>
                    ))}
                  </select>
                </label>
              </div>
              <WeeklyEditor value={weekly} onChange={setWeekly} errorDay={errorDay} />
            </div>
          ) : (
            <div className="mt-4 space-y-2">
              <p className="text-xs text-muted-foreground">Días puntuales en que <strong>este horario</strong> cambia. Los otros horarios no se tocan.</p>
              {upcoming.length === 0 && <p className="text-sm text-muted-foreground">No hay excepciones próximas.</p>}
              <ul className="divide-y divide-border">
                {upcoming.map((o) => (
                  <li key={o.date} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                    <span className="font-medium">{formatDateLong(new Date(`${o.date}T12:00:00Z`), "UTC")}</span>
                    <span className="text-muted-foreground">{o.ranges.length === 0 ? "No disponible todo el día" : `Solo ${o.ranges.map((r) => `${shortTime(r.start)}–${shortTime(r.end)}`).join(" y ")}`}</span>
                    <span className="ml-auto flex gap-2 text-xs">
                      <button type="button" onClick={() => setModal({ kind: "override", editing: o })} className="text-primary">Editar</button>
                      <button type="button" disabled={busy} onClick={() => run(() => deleteOverride({ scheduleId: selected.id, date: o.date }), (r) => r.ok && flash("Excepción borrada"))} className="text-red-600">Borrar</button>
                    </span>
                  </li>
                ))}
              </ul>
              <button type="button" onClick={() => setModal({ kind: "override", editing: null })} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted">+ Agregar excepción</button>
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-3 text-xs text-muted-foreground">
            <span>Zona horaria del horario: {timezoneCityLabel(selected.timezone)} ({gmtOffsetLabel(new Date(), selected.timezone)})</span>
            {!selected.is_default && (
              <button type="button" disabled={busy} onClick={() => run(() => setDefaultSchedule(selected.id), (r) => r.ok && flash(`Ahora ${selected.name} es el horario por defecto`))} className="text-primary">Marcar por defecto</button>
            )}
            <button type="button" disabled={busy} onClick={() => run(() => duplicateSchedule(selected.id), (r) => r.ok && flash("Horario duplicado"))} className="text-primary">Duplicar</button>
            {!selected.is_default && (
              <button type="button" disabled={busy} onClick={() => setModal({ kind: "delete", scheduleId: selected.id, replacement: schedules.find((s) => s.is_default)?.id ?? null, events: eventsForSchedule(events, selected).filter((e) => e.on).length })} className="text-red-600">Borrar</button>
            )}
            <span className="flex-1" />
            {tab === "horario" && (
              <button type="button" onClick={saveHours} disabled={busy || !unsaved.dirty} className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Guardar
              </button>
            )}
          </div>

          <div className="mt-4 border-t border-border pt-3">
            <h3 className="text-xs font-semibold">Eventos con este horario</h3>
            {events.length === 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">Todavía no tenés eventos. Cuando los crees, desde acá podés asignarlos a este horario.</p>
            ) : (
              <ul className="mt-2 space-y-1">
                {eventsForSchedule(events, selected).map((e) => (
                  <li key={e.id} className="flex items-center gap-2 text-sm">
                    <Switch
                      checked={e.on}
                      disabled={busy}
                      label={`${e.title} usa este horario`}
                      onChange={(turnOn) => run(() => toggleEventSchedule({ scheduleId: selected.id, eventId: e.id, turnOn }), (r) => {
                        const d = r as { ok: boolean; data?: { changed: boolean; tooltip?: string } };
                        if (d.ok && d.data && !d.data.changed && d.data.tooltip) flash(d.data.tooltip);
                      })}
                    />
                    <span>{e.title}</span>
                    {e.implicitDefault && <span className="text-xs text-muted-foreground" title="Usa el horario por defecto">por defecto</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      <ConfirmDialog {...unsaved.confirmProps} />
    </>
  );
}
