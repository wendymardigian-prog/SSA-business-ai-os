"use client";

/**
 * Un evento de Google Calendar abierto en la Agenda (00510): el detalle, editarlo, moverlo y borrarlo. Y los diálogos
 * del calendario: confirmar un arrastre, crear un evento de Google y elegir qué crear al arrastrar sobre un hueco.
 *
 * Todo cambio pasa por una acción del servidor que vuelve a mirar que el evento sea de quien lo cambia y que no haya
 * cambiado en Google mientras tanto. La descripción se muestra como texto, nunca como HTML.
 */
import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { CalendarPlus, ExternalLink, Pencil, Trash2, Video, X } from "lucide-react";
import {
  canEditGoogleEvent,
  durationMinutesOf,
  hasOtherGuests,
  type AgendaGoogleCalendar,
  type AgendaGoogleEvent,
} from "@/lib/google-calendar/agenda";
import { createGoogleEvent, deleteGoogleEvent, moveGoogleEvent, updateGoogleEvent } from "@/lib/actions/scheduling/google-events";
import { formatSlotLabel } from "@/lib/scheduling/booker/format";
import { dateInTz, minutesOfDayInTz, wallClockToUtc } from "@/lib/scheduling/time/tz";
import { minutesToTime } from "@/lib/calendar/time";
import { durationLabel } from "@/lib/scheduling/booking-drag";
import type { WallTime } from "@/lib/scheduling/types";
import { cn } from "@/lib/utils";

const RESPONSE_LABEL: Record<string, string> = {
  accepted: "Va",
  declined: "No va",
  tentative: "Quizás",
  needsAction: "Sin responder",
};

function dayText(utcOrDate: string, timezone: string, civil = false): string {
  const d = civil ? new Date(`${utcOrDate}T12:00:00Z`) : new Date(utcOrDate);
  const s = new Intl.DateTimeFormat("es", { weekday: "long", day: "numeric", month: "long", timeZone: civil ? "UTC" : timezone }).format(d);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function whenText(ev: AgendaGoogleEvent, timezone: string, timeFormat: "12h" | "24h"): string {
  if (ev.allDay && ev.startDate) {
    const last = ev.endDate ? new Date(Date.parse(`${ev.endDate}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10) : ev.startDate;
    return last > ev.startDate ? `${dayText(ev.startDate, timezone, true)} al ${dayText(last, timezone, true)} · Todo el día` : `${dayText(ev.startDate, timezone, true)} · Todo el día`;
  }
  return `${dayText(ev.startAt, timezone)} · ${formatSlotLabel(ev.startAt, timezone, timeFormat)} a ${formatSlotLabel(ev.endAt, timezone, timeFormat)}`;
}

function guestsToText(ev: AgendaGoogleEvent): string {
  return ev.attendees.filter((a) => !a.self && !a.resource).map((a) => a.email).join("\n");
}

function parseGuests(text: string): string[] {
  return text.split(/[\s,;]+/).map((t) => t.trim()).filter(Boolean);
}

/** «Solo este / toda la serie» y «Avisar a los invitados», los dos campos que se repiten en cada confirmación. */
function ScopeAndNotify({
  recurring,
  guests,
  scope,
  onScope,
  notify,
  onNotify,
}: {
  recurring: boolean;
  guests: boolean;
  scope: "instance" | "series";
  onScope: (s: "instance" | "series") => void;
  notify: boolean;
  onNotify: (v: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-2 text-sm">
      {recurring && (
        <fieldset className="flex flex-col gap-1">
          <legend className="text-xs text-muted-foreground">Es un evento que se repite</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="gscope" checked={scope === "instance"} onChange={() => onScope("instance")} /> Solo este
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="gscope" checked={scope === "series"} onChange={() => onScope("series")} /> Toda la serie
          </label>
        </fieldset>
      )}
      {guests && (
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={notify} onChange={(e) => onNotify(e.target.checked)} /> Avisar a los invitados por email
        </label>
      )}
    </div>
  );
}

function Modal({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={label} onClick={(e) => e.stopPropagation()} className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-border bg-card p-4">
        {children}
      </div>
    </div>
  );
}

function ErrorLine({ error, onRefresh }: { error: { text: string; conflict?: boolean } | null; onRefresh?: () => void }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-sm text-red-600 dark:text-red-400">
      {error.text}
      {error.conflict && onRefresh && (
        <button type="button" onClick={onRefresh} className="ml-2 underline">
          Actualizar
        </button>
      )}
    </p>
  );
}

// ── El panel ─────────────────────────────────────────────────────────────────────────────────────────────────────

export function GoogleEventPanel({
  event,
  timezone,
  timeFormat,
  onClose,
  onChanged,
  onRefresh,
  importSlot,
}: {
  event: AgendaGoogleEvent;
  timezone: string;
  timeFormat: "12h" | "24h";
  onClose: () => void;
  /** Algo cambió en Google: refrescar la página. */
  onChanged: () => void;
  onRefresh: () => void;
  /** «Pasar al sistema» (si quien mira puede crear reuniones). */
  importSlot?: ReactNode;
}) {
  const editable = canEditGoogleEvent(event);
  const recurring = !!event.recurringEventId;
  const guests = hasOtherGuests(event);
  const [mode, setMode] = useState<"view" | "edit" | "delete">("view");
  const [error, setError] = useState<{ text: string; conflict?: boolean } | null>(null);
  const [pending, start] = useTransition();
  const [scope, setScope] = useState<"instance" | "series">("instance");
  const [notify, setNotify] = useState(true);

  // El formulario de edición.
  const [summary, setSummary] = useState(event.summary ?? "");
  const [location, setLocation] = useState(event.location ?? "");
  const [description, setDescription] = useState(event.description ?? "");
  const [guestText, setGuestText] = useState(guestsToText(event));
  const [date, setDate] = useState(dateInTz(event.startAt, timezone));
  const [time, setTime] = useState(minutesToTime(minutesOfDayInTz(event.startAt, timezone)));
  const [duration, setDuration] = useState(durationMinutesOf(event));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && mode === "view") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, mode]);

  function save() {
    setError(null);
    start(async () => {
      const startUtc = wallClockToUtc(date, time as WallTime, timezone).toISOString();
      const timeChanged = !event.allDay && (startUtc !== new Date(event.startAt).toISOString() || duration !== durationMinutesOf(event));
      const textPatch: Parameters<typeof updateGoogleEvent>[0] = { id: event.id, scope, notify };
      if (summary !== (event.summary ?? "")) textPatch.summary = summary;
      if (location !== (event.location ?? "")) textPatch.location = location;
      if (description !== (event.description ?? "")) textPatch.description = description;
      const nextGuests = parseGuests(guestText);
      if (nextGuests.join("\n") !== guestsToText(event)) textPatch.guests = nextGuests;
      const hasText = Object.keys(textPatch).length > 3;

      if (hasText) {
        const r = await updateGoogleEvent(textPatch);
        if (!r.ok) return setError({ text: r.error, conflict: r.conflict });
      }
      if (timeChanged) {
        const r = await moveGoogleEvent({ id: event.id, startUtc, durationMinutes: duration, scope, notify });
        if (!r.ok) return setError({ text: r.error, conflict: r.conflict });
      }
      onChanged();
      onClose();
    });
  }

  function remove() {
    setError(null);
    start(async () => {
      const r = await deleteGoogleEvent({ id: event.id, scope, notify });
      if (!r.ok) return setError({ text: r.error, conflict: r.conflict });
      onChanged();
      onClose();
    });
  }

  const others = event.attendees.filter((a) => !a.self && !a.resource);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} aria-hidden />
      <aside role="dialog" aria-label="Evento de Google Calendar" className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border bg-card shadow-xl">
        <header className="flex items-start gap-2 border-b border-border p-4">
          <span aria-hidden className="mt-1.5 h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: event.calendarColor ?? "#4285f4" }} />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{event.summary?.trim() || "(Sin título)"}</p>
            <p className="text-sm text-muted-foreground">{whenText(event, timezone, timeFormat)}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Google Calendar · {event.calendarName}
              {recurring && " · Se repite"}
              {event.transparency === "transparent" && " · Disponible"}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {mode !== "edit" && (
            <>
              <div className="flex flex-wrap gap-2">
                {event.meetUrl && (
                  <a href={event.meetUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground">
                    <Video className="h-4 w-4" aria-hidden /> Unirse
                  </a>
                )}
                {event.htmlLink && (
                  <a href={event.htmlLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted">
                    <ExternalLink className="h-4 w-4" aria-hidden /> Abrir en Google
                  </a>
                )}
              </div>

              {event.location && (
                <section>
                  <h3 className="text-xs font-medium text-muted-foreground">Lugar</h3>
                  <p className="text-sm">{event.location}</p>
                </section>
              )}

              <section>
                <h3 className="text-xs font-medium text-muted-foreground">Organiza</h3>
                <p className="text-sm">{event.organizerSelf ? "Vos" : (event.organizerEmail ?? "Otra persona")}</p>
              </section>

              {others.length > 0 && (
                <section>
                  <h3 className="text-xs font-medium text-muted-foreground">Invitados ({others.length})</h3>
                  <ul className="mt-1 space-y-1">
                    {others.map((a) => (
                      <li key={a.email} className="flex items-center justify-between gap-2 text-sm">
                        <span className="min-w-0 truncate">{a.name ? `${a.name} · ${a.email}` : a.email}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">{RESPONSE_LABEL[a.response] ?? a.response}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {event.description && (
                <section>
                  <h3 className="text-xs font-medium text-muted-foreground">Descripción</h3>
                  <p className="whitespace-pre-wrap break-words text-sm">{event.description}</p>
                </section>
              )}

              {!editable && (
                <p className="rounded-lg bg-muted/60 p-2 text-xs text-muted-foreground">
                  {event.organizerSelf
                    ? "Este calendario es de solo lectura: este evento no se puede cambiar desde acá."
                    : "Lo organiza otra persona: para cambiarlo, lo tiene que hacer ella. Desde acá lo podés ver o pasar al sistema."}
                </p>
              )}
            </>
          )}

          {mode === "edit" && (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                save();
              }}
            >
              <label className="block text-sm">
                <span className="text-xs text-muted-foreground">Título</span>
                <input value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={500} className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
              </label>
              {!event.allDay && (
                <div className="grid grid-cols-3 gap-2">
                  <label className="block text-sm">
                    <span className="text-xs text-muted-foreground">Día</span>
                    <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 w-full rounded-lg border border-input bg-background px-2 py-2 text-sm" />
                  </label>
                  <label className="block text-sm">
                    <span className="text-xs text-muted-foreground">Hora</span>
                    <input type="time" value={time} step={300} onChange={(e) => setTime(e.target.value)} className="mt-1 w-full rounded-lg border border-input bg-background px-2 py-2 text-sm" />
                  </label>
                  <label className="block text-sm">
                    <span className="text-xs text-muted-foreground">Duración (min)</span>
                    <input type="number" min={5} max={1440} step={5} value={duration} onChange={(e) => setDuration(Number(e.target.value) || 0)} className="mt-1 w-full rounded-lg border border-input bg-background px-2 py-2 text-sm" />
                  </label>
                </div>
              )}
              <label className="block text-sm">
                <span className="text-xs text-muted-foreground">Lugar</span>
                <input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={500} className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
              </label>
              <label className="block text-sm">
                <span className="text-xs text-muted-foreground">Invitados (un email por línea)</span>
                <textarea value={guestText} onChange={(e) => setGuestText(e.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
              </label>
              <label className="block text-sm">
                <span className="text-xs text-muted-foreground">Descripción</span>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
              </label>
              <ScopeAndNotify recurring={recurring} guests={guests || parseGuests(guestText).length > 0} scope={scope} onScope={setScope} notify={notify} onNotify={setNotify} />
              <ErrorLine error={error} onRefresh={onRefresh} />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setMode("view")} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted">
                  Volver
                </button>
                <button type="submit" disabled={pending} className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground disabled:opacity-60">
                  {pending ? "Guardando…" : "Guardar en Google"}
                </button>
              </div>
            </form>
          )}

          {mode === "delete" && (
            <div className="space-y-3 rounded-lg border border-red-200 p-3 dark:border-red-900">
              <p className="text-sm font-medium">¿Eliminar este evento de tu Google Calendar?</p>
              <p className="text-xs text-muted-foreground">Se borra de Google igual que si lo borraras allá.</p>
              <ScopeAndNotify recurring={recurring} guests={guests} scope={scope} onScope={setScope} notify={notify} onNotify={setNotify} />
              <ErrorLine error={error} onRefresh={onRefresh} />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setMode("view")} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted">
                  Volver
                </button>
                <button type="button" disabled={pending} onClick={remove} className="rounded-lg bg-destructive px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60">
                  {pending ? "Eliminando…" : "Sí, eliminar"}
                </button>
              </div>
            </div>
          )}
          {mode === "view" && <ErrorLine error={error} onRefresh={onRefresh} />}
        </div>

        {mode === "view" && (
          <footer className="flex flex-wrap gap-2 border-t border-border p-4">
            {importSlot}
            {editable && (
              <>
                <button type="button" onClick={() => setMode("edit")} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted">
                  <Pencil className="h-4 w-4" aria-hidden /> Editar
                </button>
                <button type="button" onClick={() => setMode("delete")} className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-red-600 hover:bg-muted">
                  <Trash2 className="h-4 w-4" aria-hidden /> Eliminar
                </button>
              </>
            )}
          </footer>
        )}
      </aside>
    </>
  );
}

// ── Confirmar un arrastre ─────────────────────────────────────────────────────────────────────────────────────────

export function GoogleMoveDialog({
  event,
  startUtc,
  durationMinutes,
  timezone,
  timeFormat,
  overlapsBooking,
  onClose,
  onDone,
  onRefresh,
}: {
  event: AgendaGoogleEvent;
  startUtc: string;
  durationMinutes: number;
  timezone: string;
  timeFormat: "12h" | "24h";
  /** Cae encima de una reunión del sistema: se permite (Google también), pero se avisa. */
  overlapsBooking: boolean;
  onClose: () => void;
  onDone: () => void;
  onRefresh: () => void;
}) {
  const [scope, setScope] = useState<"instance" | "series">("instance");
  const [notify, setNotify] = useState(true);
  const [error, setError] = useState<{ text: string; conflict?: boolean } | null>(null);
  const [pending, start] = useTransition();
  const endUtc = new Date(Date.parse(startUtc) + durationMinutes * 60_000).toISOString();

  return (
    <Modal label="Mover el evento de Google" onClose={onClose}>
      <p className="font-medium">Mover «{event.summary?.trim() || "(Sin título)"}»</p>
      <p className="mt-1 text-sm text-muted-foreground">
        {dayText(startUtc, timezone)} · {formatSlotLabel(startUtc, timezone, timeFormat)} a {formatSlotLabel(endUtc, timezone, timeFormat)} ({durationLabel(durationMinutes)})
      </p>
      <p className="mt-1 text-xs text-muted-foreground">Se cambia en tu Google Calendar.</p>
      {overlapsBooking && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">Queda encima de una reunión del sistema.</p>}
      <div className="mt-3">
        <ScopeAndNotify recurring={!!event.recurringEventId} guests={hasOtherGuests(event)} scope={scope} onScope={setScope} notify={notify} onNotify={setNotify} />
      </div>
      <div className="mt-2">
        <ErrorLine error={error} onRefresh={onRefresh} />
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted">
          Volver
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await moveGoogleEvent({ id: event.id, startUtc, durationMinutes, scope, notify });
              if (!r.ok) return setError({ text: r.error, conflict: r.conflict });
              onDone();
            })
          }
          className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          {pending ? "Moviendo…" : "Mover"}
        </button>
      </div>
    </Modal>
  );
}

// ── Elegir qué crear al arrastrar sobre un hueco ─────────────────────────────────────────────────────────────────

export function CreateChoiceDialog({ label, onMeeting, onGoogle, onClose }: { label: string; onMeeting: () => void; onGoogle: () => void; onClose: () => void }) {
  return (
    <Modal label="Qué crear" onClose={onClose}>
      <p className="font-medium">¿Qué querés crear?</p>
      <p className="mt-1 text-sm text-muted-foreground">{label}</p>
      <div className="mt-3 grid gap-2">
        <button type="button" onClick={onMeeting} className="rounded-lg border border-border p-3 text-left hover:bg-muted">
          <span className="block text-sm font-medium">Reunión</span>
          <span className="block text-xs text-muted-foreground">Con un contacto: queda en el sistema y en tu Google Calendar.</span>
        </button>
        <button type="button" onClick={onGoogle} className="rounded-lg border border-border p-3 text-left hover:bg-muted">
          <span className="flex items-center gap-1.5 text-sm font-medium">
            <CalendarPlus className="h-4 w-4" aria-hidden /> Evento de Google
          </span>
          <span className="block text-xs text-muted-foreground">Solo en tu Google Calendar: para bloquear tiempo o anotar algo.</span>
        </button>
      </div>
    </Modal>
  );
}

// ── Crear un evento de Google ────────────────────────────────────────────────────────────────────────────────────

export function GoogleCreateDialog({
  calendars,
  initial,
  timezone,
  onClose,
  onCreated,
}: {
  calendars: AgendaGoogleCalendar[];
  initial: { date: string; startMinutes: number; durationMinutes: number };
  timezone: string;
  onClose: () => void;
  onCreated: (id: string | null) => void;
}) {
  const writable = useMemo(() => calendars.filter((c) => c.writable), [calendars]);
  const [calendarId, setCalendarId] = useState((writable.find((c) => c.isDefault) ?? writable[0])?.id ?? "");
  const [summary, setSummary] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(minutesToTime(initial.startMinutes));
  const [duration, setDuration] = useState(initial.durationMinutes);
  const [guestText, setGuestText] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [addMeet, setAddMeet] = useState(false);
  const [busy, setBusy] = useState(true);
  const [notify, setNotify] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const guests = parseGuests(guestText);

  if (writable.length === 0) {
    return (
      <Modal label="Crear un evento de Google" onClose={onClose}>
        <p className="font-medium">No tenés un calendario de Google donde crear eventos</p>
        <p className="mt-1 text-sm text-muted-foreground">Conectá tu Google Calendar en Ajustes de calendarios.</p>
        <div className="mt-3 flex justify-end">
          <button type="button" onClick={onClose} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted">
            Cerrar
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal label="Crear un evento de Google" onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          start(async () => {
            const r = await createGoogleEvent({
              calendarId,
              summary,
              description,
              location,
              ...(allDay ? { allDayDate: date } : { startUtc: wallClockToUtc(date, time as WallTime, timezone).toISOString(), durationMinutes: duration }),
              timeZone: timezone,
              guests,
              addMeet,
              busy,
              notify,
            });
            if (!r.ok) return setError(r.error);
            onCreated(r.id ?? null);
          });
        }}
      >
        <p className="font-medium">Nuevo evento de Google</p>
        <label className="block text-sm">
          <span className="text-xs text-muted-foreground">Título</span>
          <input autoFocus required value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={500} className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
        </label>
        {writable.length > 1 && (
          <label className="block text-sm">
            <span className="text-xs text-muted-foreground">Calendario</span>
            <select value={calendarId} onChange={(e) => setCalendarId(e.target.value)} className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm">
              {writable.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} /> Todo el día
        </label>
        <div className={cn("grid gap-2", allDay ? "grid-cols-1" : "grid-cols-3")}>
          <label className="block text-sm">
            <span className="text-xs text-muted-foreground">Día</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 w-full rounded-lg border border-input bg-background px-2 py-2 text-sm" />
          </label>
          {!allDay && (
            <>
              <label className="block text-sm">
                <span className="text-xs text-muted-foreground">Hora</span>
                <input type="time" value={time} step={300} onChange={(e) => setTime(e.target.value)} className="mt-1 w-full rounded-lg border border-input bg-background px-2 py-2 text-sm" />
              </label>
              <label className="block text-sm">
                <span className="text-xs text-muted-foreground">Duración (min)</span>
                <input type="number" min={5} max={1440} step={5} value={duration} onChange={(e) => setDuration(Number(e.target.value) || 0)} className="mt-1 w-full rounded-lg border border-input bg-background px-2 py-2 text-sm" />
              </label>
            </>
          )}
        </div>
        <label className="block text-sm">
          <span className="text-xs text-muted-foreground">Invitados (opcional, un email por línea)</span>
          <textarea value={guestText} onChange={(e) => setGuestText(e.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
        </label>
        <label className="block text-sm">
          <span className="text-xs text-muted-foreground">Lugar (opcional)</span>
          <input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={500} className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
        </label>
        <label className="block text-sm">
          <span className="text-xs text-muted-foreground">Descripción (opcional)</span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
        </label>
        <div className="flex flex-col gap-2 text-sm">
          {!allDay && (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={addMeet} onChange={(e) => setAddMeet(e.target.checked)} /> Agregar Google Meet
            </label>
          )}
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={busy} onChange={(e) => setBusy(e.target.checked)} /> Marcarme ocupado (bloquea esos horarios en la página de reservas)
          </label>
          {guests.length > 0 && (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Mandarles la invitación por email
            </label>
          )}
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted">
            Volver
          </button>
          <button type="submit" disabled={pending || !calendarId} className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground disabled:opacity-60">
            {pending ? "Creando…" : "Crear en Google"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
