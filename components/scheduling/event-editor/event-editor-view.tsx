"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EditorShell } from "./editor-shell";
import { FormBuilder } from "../form-builder/form-builder";
import { UnavailableEditor } from "./unavailable-editor";
import { EmbedGenerator } from "../embed/embed-generator";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Notice } from "@/components/agents/fields";
import { Switch } from "@/components/ui/switch";
import {
  CONTACT_ASSIGNMENTS,
  DURATION_PRESETS,
  EVENT_COLORS,
  EVENT_STATUSES,
  EVENT_STATUS_LABELS,
} from "@/lib/scheduling/event-validation";
import { BUFFER_OPTIONS, DEFAULT_PERIOD_DAYS, SLOT_INTERVAL_OPTIONS, minutesToNotice, noticeToMinutes, type NoticeUnit } from "@/lib/scheduling/limits/buffers";
import { PERIOD_TYPES } from "@/lib/scheduling/limits/validation";
import { CONTACT_ASSIGNMENT_LABELS } from "@/lib/scheduling/assignment";
import { categoryTree, resolveCategory, type CategoryRow } from "@/lib/scheduling/categories";
import { slugify } from "@/lib/scheduling/slug";
import { summarizeSchedule } from "@/lib/scheduling/schedules";
import { RESOLVE_WARNING_TEXT } from "@/lib/scheduling/resolve-calendars";
import type { BookingField, EventType, WeeklyHours } from "@/lib/scheduling/types";
import type { ChecklistItem, EditorSection } from "@/lib/scheduling/event-validation";
import {
  saveEventAvailability,
  saveEventDetails,
  saveEventForm,
  saveEventLimits,
  setEventStatus,
} from "@/lib/actions/scheduling/event-types";

export interface EditorSchedule { id: string; name: string; isDefault: boolean; weeklyHours: WeeklyHours; timezone: string }
export interface EditorCalendar { id: string; name: string; account: string; writable: boolean; checkConflicts: boolean }

const PERIOD_LABELS: Record<string, string> = {
  rolling_calendar: "N días corridos",
  rolling_business: "N días hábiles",
  range: "Entre fechas",
  unlimited: "Sin límite",
};

/**
 * El editor del evento (F18 a F22). Cada sección guarda lo suyo: así un
 * error en los límites no pierde lo escrito en Detalles.
 */
export function EventEditorView({
  event,
  section,
  categories,
  schedules,
  calendars,
  profileDefaults,
  checklist,
  canActivate,
  previewUrl,
  publicPrefix,
  flowsCreated,
  hostName,
  calLink,
  publicBase,
  embedFallback,
}: {
  event: EventType & { workspace_id: string };
  section: EditorSection;
  categories: CategoryRow[];
  schedules: EditorSchedule[];
  calendars: EditorCalendar[];
  profileDefaults: { scheduleName: string | null; destinationName: string | null; conflictCount: number; warnings: string[] };
  checklist: ChecklistItem[];
  canActivate: boolean;
  previewUrl: string;
  publicPrefix: string;
  flowsCreated: number | null;
  /** El nombre visible del anfitrión: la vista previa de F58 lo interpola. */
  hostName: string;
  /** `usuario/slug`, o null si la persona todavía no eligió su usuario. */
  calLink: string | null;
  publicBase: string;
  /** El mensaje de respaldo del embed, ya resuelto (F58). */
  embedFallback: { title: string; body: string; cta?: { label: string; href: string } };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(flowsCreated !== null ? `Evento creado (inactivo)${flowsCreated > 0 ? ` · se crearon ${flowsCreated} flujos sugeridos, apagados` : ""}` : null);
  const [confirmSlug, setConfirmSlug] = useState<string | null>(null);

  // Detalles
  const [title, setTitle] = useState(event.title);
  const [slug, setSlug] = useState(event.slug);
  const [description, setDescription] = useState(event.description_md ?? "");
  const [duration, setDuration] = useState(event.duration_minutes);
  const [color, setColor] = useState(event.color ?? EVENT_COLORS[0]);
  const [categoryId, setCategoryId] = useState(event.category_id ?? "");
  const [locationType, setLocationType] = useState(event.location_type);
  const [locationText, setLocationText] = useState(event.location_text ?? "");
  const [hideLocation, setHideLocation] = useState(Boolean(event.hide_location_until_booked));
  const [status, setStatus] = useState(event.status);
  const [redirectUrl, setRedirectUrl] = useState(event.success_redirect_url ?? "");
  const [redirectParams, setRedirectParams] = useState(Boolean(event.redirect_with_params));
  const [assignment, setAssignment] = useState(event.contact_assignment ?? "none");

  // Disponibilidad
  const [scheduleId, setScheduleId] = useState<string | null>(event.schedule_id ?? null);
  const [destinationId, setDestinationId] = useState<string | null>(event.destination_calendar_id ?? null);
  const [conflictMode, setConflictMode] = useState<"profile" | "custom">((event.conflict_calendar_ids ?? []).length > 0 ? "custom" : "profile");
  const [conflictIds, setConflictIds] = useState<string[]>(event.conflict_calendar_ids ?? []);

  // Formulario
  const [fields, setFields] = useState<BookingField[]>(event.booking_fields ?? []);

  // Límites
  const [beforeBuffer, setBeforeBuffer] = useState(event.before_buffer_minutes);
  const [afterBuffer, setAfterBuffer] = useState(event.after_buffer_minutes);
  const notice = minutesToNotice(event.minimum_notice_minutes);
  const [noticeValue, setNoticeValue] = useState(notice.value);
  const [noticeUnit, setNoticeUnit] = useState<NoticeUnit>(notice.unit);
  const [slotInterval, setSlotInterval] = useState<number | null>(event.slot_interval_minutes ?? null);
  const [maxPerDay, setMaxPerDay] = useState<number | null>(event.max_per_day ?? null);
  const [maxPerWeek, setMaxPerWeek] = useState<number | null>(event.max_per_week ?? null);
  const [periodType, setPeriodType] = useState(event.period_type);
  const [periodDays, setPeriodDays] = useState<number | null>(event.period_days ?? DEFAULT_PERIOD_DAYS);
  const [periodStart, setPeriodStart] = useState(event.period_start_date ?? "");
  const [periodEnd, setPeriodEnd] = useState(event.period_end_date ?? "");

  const tree = categoryTree(categories);
  const { area, type } = resolveCategory(categoryId, categories);
  const areaTypes = tree.find((t) => t.area.id === area?.id)?.types ?? [];
  const inputClass = "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm";

  const dirtyBySection: Record<string, boolean> = {
    details:
      title !== event.title || slug !== event.slug || description !== (event.description_md ?? "") || duration !== event.duration_minutes ||
      color !== (event.color ?? EVENT_COLORS[0]) || categoryId !== event.category_id || locationType !== event.location_type ||
      locationText !== (event.location_text ?? "") || hideLocation !== Boolean(event.hide_location_until_booked) || status !== event.status ||
      redirectUrl !== (event.success_redirect_url ?? "") || redirectParams !== Boolean(event.redirect_with_params) || assignment !== (event.contact_assignment ?? "none"),
    availability:
      scheduleId !== (event.schedule_id ?? null) || destinationId !== (event.destination_calendar_id ?? null) ||
      JSON.stringify(conflictMode === "custom" ? conflictIds : []) !== JSON.stringify(event.conflict_calendar_ids ?? []),
    form: JSON.stringify(fields) !== JSON.stringify(event.booking_fields ?? []),
    limits:
      beforeBuffer !== event.before_buffer_minutes || afterBuffer !== event.after_buffer_minutes ||
      noticeToMinutes(noticeValue, noticeUnit) !== event.minimum_notice_minutes || slotInterval !== (event.slot_interval_minutes ?? null) ||
      maxPerDay !== (event.max_per_day ?? null) || maxPerWeek !== (event.max_per_week ?? null) || periodType !== event.period_type ||
      periodDays !== (event.period_days ?? null) || periodStart !== (event.period_start_date ?? "") || periodEnd !== (event.period_end_date ?? ""),
  };
  const dirty = Boolean(dirtyBySection[section]);

  function flash(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 4000);
  }

  function run(action: () => Promise<{ ok: boolean; error?: string; needsConfirmation?: boolean }>, onConfirm?: (m: string) => void) {
    setError(null);
    start(async () => {
      const r = await action();
      if (!r.ok) {
        if (r.needsConfirmation && onConfirm) onConfirm(r.error ?? "");
        else setError(r.error ?? "No se pudo guardar");
        return;
      }
      flash("Guardado");
      router.refresh();
    });
  }

  function saveDetails(confirmSlugChange = false) {
    run(
      () =>
        saveEventDetails({
          eventId: event.id,
          title,
          slug,
          descriptionMd: description,
          durationMinutes: duration,
          color,
          categoryId,
          locationType,
          locationText,
          hideLocationUntilBooked: hideLocation,
          status,
          successRedirectUrl: redirectUrl,
          redirectWithParams: redirectParams,
          contactAssignment: assignment,
          confirmSlugChange,
        }),
      (m) => setConfirmSlug(m),
    );
  }

  const saveBySection: Record<string, (() => void) | null> = {
    details: () => saveDetails(),
    availability: () => run(() => saveEventAvailability({ eventId: event.id, scheduleId, destinationCalendarId: destinationId, conflictCalendarIds: conflictMode === "custom" ? conflictIds : [] })),
    form: () => run(() => saveEventForm({ eventId: event.id, fields })),
    limits: () =>
      run(() =>
        saveEventLimits({
          eventId: event.id,
          beforeBufferMinutes: beforeBuffer,
          afterBufferMinutes: afterBuffer,
          minimumNoticeMinutes: noticeToMinutes(noticeValue, noticeUnit),
          slotIntervalMinutes: slotInterval,
          maxPerDay,
          maxPerWeek,
          periodType,
          periodDays: periodType === "rolling_calendar" || periodType === "rolling_business" ? periodDays : null,
          periodStartDate: periodType === "range" ? periodStart || null : null,
          periodEndDate: periodType === "range" ? periodEnd || null : null,
        }),
      ),
    unavailable: null,
    flows: null,
    share: null,
  };

  const selectedSchedule = scheduleId ? schedules.find((s) => s.id === scheduleId) : schedules.find((s) => s.isDefault);

  return (
    <EditorShell
      eventId={event.id}
      title={event.title}
      status={status}
      previewUrl={previewUrl}
      section={section}
      checklist={checklist}
      canActivate={canActivate}
      onActivate={() => run(() => setEventStatus({ eventId: event.id, status: "active" }))}
      dirty={dirty}
      saving={pending}
      onSave={saveBySection[section] ?? null}
    >
      {toast && <Notice tone="success">{toast}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}

      {section === "details" && (
        <section className="space-y-4 rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold">Detalles</h2>
          <div className="grid gap-4 md:grid-cols-[180px_1fr] md:items-center">
            <label htmlFor="ev-title" className="text-sm text-muted-foreground">Título</label>
            <input id="ev-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} className={inputClass} />

            <label htmlFor="ev-slug" className="text-sm text-muted-foreground">Link</label>
            <div className="flex items-center rounded-lg border border-input bg-background">
              <span className="hidden truncate pl-3 text-xs text-muted-foreground sm:inline">{publicPrefix}</span>
              <input id="ev-slug" value={slug} onChange={(e) => setSlug(slugify(e.target.value, true))} className="min-w-0 flex-1 bg-transparent px-2 py-2 text-sm focus:outline-none" spellCheck={false} />
            </div>

            <label htmlFor="ev-desc" className="text-sm text-muted-foreground">Descripción</label>
            <textarea id="ev-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={5000} className={`${inputClass} min-h-24 py-2`} placeholder="Se muestra en la página de reserva. Admite negrita, cursiva, listas y links (markdown)." />

            <span className="text-sm text-muted-foreground">Duración</span>
            <div className="flex flex-wrap items-center gap-2">
              {DURATION_PRESETS.map((d) => (
                <button key={d} type="button" onClick={() => setDuration(d)} className={`rounded-full border px-3 py-1 text-sm ${duration === d ? "border-primary bg-primary/10 font-medium" : "border-border hover:bg-muted"}`}>{d} min</button>
              ))}
              <input type="number" min={5} max={480} value={duration} onChange={(e) => setDuration(Number(e.target.value))} aria-label="Duración personalizada" className="h-8 w-20 rounded-lg border border-input bg-background px-2 text-sm" />
            </div>

            <span className="text-sm text-muted-foreground">Categoría</span>
            <div className="flex flex-wrap gap-2">
              <select aria-label="Área" value={area?.id ?? ""} onChange={(e) => setCategoryId(e.target.value)} className="h-9 rounded-lg border border-input bg-background px-2 text-sm">
                {tree.map(({ area: a }) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
              {areaTypes.length > 0 && (
                <select aria-label="Tipo" value={type?.id ?? ""} onChange={(e) => setCategoryId(e.target.value || area?.id || "")} className="h-9 rounded-lg border border-input bg-background px-2 text-sm">
                  <option value="">Sin tipo</option>
                  {areaTypes.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              )}
            </div>

            <span className="text-sm text-muted-foreground">Color</span>
            <div role="radiogroup" aria-label="Color del evento" className="flex flex-wrap gap-2">
              {EVENT_COLORS.map((c) => (
                <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={`Color ${c}`} onClick={() => setColor(c)} style={{ backgroundColor: c }} className={`h-7 w-7 rounded-full ${color === c ? "ring-2 ring-foreground ring-offset-2 ring-offset-background" : ""}`} />
              ))}
            </div>

            <span className="text-sm text-muted-foreground">Ubicación</span>
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                {([["google_meet", "Google Meet"], ["manual", "Ubicación manual"]] as const).map(([key, label]) => (
                  <button key={key} type="button" onClick={() => setLocationType(key)} className={`rounded-full border px-3 py-1 text-sm ${locationType === key ? "border-primary bg-primary/10 font-medium" : "border-border hover:bg-muted"}`}>{label}</button>
                ))}
              </div>
              {locationType === "manual" && <input value={locationText} onChange={(e) => setLocationText(e.target.value)} maxLength={500} className={inputClass} placeholder="Dirección o instrucción" />}
              <label className="flex items-center gap-2 text-xs">
                <Switch checked={hideLocation} label="Mostrar la ubicación solo después de agendar" onChange={setHideLocation} size="sm" />
                Mostrar la ubicación solo después de agendar
              </label>
            </div>

            <span className="text-sm text-muted-foreground">Estado</span>
            <div className="flex flex-wrap gap-2">
              {EVENT_STATUSES.map((s) => (
                <button key={s} type="button" onClick={() => setStatus(s)} className={`rounded-full border px-3 py-1 text-sm ${status === s ? "border-primary bg-primary/10 font-medium" : "border-border hover:bg-muted"}`}>{EVENT_STATUS_LABELS[s]}</button>
              ))}
            </div>

            <label htmlFor="ev-assign" className="text-sm text-muted-foreground">Al agendar, asignar al anfitrión como</label>
            <select id="ev-assign" value={assignment} onChange={(e) => setAssignment(e.target.value as typeof assignment)} className={inputClass}>
              {CONTACT_ASSIGNMENTS.map((a) => (
                <option key={a} value={a}>{CONTACT_ASSIGNMENT_LABELS[a]}</option>
              ))}
            </select>

            <label htmlFor="ev-redirect" className="text-sm text-muted-foreground">Después de agendar</label>
            <div className="space-y-2">
              <input id="ev-redirect" value={redirectUrl} onChange={(e) => setRedirectUrl(e.target.value)} className={inputClass} placeholder="Página de confirmación (dejalo vacío) o https://tu-sitio.com/gracias" />
              {redirectUrl.trim().length > 0 && (
                <label className="flex items-center gap-2 text-xs">
                  <Switch checked={redirectParams} label="Pasar los datos de la agenda como parámetros" onChange={setRedirectParams} size="sm" />
                  Pasar los datos de la agenda como parámetros
                </label>
              )}
            </div>
          </div>
        </section>
      )}

      {section === "availability" && (
        <section className="space-y-4 rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold">Disponibilidad y calendarios</h2>
          {profileDefaults.warnings.map((w) => (
            <Notice key={w} tone="warning">{RESOLVE_WARNING_TEXT[w as keyof typeof RESOLVE_WARNING_TEXT] ?? w}</Notice>
          ))}
          <div className="grid gap-4 md:grid-cols-[180px_1fr] md:items-center">
            <label htmlFor="ev-schedule" className="text-sm text-muted-foreground">Horario</label>
            <div>
              <select id="ev-schedule" value={scheduleId ?? ""} onChange={(e) => setScheduleId(e.target.value || null)} className={inputClass}>
                <option value="">Horario por defecto{profileDefaults.scheduleName ? ` (${profileDefaults.scheduleName})` : ""}</option>
                {schedules.filter((s) => !s.isDefault).map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              {selectedSchedule && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {summarizeSchedule(selectedSchedule.weeklyHours)} · {selectedSchedule.timezone.replace(/_/g, " ")} ·{" "}
                  <Link href={`/dashboard/agenda/configuracion/disponibilidad?horario=${selectedSchedule.id}`} className="text-primary underline">editarlo</Link>
                </p>
              )}
            </div>

            <label htmlFor="ev-dest" className="text-sm text-muted-foreground">Se agenda en</label>
            <select id="ev-dest" value={destinationId ?? ""} onChange={(e) => setDestinationId(e.target.value || null)} className={inputClass}>
              <option value="">Usar el de mi perfil{profileDefaults.destinationName ? ` (${profileDefaults.destinationName})` : ""}</option>
              {calendars.filter((c) => c.writable).map((c) => (
                <option key={c.id} value={c.id}>{c.name} · {c.account}</option>
              ))}
            </select>

            <span className="text-sm text-muted-foreground">Revisar conflictos en</span>
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setConflictMode("profile")} className={`rounded-full border px-3 py-1 text-sm ${conflictMode === "profile" ? "border-primary bg-primary/10 font-medium" : "border-border hover:bg-muted"}`}>
                  Usar los de mi perfil ({profileDefaults.conflictCount})
                </button>
                <button type="button" onClick={() => setConflictMode("custom")} className={`rounded-full border px-3 py-1 text-sm ${conflictMode === "custom" ? "border-primary bg-primary/10 font-medium" : "border-border hover:bg-muted"}`}>
                  Elegir para este evento
                </button>
              </div>
              {conflictMode === "custom" && (
                <ul className="space-y-1">
                  {calendars.map((c) => (
                    <li key={c.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        id={`cal-${c.id}`}
                        checked={conflictIds.includes(c.id)}
                        onChange={(e) => setConflictIds(e.target.checked ? [...conflictIds, c.id] : conflictIds.filter((x) => x !== c.id))}
                      />
                      <label htmlFor={`cal-${c.id}`}>{c.name} <span className="text-xs text-muted-foreground">· {c.account}</span></label>
                    </li>
                  ))}
                  {calendars.length === 0 && <li className="text-sm text-muted-foreground">No tenés calendarios conectados.</li>}
                </ul>
              )}
            </div>
          </div>
          <p className="border-t border-border pt-3 text-xs text-muted-foreground">
            Tus agendas del sistema siempre bloquean, sin importar esta selección. Las excepciones y el tiempo fuera se cargan en{" "}
            <Link href="/dashboard/agenda/configuracion/disponibilidad" className="text-primary underline">Disponibilidad</Link> y aplican solos.
          </p>
        </section>
      )}

      {section === "form" && (
        <section className="space-y-4 rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold">Formulario</h2>
          <FormBuilder fields={fields} onChange={setFields} disabled={pending} />
        </section>
      )}

      {section === "limits" && (
        <section className="space-y-4 rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold">Límites y buffers</h2>
          <div className="grid gap-4 md:grid-cols-[180px_1fr] md:items-center">
            <span className="text-sm text-muted-foreground">Buffer antes / después</span>
            <div className="flex flex-wrap items-center gap-2">
              <select aria-label="Buffer antes" value={beforeBuffer} onChange={(e) => setBeforeBuffer(Number(e.target.value))} className="h-9 rounded-lg border border-input bg-background px-2 text-sm">
                {BUFFER_OPTIONS.map((b) => <option key={b} value={b}>{b} min</option>)}
              </select>
              <span className="text-muted-foreground">/</span>
              <select aria-label="Buffer después" value={afterBuffer} onChange={(e) => setAfterBuffer(Number(e.target.value))} className="h-9 rounded-lg border border-input bg-background px-2 text-sm">
                {BUFFER_OPTIONS.map((b) => <option key={b} value={b}>{b} min</option>)}
              </select>
            </div>

            <span className="text-sm text-muted-foreground">Aviso mínimo</span>
            <div className="flex items-center gap-2">
              <input type="number" min={0} value={noticeValue} onChange={(e) => setNoticeValue(Number(e.target.value))} aria-label="Aviso mínimo" className="h-9 w-20 rounded-lg border border-input bg-background px-2 text-sm" />
              <select aria-label="Unidad del aviso mínimo" value={noticeUnit} onChange={(e) => setNoticeUnit(e.target.value as NoticeUnit)} className="h-9 rounded-lg border border-input bg-background px-2 text-sm">
                <option value="minutes">minutos</option>
                <option value="hours">horas</option>
                <option value="days">días</option>
              </select>
            </div>

            <label htmlFor="ev-interval" className="text-sm text-muted-foreground">Intervalo entre horarios</label>
            <select id="ev-interval" value={slotInterval ?? ""} onChange={(e) => setSlotInterval(e.target.value ? Number(e.target.value) : null)} className={inputClass}>
              <option value="">Igual a la duración ({duration} min)</option>
              {SLOT_INTERVAL_OPTIONS.map((s) => <option key={s} value={s}>{s} min</option>)}
            </select>

            <span className="text-sm text-muted-foreground">Máximo por día / semana</span>
            <div className="flex items-center gap-2">
              <input type="number" min={1} value={maxPerDay ?? ""} onChange={(e) => setMaxPerDay(e.target.value ? Number(e.target.value) : null)} aria-label="Máximo por día" placeholder="Sin tope" className="h-9 w-28 rounded-lg border border-input bg-background px-2 text-sm" />
              <span className="text-muted-foreground">/</span>
              <input type="number" min={1} value={maxPerWeek ?? ""} onChange={(e) => setMaxPerWeek(e.target.value ? Number(e.target.value) : null)} aria-label="Máximo por semana" placeholder="Sin tope" className="h-9 w-28 rounded-lg border border-input bg-background px-2 text-sm" />
            </div>

            <label htmlFor="ev-period" className="text-sm text-muted-foreground">Hasta cuándo se puede agendar</label>
            <div className="space-y-2">
              <select id="ev-period" value={periodType} onChange={(e) => setPeriodType(e.target.value as typeof periodType)} className={inputClass}>
                {PERIOD_TYPES.map((p) => <option key={p} value={p}>{PERIOD_LABELS[p]}</option>)}
              </select>
              {(periodType === "rolling_calendar" || periodType === "rolling_business") && (
                <input type="number" min={1} value={periodDays ?? DEFAULT_PERIOD_DAYS} onChange={(e) => setPeriodDays(Number(e.target.value))} aria-label="Cantidad de días" className="h-9 w-28 rounded-lg border border-input bg-background px-2 text-sm" />
              )}
              {periodType === "range" && (
                <div className="flex flex-wrap items-center gap-2">
                  <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} aria-label="Desde" className="h-9 rounded-lg border border-input bg-background px-2 text-sm" />
                  <span className="text-muted-foreground">a</span>
                  <input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} aria-label="Hasta" className="h-9 rounded-lg border border-input bg-background px-2 text-sm" />
                </div>
              )}
            </div>
          </div>
          <p className="border-t border-border pt-3 text-xs text-muted-foreground">
            Sin límite para cancelar o reagendar: el invitado puede hasta la hora de inicio.
          </p>
        </section>
      )}

      {section === "unavailable" && (
        <UnavailableEditor eventId={event.id} eventTitle={event.title} hostName={hostName} messages={event.unavailable_messages ?? null} />
      )}

      {section === "share" && (
        <section className="space-y-4">
          <div className="space-y-1">
            <span className="text-sm font-medium">Link del evento</span>
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-sm">
              <span className="min-w-0 truncate text-muted-foreground">{previewUrl}</span>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(previewUrl);
                  setToast("Link copiado");
                }}
                className="ml-auto rounded-lg border border-border px-2.5 py-1 text-xs hover:bg-muted"
              >
                Copiar
              </button>
            </div>
          </div>
          {calLink ? (
            <EmbedGenerator calLink={calLink} baseUrl={publicBase} fallback={embedFallback} eventTitle={event.title} />
          ) : (
            <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              Para compartir este evento falta el usuario de tu agenda. Cargalo en Ajustes.
            </p>
          )}
        </section>
      )}

      {section === "flows" && (
        <section className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Los flujos del evento se configuran en el Bloque 7.
        </section>
      )}

      <ConfirmDialog
        open={confirmSlug !== null}
        title="Cambiar el link del evento"
        message={confirmSlug ?? ""}
        confirmLabel="Cambiarlo igual"
        cancelLabel="Dejarlo como está"
        destructive
        onConfirm={() => { setConfirmSlug(null); saveDetails(true); }}
        onCancel={() => setConfirmSlug(null)}
      />
    </EditorShell>
  );
}
