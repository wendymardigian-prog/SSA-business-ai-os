"use client";

/**
 * La pagina de la agenda del invitado (F27, F28): que quedo agendado, con
 * quien, cuando y donde, y los botones de agregar al calendario, reagendar y
 * cancelar.
 *
 * El link de Meet lo crea un job unos segundos despues, asi que si la agenda
 * es recien hecha la pagina pregunta por el hasta 8 segundos y despues muestra
 * un aviso en vez de dejar un hueco.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CalendarPlus, Check, Clock, MapPin, Video, X } from "lucide-react";
import type { PublicBooking } from "@/lib/scheduling/data/public-booking";
import { capitalize, formatDateTimeWithZone } from "@/lib/scheduling/booker/format";
import { cancelledByText } from "@/lib/scheduling/booking-page";

/** Cuanto se espera el link de Meet antes de avisar (F27). */
const MEET_WAIT_MS = 8000;
const POLL_MS = 1500;

export function BookingView({
  booking,
  justBooked,
  sendsGoogleInvite,
  calendarLinks,
  theme,
}: {
  booking: PublicBooking;
  justBooked: boolean;
  /** false cuando no hay calendario conectado: no hay invitación que prometer. */
  sendsGoogleInvite: boolean;
  calendarLinks: { google: string; outlook: string; ics: string };
  theme?: "light" | "dark";
}) {
  const router = useRouter();
  const [meetUrl, setMeetUrl] = useState(booking.meetUrl);
  const [waiting, setWaiting] = useState(justBooked && booking.locationType === "google_meet" && !booking.meetUrl);
  const [cancelling, setCancelling] = useState(false);
  const [askCancel, setAskCancel] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!waiting) return;
    const started = Date.now();
    let alive = true;
    const tick = async () => {
      if (!alive) return;
      try {
        const res = await fetch(`/api/public/scheduling/bookings/${encodeURIComponent(booking.uid)}/status`, { cache: "no-store" });
        if (res.ok) {
          const body = (await res.json()) as { meetUrl: string | null };
          if (body.meetUrl) {
            setMeetUrl(body.meetUrl);
            setWaiting(false);
            return;
          }
        }
      } catch {
        // Se sigue esperando: el aviso sale igual al final.
      }
      if (Date.now() - started > MEET_WAIT_MS) setWaiting(false);
      else if (alive) setTimeout(tick, POLL_MS);
    };
    const id = setTimeout(tick, POLL_MS);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [booking.uid, waiting]);

  async function cancel() {
    setCancelling(true);
    setError(null);
    try {
      const res = await fetch(`/api/public/scheduling/bookings/${encodeURIComponent(booking.uid)}/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() || null }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        setError(body.message ?? "No pude cancelar. Probá de nuevo.");
        setCancelling(false);
        return;
      }
      // El refresco vuelve a pedir la agenda al servidor; el formulario de
      // cancelar se cierra acá porque su estado es del cliente y sobrevive.
      setAskCancel(false);
      setCancelling(false);
      router.refresh();
    } catch {
      setError("No pude cancelar. Probá de nuevo.");
      setCancelling(false);
    }
  }

  const when = capitalize(formatDateTimeWithZone(booking.startUtc, booking.inviteeTimezone, booking.timeFormat));
  const cancelled = booking.actions.state === "cancelled";

  return (
    <div data-theme={theme} className="min-h-dvh bg-background px-4 py-8 text-foreground md:py-14">
      <div className="mx-auto w-full max-w-xl">
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-border bg-card p-6 text-center md:p-8">
        <span
          aria-hidden
          className={
            cancelled
              ? "grid h-12 w-12 place-items-center rounded-full bg-muted text-muted-foreground"
              : "grid h-12 w-12 place-items-center rounded-full bg-primary/15 text-primary"
          }
        >
          {cancelled ? <X className="h-6 w-6" /> : <Check className="h-6 w-6" />}
        </span>

        <h1 className="text-xl font-semibold tracking-tight">
          {cancelled ? "Esta reunión está cancelada" : justBooked ? "Tu reunión quedó agendada" : "Tu reunión"}
        </h1>

        {!cancelled && booking.bookerEmail && sendsGoogleInvite && (
          <p className="text-sm text-muted-foreground">
            Te llega la invitación de Google Calendar a <strong className="text-foreground">{booking.bookerEmail}</strong>.
          </p>
        )}
        {!cancelled && !sendsGoogleInvite && (
          <p className="text-sm text-muted-foreground">Agregala a tu calendario con los botones de abajo.</p>
        )}
        {cancelled && (
          <p className="text-sm text-muted-foreground">
            {cancelledByText({ cancelled_by_type: booking.cancelledByType }, booking.hostName)}
            {booking.cancellationReason ? ` Motivo: ${booking.cancellationReason}` : ""}
          </p>
        )}

        <dl className="grid w-full grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 rounded-xl border border-border p-4 text-left text-sm">
          <dt className="text-muted-foreground">Qué</dt>
          <dd>
            {booking.title} · {booking.durationMinutes} min
          </dd>
          <dt className="text-muted-foreground">Cuándo</dt>
          {/* `formatDateTimeWithZone` ya dice la zona: repetirla sonaba a error. */}
          <dd className={cancelled ? "tabular-nums line-through" : "tabular-nums"}>{when}</dd>
          <dt className="text-muted-foreground">Con</dt>
          <dd>{booking.hostName}</dd>
          <dt className="text-muted-foreground">Dónde</dt>
          <dd>
            {booking.locationType === "google_meet" ? (
              waiting ? (
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Clock className="h-4 w-4" aria-hidden /> Preparando el link de Meet…
                </span>
              ) : meetUrl ? (
                <a href={meetUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-primary underline">
                  <Video className="h-4 w-4" aria-hidden /> Entrar a Google Meet
                </a>
              ) : (
                <span className="text-muted-foreground">Google Meet · el link llega en la invitación</span>
              )
            ) : (
              <span className="flex items-center gap-1.5">
                <MapPin className="h-4 w-4" aria-hidden /> {booking.locationText || "A confirmar"}
              </span>
            )}
          </dd>
        </dl>

        {booking.actions.reason && !cancelled && <p className="text-sm text-muted-foreground">{booking.actions.reason}</p>}

        {error && (
          <p role="alert" className="w-full rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </p>
        )}

        {askCancel ? (
          <div className="w-full text-left">
            <label htmlFor="cancel-reason" className="text-sm font-medium">
              ¿Por qué cancelás? (opcional)
            </label>
            <textarea
              id="cancel-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-muted-foreground">Cancelar es definitivo: para volver a verse hay que agendar de nuevo.</p>
            <div className="mt-2 flex gap-2">
              <button type="button" onClick={() => setAskCancel(false)} className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted">
                Volver
              </button>
              <button
                type="button"
                onClick={cancel}
                disabled={cancelling}
                className="rounded-lg bg-destructive px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
              >
                {cancelling ? "Cancelando…" : "Sí, cancelar"}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap justify-center gap-2">
            {booking.actions.canAddToCalendar && (
              <>
                <a
                  href={calendarLinks.google}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
                >
                  <CalendarPlus className="h-4 w-4" aria-hidden /> Google
                </a>
                <a
                  href={calendarLinks.outlook}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
                >
                  Outlook
                </a>
                <a href={calendarLinks.ics} className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted">
                  Descargar .ics
                </a>
              </>
            )}
            {booking.actions.canReschedule && (
              <Link
                href={`/calendario/agenda/${encodeURIComponent(booking.uid)}/reagendar`}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
              >
                Cambiar la fecha
              </Link>
            )}
            {booking.actions.canCancel && (
              <button type="button" onClick={() => setAskCancel(true)} className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted">
                Cancelar
              </button>
            )}
            {cancelled && booking.username && (
              <Link
                href={`/calendario/${booking.username}/${booking.eventSlug}`}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
              >
                Agendar de nuevo
              </Link>
            )}
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
