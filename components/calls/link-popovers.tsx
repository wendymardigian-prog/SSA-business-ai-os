"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, ExternalLink, Link2, Loader2, X } from "lucide-react";
import { Popover } from "@/components/ui/popover";
import { useViewerTimezone } from "@/components/dashboard-chrome";
import {
  linkCallBooking,
  linkCallContact,
  searchContactsForCall,
  suggestBookingsForCall,
  type ContactOption,
} from "@/lib/actions/calls-link";
import { MATCH_LABELS, type BookingSuggestion } from "@/lib/calls/booking-suggestions";
import { formatCallDate } from "@/lib/calls/format";

const chip = "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs";

/** El contacto de la llamada: link a su ficha, o "Sin vincular" con el buscador. */
export function ContactLink({ callId, contact, canEdit }: { callId: string; contact: { id: string; name: string } | null; canEdit: boolean }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<ContactOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const searching = query.trim().length >= 2;
  useEffect(() => {
    if (!searching) return;
    let alive = true;
    const handle = setTimeout(async () => {
      const found = await searchContactsForCall(query);
      if (alive) setOptions(found);
    }, 250);
    return () => {
      alive = false;
      clearTimeout(handle);
    };
  }, [query, searching]);
  const shownOptions = searching ? options : [];

  function pick(contactId: string | null) {
    setError(null);
    start(async () => {
      const r = await linkCallContact({ callId, contactId });
      if (!r.ok) return setError(r.error);
      setQuery("");
      router.refresh();
    });
  }

  const trigger = contact ? (
    <span className="text-xs">Cambiar contacto</span>
  ) : (
    <span className={`${chip} border-dashed text-muted-foreground`}><Link2 className="h-3 w-3" aria-hidden /> Contacto: Sin vincular</span>
  );

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {contact && (
        <Link href={`/dashboard/contacts/${contact.id}`} className={`${chip} hover:bg-muted`} title="Abrir la ficha del contacto">
          <Link2 className="h-3 w-3" aria-hidden /> Contacto: {contact.name} <ExternalLink className="h-3 w-3" aria-hidden />
        </Link>
      )}
      {canEdit && (
        <Popover label={contact ? "Cambiar el contacto de la llamada" : "Vincular un contacto a la llamada"} trigger={trigger} align="start" panelClassName="w-80" triggerClassName={contact ? "rounded-md px-1 text-muted-foreground underline underline-offset-2 hover:text-foreground" : ""}>
          <div className="space-y-2 p-3">
            <label className="block text-xs font-medium">
              Buscar un contacto
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nombre o correo" autoComplete="off" className="mt-1 h-8 w-full rounded-lg border border-input bg-background px-2 text-sm" />
            </label>
            {pending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Guardando" />}
            {shownOptions.length === 0 && searching && <p className="text-xs text-muted-foreground">Sin resultados entre los contactos que ves.</p>}
            <ul className="max-h-48 overflow-y-auto">
              {shownOptions.map((o) => (
                <li key={o.id}>
                  <button type="button" disabled={pending} onClick={() => pick(o.id)} className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent">
                    <span className="block truncate">{o.name}</span>
                    {o.email && <span className="block truncate text-xs text-muted-foreground">{o.email}</span>}
                  </button>
                </li>
              ))}
            </ul>
            {contact && (
              <button type="button" disabled={pending} onClick={() => pick(null)} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                <X className="h-3 w-3" aria-hidden /> Desvincular el contacto
              </button>
            )}
            {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
          </div>
        </Popover>
      )}
    </span>
  );
}

/** La agenda de la llamada: la fecha, o "Sin vincular" con las sugerencias. */
export function BookingLink({ callId, booking, canEdit }: { callId: string; booking: { id: string; startAt: string } | null; canEdit: boolean }) {
  const router = useRouter();
  const timeZone = useViewerTimezone();
  const [suggestions, setSuggestions] = useState<BookingSuggestion[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  async function load() {
    if (suggestions || loading) return;
    setLoading(true);
    setSuggestions(await suggestBookingsForCall({ callId, timeZone }));
    setLoading(false);
  }

  function pick(bookingId: string | null) {
    setMessage(null);
    start(async () => {
      const r = await linkCallBooking({ callId, bookingId });
      if (!r.ok) return setMessage({ ok: false, text: r.error });
      if (r.warning) setMessage({ ok: true, text: r.warning });
      router.refresh();
    });
  }

  const trigger = booking ? (
    <span className="text-xs">Cambiar agenda</span>
  ) : (
    <span className={`${chip} border-dashed text-muted-foreground`}><CalendarDays className="h-3 w-3" aria-hidden /> Agenda: Sin vincular</span>
  );

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {booking && (
        <Link href={`/dashboard/agenda?agenda=${booking.id}`} className={`${chip} hover:bg-muted`} title="Abrir la agenda">
          <CalendarDays className="h-3 w-3" aria-hidden /> Agenda: {formatCallDate(booking.startAt, timeZone, "long")} <ExternalLink className="h-3 w-3" aria-hidden />
        </Link>
      )}
      {canEdit && (
        <span onClick={() => void load()} onFocus={() => void load()}>
          <Popover label={booking ? "Cambiar la agenda de la llamada" : "Vincular una agenda a la llamada"} trigger={trigger} align="start" panelClassName="w-96" triggerClassName={booking ? "rounded-md px-1 text-muted-foreground underline underline-offset-2 hover:text-foreground" : ""}>
            <div className="space-y-2 p-3">
              <p className="text-xs font-medium">Agendas sugeridas</p>
              {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Buscando" />}
              {suggestions && suggestions.length === 0 && <p className="text-xs text-muted-foreground">No encontramos agendas cerca de esta llamada.</p>}
              <ul className="max-h-60 space-y-1 overflow-y-auto">
                {(suggestions ?? []).map((s) => (
                  <li key={s.id}>
                    <button type="button" disabled={pending} onClick={() => pick(s.id)} className="block w-full rounded px-2 py-1.5 text-left hover:bg-accent">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm">{formatCallDate(s.start_at, timeZone, "long")}</span>
                        <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px]">{MATCH_LABELS[s.match]}</span>
                      </span>
                      <span className="block truncate text-[11px] text-muted-foreground">{[s.full_name, s.email].filter(Boolean).join(" · ")}</span>
                      <span className="block text-[11px] text-muted-foreground">{s.reason}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {booking && (
                <button type="button" disabled={pending} onClick={() => pick(null)} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                  <X className="h-3 w-3" aria-hidden /> Desvincular la agenda
                </button>
              )}
              {message && <p role={message.ok ? "status" : "alert"} className={`text-xs ${message.ok ? "text-amber-700 dark:text-amber-300" : "text-destructive"}`}>{message.text}</p>}
            </div>
          </Popover>
        </span>
      )}
    </span>
  );
}
