"use client";

/**
 * Agendar a mano en UN paso (octubre 2026), como en Google Calendar: titulo,
 * invitado, dia, hora, duracion y notas.
 *
 *  - El titulo se escribe, o se elige un evento de la lista (activos arriba,
 *    inactivos abajo). Con un evento, la duracion y el anfitrion salen de el.
 *  - El invitado es un contacto que ya existe (se busca escribiendo) o uno
 *    nuevo con nombre y email.
 *  - El horario es libre: no se limita a los turnos del evento. Si el
 *    anfitrion ya tiene otra reunion a esa hora, el servidor avisa y no la crea.
 *
 * Las reglas (que falta, que es valido) son las de `planManualBooking`, las
 * mismas que repite el servidor.
 */

import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Check, Loader2, UserPlus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { bookManuallyQuick } from "@/lib/actions/scheduling/bookings";
import { MANUAL_DURATIONS, planManualBooking, type ManualBookingField } from "@/lib/scheduling/booking/manual-input";
import { dateInTz, minutesOfDayInTz, minutesToWallTime } from "@/lib/scheduling/time/tz";

export interface ManualEventOption {
  id: string;
  title: string;
  durationMinutes: number;
  categoryLabel: string;
  hostName: string;
  status: "active" | "hidden" | "inactive";
  color: string | null;
}

export interface ManualContactOption {
  id: string;
  name: string;
  detail: string;
  timezone: string | null;
}

const inputClass =
  "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring aria-[invalid=true]:border-red-500/60";
const labelClass = "mb-1 block text-xs font-medium text-muted-foreground";

/** La proxima media hora redonda, en la zona de quien agenda. */
function nextHalfHour(timezone: string): { date: string; time: string } {
  const now = new Date();
  const minutes = minutesOfDayInTz(now, timezone);
  const next = Math.ceil((minutes + 1) / 30) * 30;
  if (next >= 24 * 60) {
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    return { date: dateInTz(tomorrow, timezone), time: "09:00" };
  }
  return { date: dateInTz(now, timezone), time: minutesToWallTime(next) };
}

export function BookManualDialog({
  events,
  timezone,
  onClose,
  searchContacts,
  hosts,
  currentUserId,
  areas,
}: {
  events: ManualEventOption[];
  timezone: string;
  /** Se conserva por compatibilidad con quien lo monta (el modal usa la hora de 24 h del navegador). */
  timeFormat?: "12h" | "24h";
  onClose: () => void;
  searchContacts: (term: string) => Promise<ManualContactOption[]>;
  /** Quienes pueden atender una reunion sin evento. */
  hosts: Array<{ userId: string; label: string }>;
  currentUserId: string;
  /** Las areas de la agenda (sin evento, la reunion va a una; por defecto "Otros"). */
  areas: Array<{ id: string; name: string; isDefault: boolean }>;
}) {
  const router = useRouter();
  const titleId = useId();
  const initial = useMemo(() => nextHalfHour(timezone), [timezone]);

  const [title, setTitle] = useState("");
  const [eventId, setEventId] = useState<string | null>(null);
  const [eventListOpen, setEventListOpen] = useState(false);

  const [guestTerm, setGuestTerm] = useState("");
  const [guestResults, setGuestResults] = useState<ManualContactOption[]>([]);
  const [contact, setContact] = useState<ManualContactOption | null>(null);
  const [newGuest, setNewGuest] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [duration, setDuration] = useState(30);
  const [hostUserId, setHostUserId] = useState(currentUserId);
  const [categoryId, setCategoryId] = useState(areas.find((a) => a.isDefault)?.id ?? areas[0]?.id ?? "");
  const [notes, setNotes] = useState("");

  const [error, setError] = useState<{ field: ManualBookingField | null; message: string } | null>(null);
  const [pending, start] = useTransition();
  const titleRef = useRef<HTMLInputElement>(null);

  const event = events.find((e) => e.id === eventId) ?? null;

  useEffect(() => {
    titleRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Los contactos se buscan mientras se escribe, con una pausa para no disparar una consulta por tecla.
  useEffect(() => {
    if (contact || newGuest || !guestTerm.trim()) return;
    let alive = true;
    const id = setTimeout(async () => {
      const found = await searchContacts(guestTerm);
      if (alive) setGuestResults(found);
    }, 250);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [contact, guestTerm, newGuest, searchContacts]);

  // Los eventos que coinciden con lo escrito: activos (y ocultos) arriba, inactivos abajo.
  const needle = title.trim().toLowerCase();
  const matching = events.filter((e) => !needle || e.title.toLowerCase().includes(needle) || e.id === eventId);
  const activeEvents = matching.filter((e) => e.status !== "inactive");
  const inactiveEvents = matching.filter((e) => e.status === "inactive");

  function chooseEvent(e: ManualEventOption) {
    setEventId(e.id);
    setTitle(e.title);
    setDuration(e.durationMinutes);
    setEventListOpen(false);
    setError(null);
  }

  function startNewGuest() {
    const term = guestTerm.trim();
    setNewGuest(true);
    if (term.includes("@")) setEmail(term);
    else setName(term);
    setGuestResults([]);
  }

  function submit() {
    const input = {
      eventTypeId: eventId,
      title,
      hostUserId: eventId ? null : hostUserId,
      categoryId: eventId ? null : categoryId,
      date,
      time,
      durationMinutes: duration,
      timezone,
      contactId: contact?.id ?? null,
      name: contact ? "" : name,
      email: contact ? "" : email,
      phone: contact ? "" : phone,
      notes,
    };
    if (!contact && !newGuest) {
      setError({ field: "contact", message: "Elegí un contacto o agregá un invitado nuevo." });
      return;
    }
    const checked = planManualBooking(input);
    if (!checked.ok) {
      setError({ field: checked.field, message: checked.error });
      return;
    }
    setError(null);
    start(async () => {
      const result = await bookManuallyQuick(input);
      if (!result.ok) {
        setError({ field: null, message: result.error });
        return;
      }
      router.refresh();
      onClose();
    });
  }

  const invalid = (field: ManualBookingField) => (error?.field === field ? true : undefined);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-border bg-background shadow-xl sm:rounded-2xl"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 id={titleId} className="flex items-center gap-2 text-base font-semibold">
            <CalendarClock className="h-4 w-4 text-muted-foreground" aria-hidden />
            Agendar una reunión
          </h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form
          className="flex-1 space-y-4 overflow-y-auto px-5 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          {/* Titulo o evento */}
          <div className="relative">
            <label htmlFor={`${titleId}-title`} className={labelClass}>
              Título o evento
            </label>
            <input
              id={`${titleId}-title`}
              ref={titleRef}
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setEventListOpen(true);
              }}
              // La lista se abre al tocar el campo, al escribir o con la flecha abajo; no al abrir el
              // modal (el foco arranca aca y la lista tapaba el campo del invitado).
              onClick={() => setEventListOpen(true)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") setEventListOpen(true);
                else if (e.key === "Escape" && eventListOpen) {
                  e.stopPropagation();
                  setEventListOpen(false);
                }
              }}
              onBlur={() => setTimeout(() => setEventListOpen(false), 150)}
              placeholder="Ej: Llamada con Ana, o elegí un evento"
              autoComplete="off"
              aria-invalid={invalid("title")}
              className={cn(inputClass, "h-10 text-base font-medium")}
            />
            {eventListOpen && events.length > 0 && (activeEvents.length > 0 || inactiveEvents.length > 0) && (
              <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-64 overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-lg">
                {[
                  { label: "Eventos activos", items: activeEvents },
                  { label: "Eventos inactivos", items: inactiveEvents },
                ].map(
                  (group) =>
                    group.items.length > 0 && (
                      <div key={group.label}>
                        <p className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{group.label}</p>
                        {group.items.map((e) => (
                          <button
                            key={e.id}
                            type="button"
                            onMouseDown={(ev) => ev.preventDefault()}
                            onClick={() => chooseEvent(e)}
                            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-accent"
                          >
                            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: e.color ?? "var(--muted-foreground)" }} aria-hidden />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium">{e.title}</span>
                              <span className="block truncate text-xs text-muted-foreground">
                                {e.durationMinutes} min · {e.hostName} · {e.categoryLabel}
                                {e.status === "hidden" ? " · oculto" : ""}
                              </span>
                            </span>
                            {e.id === eventId && <Check className="h-4 w-4 text-primary" aria-hidden />}
                          </button>
                        ))}
                      </div>
                    ),
                )}
              </div>
            )}
            {event ? (
              <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                <span>
                  Evento: <span className="font-medium text-foreground">{event.title}</span> · atiende {event.hostName}
                  {event.status === "inactive" ? " · inactivo" : ""}
                </span>
                <button
                  type="button"
                  onClick={() => setEventId(null)}
                  className="font-medium text-primary hover:underline"
                >
                  Quitar el evento
                </button>
              </p>
            ) : (
              <p className="mt-1.5 text-xs text-muted-foreground">
                {events.length > 0 ? "Escribí un título libre o elegí uno de tus eventos." : "Escribí un título para la reunión."}
              </p>
            )}
          </div>

          {/* Invitado */}
          <div className="relative">
            <span className={labelClass}>Invitado</span>
            {contact ? (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{contact.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{contact.detail}</span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setContact(null);
                    setGuestTerm("");
                  }}
                  className="shrink-0 text-xs font-medium text-primary hover:underline"
                >
                  Cambiar
                </button>
              </div>
            ) : newGuest ? (
              <div className="space-y-2 rounded-lg border border-border p-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <label htmlFor={`${titleId}-name`} className={labelClass}>
                      Nombre
                    </label>
                    <input id={`${titleId}-name`} value={name} onChange={(e) => setName(e.target.value)} aria-invalid={invalid("name")} className={inputClass} />
                  </div>
                  <div>
                    <label htmlFor={`${titleId}-email`} className={labelClass}>
                      Email
                    </label>
                    <input
                      id={`${titleId}-email`}
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      aria-invalid={invalid("email")}
                      className={inputClass}
                    />
                  </div>
                </div>
                <div>
                  <label htmlFor={`${titleId}-phone`} className={labelClass}>
                    Teléfono (opcional)
                  </label>
                  <input id={`${titleId}-phone`} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setNewGuest(false);
                    setName("");
                    setEmail("");
                    setPhone("");
                  }}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  Buscar un contacto que ya existe
                </button>
              </div>
            ) : (
              <>
                <input
                  value={guestTerm}
                  onChange={(e) => setGuestTerm(e.target.value)}
                  placeholder="Buscá por nombre, email o teléfono"
                  autoComplete="off"
                  aria-label="Buscar el invitado"
                  aria-invalid={invalid("contact")}
                  className={inputClass}
                />
                {guestTerm.trim() && (
                  <div className="mt-1 max-h-56 overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-sm">
                    {guestResults.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setContact(c);
                          setGuestResults([]);
                          setError(null);
                        }}
                        className="block w-full rounded-lg px-2.5 py-2 text-left hover:bg-accent"
                      >
                        <span className="block truncate text-sm font-medium">{c.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">{c.detail}</span>
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={startNewGuest}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-medium text-primary hover:bg-accent"
                    >
                      <UserPlus className="h-4 w-4" aria-hidden />
                      Agregar «{guestTerm.trim()}» como invitado nuevo
                    </button>
                  </div>
                )}
                {!guestTerm.trim() && (
                  <button type="button" onClick={startNewGuest} className="mt-1.5 text-xs font-medium text-primary hover:underline">
                    O cargá un invitado nuevo
                  </button>
                )}
              </>
            )}
          </div>

          {/* Cuando */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <div>
              <label htmlFor={`${titleId}-date`} className={labelClass}>
                Día
              </label>
              <input id={`${titleId}-date`} type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-invalid={invalid("date")} className={inputClass} />
            </div>
            <div>
              <label htmlFor={`${titleId}-time`} className={labelClass}>
                Hora
              </label>
              <input
                id={`${titleId}-time`}
                type="time"
                step={300}
                value={time}
                onChange={(e) => setTime(e.target.value)}
                aria-invalid={invalid("time")}
                className={inputClass}
              />
            </div>
            <div className="col-span-2 sm:col-span-1">
              <label htmlFor={`${titleId}-duration`} className={labelClass}>
                Duración
              </label>
              <select
                id={`${titleId}-duration`}
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                aria-invalid={invalid("duration")}
                className={inputClass}
              >
                {[...new Set([...MANUAL_DURATIONS, duration])]
                  .sort((a, b) => a - b)
                  .map((d) => (
                    <option key={d} value={d}>
                      {d < 60 ? `${d} min` : d % 60 === 0 ? `${d / 60} h` : `${Math.floor(d / 60)} h ${d % 60} min`}
                    </option>
                  ))}
              </select>
            </div>
          </div>
          <p className="-mt-2 text-[11px] text-muted-foreground">Hora de {timezone.replace(/_/g, " ")}. Podés elegir cualquier horario.</p>

          {/* Sin evento: quien atiende y el area */}
          {!event && (
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <label htmlFor={`${titleId}-host`} className={labelClass}>
                  Atiende
                </label>
                <select id={`${titleId}-host`} value={hostUserId} onChange={(e) => setHostUserId(e.target.value)} className={inputClass}>
                  {hosts.map((h) => (
                    <option key={h.userId} value={h.userId}>
                      {h.userId === currentUserId ? `${h.label} (vos)` : h.label}
                    </option>
                  ))}
                </select>
              </div>
              {areas.length > 0 && (
                <div>
                  <label htmlFor={`${titleId}-area`} className={labelClass}>
                    Área
                  </label>
                  <select id={`${titleId}-area`} value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={inputClass}>
                    {areas.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          {/* Notas */}
          <div>
            <label htmlFor={`${titleId}-notes`} className={labelClass}>
              Notas (opcional, no las ve el invitado)
            </label>
            <textarea
              id={`${titleId}-notes`}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              aria-invalid={invalid("notes")}
              className={cn(inputClass, "h-auto py-2")}
            />
          </div>

          {error && (
            <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
              {error.message}
            </p>
          )}
          {/* Enter en cualquier campo agenda. */}
          <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
        </form>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button type="button" onClick={onClose} className="h-9 rounded-lg px-3 text-sm text-muted-foreground hover:bg-accent hover:text-foreground">
            Cancelar
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            Agendar
          </button>
        </div>
      </div>
    </div>
  );
}
