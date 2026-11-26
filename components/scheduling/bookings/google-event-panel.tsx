"use client";

/**
 * Un evento de Google Calendar abierto en la Agenda (00510): el detalle, editarlo, moverlo y borrarlo. Y los diálogos
 * del calendario: confirmar un arrastre, crear un evento de Google y elegir qué crear al arrastrar sobre un hueco.
 *
 * Todo cambio pasa por una acción del servidor que vuelve a mirar que el evento sea de quien lo cambia y que no haya
 * cambiado en Google mientras tanto. La descripción se muestra como texto, nunca como HTML.
 */
import { SIDE_PANEL_BACKDROP_CLASS, SIDE_PANEL_CLASS } from "./side-panel";
import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { CalendarDays, CheckSquare, ExternalLink, Trash2, Video, X } from "lucide-react";
import {
  canEditGoogleEvent,
  durationMinutesOf,
  hasOtherGuests,
  suggestedContact,
  type AgendaGoogleCalendar,
  type AgendaGoogleEvent,
} from "@/lib/google-calendar/agenda";
import { createGoogleEvent, deleteGoogleEvent, importGoogleEvent, moveGoogleEvent, updateGoogleEvent } from "@/lib/actions/scheduling/google-events";
import { formatSlotLabel } from "@/lib/scheduling/booker/format";
import { dateInTz, minutesOfDayInTz, wallClockToUtc } from "@/lib/scheduling/time/tz";
import { minutesToTime } from "@/lib/calendar/time";
import { durationLabel } from "@/lib/scheduling/booking-drag";
import type { WallTime } from "@/lib/scheduling/types";
import { cn } from "@/lib/utils";
import { categoryTree, type CategoryRow } from "@/lib/scheduling/categories";
import { dayText, googleWhen } from "@/lib/calendar/hover-content";
import { googleEditParts, googleEditSummary, type GoogleEditState } from "@/lib/google-calendar/edit-summary";

const RESPONSE_LABEL: Record<string, string> = {
  accepted: "Va",
  declined: "No va",
  tentative: "Quizás",
  needsAction: "Sin responder",
};

function whenText(ev: AgendaGoogleEvent, timezone: string, timeFormat: "12h" | "24h"): string {
  return googleWhen(ev, timezone, timeFormat);
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

// ── Confirmar un cambio en Google ────────────────────────────────────────────────────────────────────────────────

/**
 * El modal de confirmación de TODO lo que cambia un evento de Google desde la Agenda: qué cambia, «solo este / toda la
 * serie» si se repite y «avisar a los invitados» si tiene. Nada se escribe en Google sin pasar por acá (o por
 * `GoogleMoveDialog`, que es lo mismo para arrastrar y estirar).
 */
export function GoogleConfirmDialog({
  title,
  changes,
  note,
  recurring,
  guests,
  confirmLabel,
  danger = false,
  pending,
  error,
  onRefresh,
  onClose,
  onConfirm,
}: {
  title: string;
  changes: string[];
  note?: string;
  recurring: boolean;
  guests: boolean;
  confirmLabel: string;
  danger?: boolean;
  pending: boolean;
  error: { text: string; conflict?: boolean } | null;
  onRefresh?: () => void;
  onClose: () => void;
  onConfirm: (opts: { scope: "instance" | "series"; notify: boolean }) => void;
}) {
  const [scope, setScope] = useState<"instance" | "series">("instance");
  const [notify, setNotify] = useState(true);
  return (
    <Modal label={title} onClose={onClose}>
      <p className="font-medium">{title}</p>
      {changes.length > 0 && (
        <>
          <p className="mt-2 text-xs font-medium text-muted-foreground">Qué cambia en tu Google Calendar</p>
          <ul className="mt-1 space-y-1">
            {changes.map((c, i) => (
              <li key={i} className="break-words text-sm">
                • {c}
              </li>
            ))}
          </ul>
        </>
      )}
      {note && <p className="mt-2 text-xs text-muted-foreground">{note}</p>}
      <div className="mt-3">
        <ScopeAndNotify recurring={recurring} guests={guests} scope={scope} onScope={setScope} notify={notify} onNotify={setNotify} />
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
          onClick={() => onConfirm({ scope, notify })}
          className={cn("rounded-lg px-3 py-1.5 text-sm font-semibold disabled:opacity-60", danger ? "bg-destructive text-white" : "bg-primary text-primary-foreground")}
        >
          {pending ? "Guardando…" : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

// ── El panel ─────────────────────────────────────────────────────────────────────────────────────────────────────

function stateOf(ev: AgendaGoogleEvent): GoogleEditState {
  return {
    summary: ev.summary ?? "",
    location: ev.location ?? "",
    description: ev.description ?? "",
    guests: ev.attendees.filter((a) => !a.self && !a.resource).map((a) => a.email),
    startUtc: ev.allDay ? null : new Date(ev.startAt).toISOString(),
    durationMinutes: durationMinutesOf(ev),
  };
}

/**
 * El panel de un evento de Google: queda al costado del calendario (se sigue pudiendo arrastrar y estirar). Si el
 * evento es tuyo, todo lo que se puede cambiar está editable de entrada; «Guardar cambios» y «Eliminar» siempre pasan
 * por el modal de confirmación. Se re-arma con `key={id + etag}`: si cambió (por ejemplo, se movió desde el
 * calendario), muestra lo nuevo.
 */
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
  const before = useMemo(() => stateOf(event), [event]);
  const [error, setError] = useState<{ text: string; conflict?: boolean } | null>(null);
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState<"save" | "delete" | null>(null);

  const [summary, setSummary] = useState(before.summary);
  const [location, setLocation] = useState(before.location);
  const [description, setDescription] = useState(before.description);
  const [guestText, setGuestText] = useState(before.guests.join("\n"));
  const [date, setDate] = useState(dateInTz(event.startAt, timezone));
  const [time, setTime] = useState(minutesToTime(minutesOfDayInTz(event.startAt, timezone)));
  const [duration, setDuration] = useState(before.durationMinutes);

  const after: GoogleEditState = {
    summary,
    location,
    description,
    guests: parseGuests(guestText),
    startUtc: event.allDay ? null : safeUtc(date, time, timezone),
    durationMinutes: duration,
  };
  const parts = googleEditParts(before, after);
  const dirty = parts.text || parts.time;
  const changes = googleEditSummary(before, after, timezone, timeFormat);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Con un modal abierto encima, Esc cierra solo el modal.
      if (e.key === "Escape" && !document.querySelector('[role="dialog"][aria-modal="true"]')) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function discard() {
    setSummary(before.summary);
    setLocation(before.location);
    setDescription(before.description);
    setGuestText(before.guests.join("\n"));
    setDate(dateInTz(event.startAt, timezone));
    setTime(minutesToTime(minutesOfDayInTz(event.startAt, timezone)));
    setDuration(before.durationMinutes);
    setError(null);
  }

  function save(opts: { scope: "instance" | "series"; notify: boolean }) {
    setError(null);
    start(async () => {
      if (parts.text) {
        const patch: Parameters<typeof updateGoogleEvent>[0] = { id: event.id, scope: opts.scope, notify: opts.notify };
        if (summary !== before.summary) patch.summary = summary;
        if (location !== before.location) patch.location = location;
        if (description !== before.description) patch.description = description;
        if (parts.guests) patch.guests = after.guests;
        const r = await updateGoogleEvent(patch);
        if (!r.ok) return setError({ text: r.error, conflict: r.conflict });
      }
      if (parts.time && after.startUtc) {
        const r = await moveGoogleEvent({ id: event.id, startUtc: after.startUtc, durationMinutes: duration, scope: opts.scope, notify: opts.notify });
        if (!r.ok) return setError({ text: r.error, conflict: r.conflict });
      }
      setConfirm(null);
      onChanged();
    });
  }

  function remove(opts: { scope: "instance" | "series"; notify: boolean }) {
    setError(null);
    start(async () => {
      const r = await deleteGoogleEvent({ id: event.id, scope: opts.scope, notify: opts.notify });
      if (!r.ok) return setError({ text: r.error, conflict: r.conflict });
      setConfirm(null);
      onChanged();
      onClose();
    });
  }

  const others = event.attendees.filter((a) => !a.self && !a.resource);
  const input = "mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm";

  return (
    <>
      <div className={SIDE_PANEL_BACKDROP_CLASS} onClick={onClose} aria-hidden />
      <aside role="dialog" aria-label="Evento de Google Calendar" className={SIDE_PANEL_CLASS}>
        <header className="flex items-start gap-2 border-b border-border p-4">
          <span aria-hidden className="mt-1.5 h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: event.calendarColor ?? "#4285f4" }} />
          <div className="min-w-0 flex-1">
            <p className="break-words font-semibold">{event.summary?.trim() || "(Sin título)"}</p>
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

          {editable ? (
            <div className="space-y-3">
              <label className="block text-sm">
                <span className="text-xs text-muted-foreground">Título</span>
                <input value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={500} className={input} />
              </label>
              {!event.allDay && (
                <div className="grid grid-cols-3 gap-2">
                  <label className="block text-sm">
                    <span className="text-xs text-muted-foreground">Día</span>
                    <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={cn(input, "px-2")} />
                  </label>
                  <label className="block text-sm">
                    <span className="text-xs text-muted-foreground">Hora</span>
                    <input type="time" value={time} step={300} onChange={(e) => setTime(e.target.value)} className={cn(input, "px-2")} />
                  </label>
                  <label className="block text-sm">
                    <span className="text-xs text-muted-foreground">Duración (min)</span>
                    <input type="number" min={5} max={1440} step={5} value={duration} onChange={(e) => setDuration(Number(e.target.value) || 0)} className={cn(input, "px-2")} />
                  </label>
                </div>
              )}
              <label className="block text-sm">
                <span className="text-xs text-muted-foreground">Lugar</span>
                <input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={500} className={input} />
              </label>
              <label className="block text-sm">
                <span className="text-xs text-muted-foreground">Invitados (un email por línea)</span>
                <textarea value={guestText} onChange={(e) => setGuestText(e.target.value)} rows={3} className={input} />
              </label>
              {others.length > 0 && <GuestResponses guests={others} />}
              <label className="block text-sm">
                <span className="text-xs text-muted-foreground">Descripción</span>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={5} className={input} />
              </label>
            </div>
          ) : (
            <div className="space-y-4">
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
              {others.length > 0 && <GuestResponses guests={others} />}
              {event.description && (
                <section>
                  <h3 className="text-xs font-medium text-muted-foreground">Descripción</h3>
                  <p className="whitespace-pre-wrap break-words text-sm">{event.description}</p>
                </section>
              )}
              <p className="rounded-lg bg-muted/60 p-2 text-xs text-muted-foreground">
                {event.organizerSelf
                  ? "Este calendario es de solo lectura: este evento no se puede cambiar desde acá."
                  : "Lo organiza otra persona: para cambiarlo, lo tiene que hacer ella. Desde acá lo podés ver o pasar al sistema."}
              </p>
            </div>
          )}
          {!confirm && <ErrorLine error={error} onRefresh={onRefresh} />}
        </div>

        <footer className="flex flex-wrap items-center gap-2 border-t border-border p-4 pr-20">
          {editable && dirty ? (
            <>
              <button type="button" onClick={() => setConfirm("save")} className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground">
                Guardar cambios
              </button>
              <button type="button" onClick={discard} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted">
                Descartar
              </button>
            </>
          ) : (
            importSlot
          )}
          {editable && (
            <button type="button" onClick={() => setConfirm("delete")} className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-red-600 hover:bg-muted">
              <Trash2 className="h-4 w-4" aria-hidden /> Eliminar
            </button>
          )}
        </footer>
      </aside>

      {confirm === "save" && (
        <GoogleConfirmDialog
          title="¿Guardar los cambios en tu Google Calendar?"
          changes={changes}
          recurring={recurring}
          guests={hasOtherGuests(event) || after.guests.length > 0}
          confirmLabel="Sí, guardar"
          pending={pending}
          error={error}
          onRefresh={onRefresh}
          onClose={() => setConfirm(null)}
          onConfirm={save}
        />
      )}
      {confirm === "delete" && (
        <GoogleConfirmDialog
          title={`¿Eliminar «${event.summary?.trim() || "(Sin título)"}» de tu Google Calendar?`}
          changes={[whenText(event, timezone, timeFormat)]}
          note="Se borra de Google igual que si lo borraras allá."
          recurring={recurring}
          guests={hasOtherGuests(event)}
          confirmLabel="Sí, eliminar"
          danger
          pending={pending}
          error={error}
          onRefresh={onRefresh}
          onClose={() => setConfirm(null)}
          onConfirm={remove}
        />
      )}
    </>
  );
}

function GuestResponses({ guests }: { guests: AgendaGoogleEvent["attendees"] }) {
  return (
    <section>
      <h3 className="text-xs font-medium text-muted-foreground">Respuestas ({guests.length})</h3>
      <ul className="mt-1 space-y-1">
        {guests.map((a) => (
          <li key={a.email} className="flex items-center justify-between gap-2 text-sm">
            <span className="min-w-0 truncate">{a.name ? `${a.name} · ${a.email}` : a.email}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{RESPONSE_LABEL[a.response] ?? a.response}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** El instante de un día y una hora escritos en la zona de quien mira (o null si falta algo). */
function safeUtc(date: string, time: string, timezone: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const d = wallClockToUtc(date, time as WallTime, timezone);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
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

/** El logo de Google Calendar (public/brand/google-calendar.svg): solo para señalar lo que va a Google. */
export function GoogleCalendarLogo({ className }: { className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/brand/google-calendar.svg" alt="" aria-hidden className={cn("h-5 w-5 shrink-0", className)} />;
}

/**
 * «¿Qué querés crear?» al hacer clic o arrastrar sobre un hueco del calendario: Reunión, Tarea o Evento de Google, cada
 * una con su ícono. El evento de Google se ve más apagado (no queda en el sistema), pero se puede elegir.
 * Solo aparecen las opciones que quien mira puede usar.
 */
export function CreateChoiceDialog({
  label,
  onMeeting,
  onTask,
  onGoogle,
  onClose,
}: {
  label: string;
  onMeeting?: () => void;
  onTask?: () => void;
  onGoogle?: () => void;
  onClose: () => void;
}) {
  const option = "flex items-start gap-3 rounded-lg border border-border p-3 text-left hover:bg-muted";
  return (
    <Modal label="Qué crear" onClose={onClose}>
      <p className="font-medium">¿Qué querés crear?</p>
      <p className="mt-1 text-sm text-muted-foreground">{label}</p>
      <div className="mt-3 grid gap-2">
        {onMeeting && (
          <button type="button" onClick={onMeeting} className={option}>
            <CalendarDays className="mt-0.5 h-5 w-5 shrink-0 text-primary-ink" aria-hidden />
            <span>
              <span className="block text-sm font-medium">Reunión</span>
              <span className="block text-xs text-muted-foreground">Con un contacto: queda en el sistema y en tu Google Calendar.</span>
            </span>
          </button>
        )}
        {onTask && (
          <button type="button" onClick={onTask} className={option}>
            <CheckSquare className="mt-0.5 h-5 w-5 shrink-0 text-primary-ink" aria-hidden />
            <span>
              <span className="block text-sm font-medium">Tarea</span>
              <span className="block text-xs text-muted-foreground">Algo para hacer, con ese día y esa hora.</span>
            </span>
          </button>
        )}
        {onGoogle && (
          <button type="button" onClick={onGoogle} className={cn(option, "bg-muted/40 text-muted-foreground")}>
            <GoogleCalendarLogo className="mt-0.5 opacity-60 grayscale-[40%]" />
            <span>
              <span className="block text-sm font-medium">Evento de Google</span>
              <span className="block text-xs">Solo en tu Google Calendar, no en el sistema: para bloquear tiempo o anotar algo.</span>
            </span>
          </button>
        )}
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
  // Antes de crear, el resumen de lo que se va a crear en Google (siempre se confirma).
  const [confirming, setConfirming] = useState(false);
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
      {confirming && (
        <div className="space-y-3">
          <p className="font-medium">¿Crear este evento en tu Google Calendar?</p>
          <ul className="space-y-1 text-sm">
            <li>• {summary.trim()}</li>
            <li>
              •{" "}
              {allDay
                ? `${dayText(date, timezone, true)} · Todo el día`
                : (() => {
                    const startUtc = safeUtc(date, time, timezone);
                    return startUtc
                      ? `${dayText(startUtc, timezone)} · ${time} (${durationLabel(duration)})`
                      : `${date} ${time}`;
                  })()}
            </li>
            <li>• Calendario: {writable.find((c) => c.id === calendarId)?.name ?? ""}</li>
            {guests.length > 0 && <li>• Invitados: {guests.join(", ")}{notify ? " (les llega la invitación por email)" : " (sin avisarles)"}</li>}
            {addMeet && !allDay && <li>• Con Google Meet</li>}
            {!busy && <li>• Marcado «Disponible»: no bloquea horarios</li>}
          </ul>
          {error && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setConfirming(false)} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted">
              Volver
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
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
              className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {pending ? "Creando…" : "Sí, crear"}
            </button>
          </div>
        </div>
      )}
      <form
        className={cn("space-y-3", confirming && "hidden")}
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!summary.trim()) return setError("Ponele un título.");
          setConfirming(true);
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
            Crear en Google
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ── Pasar al sistema ─────────────────────────────────────────────────────────────────────────────────────────────

type ContactHit = { id: string; name: string; detail: string };

export function GoogleImportDialog({
  event,
  categories,
  ownEvents,
  searchContacts,
  onClose,
  onImported,
}: {
  event: AgendaGoogleEvent;
  /** Las áreas y sus tipos de reunión (`booking_categories`). */
  categories: CategoryRow[];
  /** Los eventos de quien importa (para elegir uno, opcional). */
  ownEvents: Array<{ id: string; title: string }>;
  searchContacts: (term: string) => Promise<ContactHit[]>;
  onClose: () => void;
  onImported: (bookingId: string) => void;
}) {
  const suggested = suggestedContact(event);
  const [mode, setMode] = useState<"new" | "existing">(suggested ? "new" : "existing");
  const [name, setName] = useState(suggested?.name ?? "");
  const [email, setEmail] = useState(suggested?.email ?? "");
  const [term, setTerm] = useState(suggested?.email ?? "");
  const [hits, setHits] = useState<ContactHit[]>([]);
  const [picked, setPicked] = useState<ContactHit | null>(null);
  const tree = useMemo(() => categoryTree(categories.filter((c) => !c.archived_at)), [categories]);
  const [areaId, setAreaId] = useState(tree[0]?.area.id ?? "");
  const [typeId, setTypeId] = useState("");
  const types = tree.find((t) => t.area.id === areaId)?.types ?? [];
  const [eventTypeId, setEventTypeId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [searching, startSearch] = useTransition();

  useEffect(() => {
    if (mode !== "existing" || term.trim().length < 2) return;
    const t = setTimeout(() => {
      startSearch(async () => {
        const r = await searchContacts(term.trim()).catch(() => []);
        setHits(r.slice(0, 8));
      });
    }, 250);
    return () => clearTimeout(t);
  }, [mode, term, searchContacts]);

  return (
    <Modal label="Pasar el evento al sistema" onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          start(async () => {
            const r = await importGoogleEvent({
              id: event.id,
              ...(mode === "existing" ? { contactId: picked?.id ?? null } : { name, email }),
              // El tipo si se eligió uno; si no, el área.
              categoryId: eventTypeId ? null : typeId || areaId || null,
              eventTypeId: eventTypeId || null,
            });
            if (!r.ok) return setError(r.error);
            onImported(r.bookingId);
          });
        }}
      >
        <p className="font-medium">Pasar «{event.summary?.trim() || "(Sin título)"}» al sistema</p>
        <p className="text-xs text-muted-foreground">
          Queda como una reunión, con su contacto. No se crea otro evento en Google y no se manda la confirmación; los recordatorios y lo de después sí.
        </p>
        {!event.organizerSelf && (
          <p className="text-xs text-amber-700 dark:text-amber-300">Lo organiza otra persona: si después la movés desde acá, en Google no se mueve.</p>
        )}

        <fieldset className="space-y-2">
          <legend className="text-xs text-muted-foreground">Contacto</legend>
          <div className="flex gap-3 text-sm">
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={mode === "new"} onChange={() => setMode("new")} /> Por email
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={mode === "existing"} onChange={() => setMode("existing")} /> Buscar uno que ya existe
            </label>
          </div>
          {mode === "new" ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <input aria-label="Nombre" placeholder="Nombre" value={name} onChange={(e) => setName(e.target.value)} className="rounded-lg border border-input bg-background px-3 py-2 text-sm" />
              <input aria-label="Email" type="email" required placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} className="rounded-lg border border-input bg-background px-3 py-2 text-sm" />
              <p className="text-[11px] text-muted-foreground sm:col-span-2">Si ya hay un contacto con ese email, se usa ese.</p>
            </div>
          ) : (
            <div className="space-y-1">
              <input
                aria-label="Buscar contacto"
                placeholder="Nombre, email o teléfono"
                value={term}
                onChange={(e) => {
                  setTerm(e.target.value);
                  setPicked(null);
                }}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
              />
              {picked ? (
                <p className="text-sm">
                  Elegido: <span className="font-medium">{picked.name}</span> <span className="text-xs text-muted-foreground">{picked.detail}</span>
                </p>
              ) : (
                <ul className="max-h-40 overflow-y-auto rounded-lg border border-border">
                  {searching && <li className="p-2 text-xs text-muted-foreground">Buscando…</li>}
                  {!searching && hits.length === 0 && term.trim().length >= 2 && <li className="p-2 text-xs text-muted-foreground">Sin resultados</li>}
                  {hits.map((h) => (
                    <li key={h.id}>
                      <button type="button" onClick={() => setPicked(h)} className="w-full p-2 text-left text-sm hover:bg-muted">
                        {h.name} <span className="text-xs text-muted-foreground">{h.detail}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </fieldset>

        {ownEvents.length > 0 && (
          <label className="block text-sm">
            <span className="text-xs text-muted-foreground">Evento (opcional)</span>
            <select value={eventTypeId} onChange={(e) => setEventTypeId(e.target.value)} className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm">
              <option value="">Sin evento</option>
              {ownEvents.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.title}
                </option>
              ))}
            </select>
          </label>
        )}
        {!eventTypeId && tree.length > 0 && (
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="text-xs text-muted-foreground">Área</span>
              <select
                value={areaId}
                onChange={(e) => {
                  setAreaId(e.target.value);
                  setTypeId("");
                }}
                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
              >
                {tree.map((t) => (
                  <option key={t.area.id} value={t.area.id}>
                    {t.area.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-xs text-muted-foreground">Tipo de reunión</span>
              <select value={typeId} onChange={(e) => setTypeId(e.target.value)} disabled={types.length === 0} className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm disabled:opacity-60">
                <option value="">{types.length === 0 ? "Esta área no tiene tipos" : "Sin tipo"}</option>
                {types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted">
            Volver
          </button>
          <button type="submit" disabled={pending || (mode === "existing" && !picked)} className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground disabled:opacity-60">
            {pending ? "Pasando…" : "Pasar al sistema"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
