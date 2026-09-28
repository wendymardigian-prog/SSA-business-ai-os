"use client";

/**
 * Agendar a mano (F37): cinco pasos, evento → contacto → horario →
 * formulario → confirmar.
 *
 * Los horarios salen de la MISMA consulta que la página pública, así el
 * equipo no puede agendar en un hueco que el invitado no vería. La única
 * diferencia es el interruptor de "ignorar el aviso mínimo", que es para
 * cuando alguien llama y quiere hablar ahora.
 */

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import type { BookingField, SlotsByDate, Slot } from "@/lib/scheduling/types";
import { buildBookingSchema, visibleFields } from "@/lib/scheduling/booking-fields";
import { capitalize, formatDateLong, formatSlotLabel } from "@/lib/scheduling/booker/format";
import { countryFromTimezone, PHONE_COUNTRIES } from "@/lib/scheduling/phone-countries";
import { dateInTz } from "@/lib/scheduling/time/tz";
import { bookManually } from "@/lib/actions/scheduling/bookings";

const STEPS = ["Evento", "Contacto", "Horario", "Formulario", "Confirmar"];

export interface ManualEventOption {
  id: string;
  title: string;
  durationMinutes: number;
  areaName: string | null;
  categoryLabel: string;
  hostName: string;
  hidden: boolean;
  fields: BookingField[];
  color: string | null;
}

export interface ManualContactOption {
  id: string;
  name: string;
  detail: string;
  timezone: string | null;
}

const inputClass = "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm";

export function BookManualDialog({
  events,
  timezone,
  timeFormat,
  onClose,
  searchContacts,
  loadSlots,
}: {
  events: ManualEventOption[];
  timezone: string;
  timeFormat: "12h" | "24h";
  onClose: () => void;
  searchContacts: (term: string) => Promise<ManualContactOption[]>;
  loadSlots: (eventId: string, from: string, to: string, ignoreMinimumNotice: boolean) => Promise<SlotsByDate>;
}) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [eventId, setEventId] = useState<string | null>(events[0]?.id ?? null);
  const [term, setTerm] = useState("");
  const [contacts, setContacts] = useState<ManualContactOption[]>([]);
  const [contactId, setContactId] = useState<string | null>(null);
  const [ignoreNotice, setIgnoreNotice] = useState(false);
  const [slots, setSlots] = useState<SlotsByDate>({});
  const [loading, setLoading] = useState(false);
  const [day, setDay] = useState<string | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const event = events.find((e) => e.id === eventId) ?? null;
  const contact = contacts.find((c) => c.id === contactId) ?? null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Los contactos se buscan mientras se escribe, con una pausa para no
  // disparar una consulta por tecla.
  useEffect(() => {
    if (step !== 2) return;
    const id = setTimeout(async () => setContacts(await searchContacts(term)), 250);
    return () => clearTimeout(id);
  }, [searchContacts, step, term]);

  useEffect(() => {
    if (step !== 3 || !eventId) return;
    // `alive` evita escribir estado de una consulta que ya no interesa (se
    // cambió de evento o se cerró el modal mientras respondía).
    let alive = true;
    const today = dateInTz(new Date(), timezone);
    const from = new Date(`${today}T00:00:00.000Z`).toISOString();
    const to = new Date(new Date(from).getTime() + 35 * 24 * 60 * 60 * 1000).toISOString();
    const id = setTimeout(async () => {
      if (!alive) return;
      setLoading(true);
      const result = await loadSlots(eventId, from, to, ignoreNotice);
      if (!alive) return;
      setSlots(result);
      setLoading(false);
    }, 0);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [eventId, ignoreNotice, loadSlots, step, timezone]);

  const days = Object.keys(slots).sort();

  function submit() {
    if (!event || !slot) return;
    setError(null);
    const schema = buildBookingSchema(event.fields, { defaultCountry: countryFromTimezone(timezone) ?? "CR" });
    const parsed = schema.safeParse(values);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Revisá el formulario.");
      setStep(4);
      return;
    }
    start(async () => {
      const result = await bookManually({
        eventTypeId: event.id,
        startUtc: slot.startUtc,
        timezone,
        responses: values,
        contactId,
        ignoreMinimumNotice: ignoreNotice,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
      onClose();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 md:items-center md:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Agendar"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92dvh] w-full max-w-2xl flex-col rounded-t-2xl border border-border bg-card md:rounded-2xl"
      >
        <header className="flex items-center gap-2 border-b border-border p-4">
          <h2 className="text-base font-semibold">Agendar</h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="ml-auto rounded-lg p-1.5 text-muted-foreground hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </header>

        <ol className="flex flex-wrap gap-2 border-b border-border px-4 py-2 text-xs">
          {STEPS.map((label, i) => (
            <li key={label} className={i + 1 === step ? "font-medium text-foreground" : "text-muted-foreground"}>
              <span className="tabular-nums">{i + 1 < step ? "✓" : i + 1}</span> {label}
            </li>
          ))}
        </ol>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4 text-sm">
          {error && (
            <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-destructive">
              {error}
            </p>
          )}

          {step === 1 && (
            <>
              <p className="font-medium">¿Qué tipo de llamada?</p>
              {events.length === 0 && <p className="text-muted-foreground">No hay eventos activos. Creá uno desde la configuración.</p>}
              <div className="flex flex-col gap-1.5">
                {events.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    aria-pressed={eventId === e.id}
                    onClick={() => setEventId(e.id)}
                    className={
                      eventId === e.id
                        ? "flex items-center gap-2 rounded-lg border border-primary bg-primary/5 p-2.5 text-left"
                        : "flex items-center gap-2 rounded-lg border border-border p-2.5 text-left hover:bg-muted"
                    }
                  >
                    <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: e.color ?? "var(--primary)" }} />
                    <span className="min-w-0">
                      <span className="block font-medium">{e.title}</span>
                      <span className="block text-xs text-muted-foreground">
                        {e.durationMinutes} min · {e.categoryLabel} · con {e.hostName}
                        {e.hidden ? " · oculto (solo link directo)" : ""}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <p className="font-medium">¿Para quién es?</p>
              <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Buscar por nombre, email o teléfono" className={inputClass} />
              <div className="flex flex-col gap-1.5">
                {contacts.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={contactId === c.id}
                    onClick={() => setContactId(c.id)}
                    className={
                      contactId === c.id
                        ? "rounded-lg border border-primary bg-primary/5 p-2.5 text-left"
                        : "rounded-lg border border-border p-2.5 text-left hover:bg-muted"
                    }
                  >
                    <span className="block font-medium">{c.name}</span>
                    <span className="block text-xs text-muted-foreground">{c.detail}</span>
                  </button>
                ))}
              </div>
              <button type="button" onClick={() => setContactId(null)} className="self-start text-xs text-primary underline">
                {contactId ? "Quitar la selección y crear uno nuevo con el formulario" : "Se va a crear un contacto con lo que pongas en el formulario"}
              </button>
              <p className="text-xs text-muted-foreground">
                Si el email o el teléfono ya existen, se vincula al contacto existente en lugar de crear otro.
              </p>
            </>
          )}

          {step === 3 && (
            <>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input type="checkbox" checked={ignoreNotice} onChange={(e) => setIgnoreNotice(e.target.checked)} className="h-4 w-4" />
                Ignorar el aviso mínimo (solo para el equipo)
              </label>
              {loading && <p className="text-muted-foreground">Buscando horarios…</p>}
              {!loading && days.length === 0 && <p className="text-muted-foreground">No hay horarios libres en los próximos 35 días.</p>}
              <div className="grid gap-3 md:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  {days.map((d) => (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={day === d}
                      onClick={() => {
                        setDay(d);
                        setSlot(null);
                      }}
                      className={day === d ? "rounded-lg bg-primary px-3 py-1.5 text-left text-sm text-primary-foreground" : "rounded-lg border border-border px-3 py-1.5 text-left text-sm hover:bg-muted"}
                    >
                      {capitalize(formatDateLong(`${d}T12:00:00.000Z`, "UTC"))} · {slots[d].length}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(day ? slots[day] ?? [] : []).map((s) => (
                    <button
                      key={s.startUtc}
                      type="button"
                      aria-pressed={slot?.startUtc === s.startUtc}
                      onClick={() => setSlot(s)}
                      className={
                        slot?.startUtc === s.startUtc
                          ? "rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground"
                          : "rounded-lg border border-border px-3 py-1.5 text-sm tabular-nums hover:bg-muted"
                      }
                    >
                      {formatSlotLabel(s.startUtc, timezone, timeFormat)}
                    </button>
                  ))}
                </div>
              </div>
              {contact?.timezone && contact.timezone !== timezone && (
                <p className="text-xs text-muted-foreground">
                  {contact.name.split(" ")[0]} está en {contact.timezone.replace(/_/g, " ")}: le llega en su hora.
                </p>
              )}
            </>
          )}

          {step === 4 && event && (
            <>
              <p className="font-medium">
                Formulario del evento <span className="text-xs font-normal text-muted-foreground">· lo que falte se pregunta después</span>
              </p>
              {visibleFields(event.fields).map((f) => (
                <div key={f.identifier} className="flex flex-col gap-1">
                  <label htmlFor={`m-${f.identifier}`} className="text-xs font-medium">
                    {f.label}
                    {f.visibility === "required" && <span aria-hidden className="text-destructive"> *</span>}
                  </label>
                  {f.type === "long_text" ? (
                    <textarea
                      id={`m-${f.identifier}`}
                      rows={3}
                      value={String(values[f.identifier] ?? "")}
                      onChange={(e) => setValues((v) => ({ ...v, [f.identifier]: e.target.value }))}
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                    />
                  ) : f.type === "select" ? (
                    <select
                      id={`m-${f.identifier}`}
                      value={String(values[f.identifier] ?? "")}
                      onChange={(e) => setValues((v) => ({ ...v, [f.identifier]: e.target.value }))}
                      className={inputClass}
                    >
                      <option value="">Elegí una opción</option>
                      {(f.options ?? []).map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  ) : f.type === "phone" ? (
                    <div className="flex gap-2">
                      <select
                        aria-label="País"
                        value={(values[f.identifier] as { country?: string })?.country ?? countryFromTimezone(timezone) ?? "CR"}
                        onChange={(e) =>
                          setValues((v) => ({ ...v, [f.identifier]: { ...(v[f.identifier] as object), country: e.target.value } }))
                        }
                        className="w-32 shrink-0 rounded-lg border border-input bg-background px-2 text-sm"
                      >
                        {PHONE_COUNTRIES.map((c) => (
                          <option key={c.code} value={c.code}>
                            {c.label} +{c.dial}
                          </option>
                        ))}
                      </select>
                      <input
                        id={`m-${f.identifier}`}
                        type="tel"
                        value={(values[f.identifier] as { number?: string })?.number ?? ""}
                        onChange={(e) => setValues((v) => ({ ...v, [f.identifier]: { ...(v[f.identifier] as object), number: e.target.value } }))}
                        className={inputClass}
                      />
                    </div>
                  ) : (
                    <input
                      id={`m-${f.identifier}`}
                      type={f.type === "email" ? "email" : "text"}
                      value={String(values[f.identifier] ?? "")}
                      onChange={(e) => setValues((v) => ({ ...v, [f.identifier]: e.target.value }))}
                      className={inputClass}
                    />
                  )}
                </div>
              ))}
            </>
          )}

          {step === 5 && event && slot && (
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2">
              <dt className="text-muted-foreground">Evento</dt>
              <dd>
                {event.title} · {event.durationMinutes} min · {event.categoryLabel}
              </dd>
              <dt className="text-muted-foreground">Contacto</dt>
              <dd>{contact ? contact.name : "Se crea con los datos del formulario"}</dd>
              <dt className="text-muted-foreground">Cuándo</dt>
              <dd className="tabular-nums">
                {capitalize(formatDateLong(slot.startUtc, timezone))} · {formatSlotLabel(slot.startUtc, timezone, timeFormat)}
              </dd>
              <dt className="text-muted-foreground">Anfitrión</dt>
              <dd>{event.hostName}</dd>
            </dl>
          )}
        </div>

        <footer className="flex items-center gap-2 border-t border-border p-4">
          {step > 1 && (
            <button type="button" onClick={() => setStep(step - 1)} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted">
              Atrás
            </button>
          )}
          <span className="flex-1" />
          {step < 5 ? (
            <button
              type="button"
              disabled={(step === 1 && !eventId) || (step === 3 && !slot)}
              onClick={() => setStep(step + 1)}
              className="rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              Siguiente
            </button>
          ) : (
            <button
              type="button"
              disabled={pending}
              onClick={submit}
              className="rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {pending ? "Agendando…" : "Agendar"}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
