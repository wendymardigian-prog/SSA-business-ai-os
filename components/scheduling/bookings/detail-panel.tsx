"use client";

/**
 * El detalle de una agenda (F36): un panel lateral con el estado, las
 * acciones del anfitrión, las respuestas del formulario, las notas internas
 * y el historial.
 *
 * El estado se cambia desde acá con el menú: es el camino que no depende de
 * arrastrar nada. Los estados que todavía no se pueden usar aparecen
 * deshabilitados con el motivo, en vez de esconderse.
 */

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import type { BookingStatus } from "@/lib/scheduling/types";
import { BOOKING_STATUSES, evaluateTransition, groupOf, statusDef, TRANSITION_REASON_TEXT } from "@/lib/scheduling/booking-status";
import { needsOutcome } from "@/lib/scheduling/bookings-view";
import { capitalize, formatDateTimeWithZone } from "@/lib/scheduling/booker/format";
import { categoryTree, type CategoryRow } from "@/lib/scheduling/categories";
import { changeBookingStatus, cancelBookingAsHost, fixBookingCategory, retryBookingSync, updateBookingDetails } from "@/lib/actions/scheduling/bookings";
import { StatusChip, statusDotClass } from "./status-chip";

export interface BookingDetailData {
  id: string;
  uid: string;
  title: string;
  startAt: string;
  endAt: string;
  status: BookingStatus;
  hostName: string;
  hostTimezone: string;
  inviteeTimezone: string;
  contactId: string;
  contactName: string | null;
  bookerEmail: string | null;
  bookerPhone: string | null;
  responses: Array<{ label: string; value: string }>;
  internalNotes: string | null;
  locationType: string | null;
  locationText: string | null;
  meetUrl: string | null;
  origin: string;
  categoryId: string | null;
  categoryLabel: string;
  syncStatus: string;
  syncError: string | null;
  rescheduleUrl: string;
  history: Array<{ id: string; text: string; at: string }>;
}

const OUTCOME_SHORTCUTS: BookingStatus[] = ["no_show", "followup_warm", "followup_cold", "sale", "not_qualified"];

export function BookingDetailPanel({
  booking,
  categories,
  timezone,
  timeFormat,
  canManage,
  onClose,
}: {
  booking: BookingDetailData;
  categories: CategoryRow[];
  timezone: string;
  timeFormat: "12h" | "24h";
  canManage: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [cancelFor, setCancelFor] = useState<BookingStatus | null>(null);
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState(booking.internalNotes ?? "");
  const [location, setLocation] = useState(booking.locationText ?? "");
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const now = new Date();
  const group = groupOf(booking.status);
  const pendingOutcome = needsOutcome({ status: booking.status, end_at: booking.endAt }, now);

  function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>, done: string) {
    setError(null);
    start(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setToast(done);
      setMenuOpen(false);
      setCancelFor(null);
      router.refresh();
    });
  }

  const setStatus = (status: BookingStatus) => {
    if (groupOf(status) === "cancelled") {
      setCancelFor(status);
      setMenuOpen(false);
      return;
    }
    run(() => changeBookingStatus({ bookingId: booking.id, status }), `Quedó ${statusDef(status).label.toLowerCase()}`);
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} aria-hidden />
      <aside role="dialog" aria-label="Detalle de la agenda" className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border bg-card shadow-xl">
        <header className="flex items-start gap-2 border-b border-border p-4">
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{booking.contactName || "Sin nombre"}</p>
            <p className="truncate text-xs text-muted-foreground">{booking.title}</p>
          </div>
          <div className="relative">
            <button
              type="button"
              disabled={!canManage || group === "cancelled"}
              title={group === "cancelled" ? "Una cancelación es final" : undefined}
              onClick={() => setMenuOpen((v) => !v)}
              aria-expanded={menuOpen}
              className="rounded-lg border border-border px-2 py-1 disabled:opacity-60"
            >
              <StatusChip status={booking.status} />
            </button>
            {menuOpen && (
              <div className="absolute right-0 z-10 mt-1 w-64 rounded-lg border border-border bg-popover p-1 shadow-lg">
                {BOOKING_STATUSES.map((def) => {
                  const verdict = evaluateTransition(booking.status, def.key, { start_at: booking.startAt }, now);
                  const disabled = !verdict.ok;
                  return (
                    <button
                      key={def.key}
                      type="button"
                      disabled={disabled}
                      title={disabled && verdict.reason ? TRANSITION_REASON_TEXT[verdict.reason] : undefined}
                      onClick={() => setStatus(def.key)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent"
                    >
                      <span aria-hidden className={`h-2 w-2 rounded-full ${statusDotClass(def.key)}`} />
                      {def.label}
                      {def.key === booking.status && <span className="ml-auto text-xs text-muted-foreground">actual</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 text-sm">
          {error && (
            <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-destructive">
              {error}
            </p>
          )}
          {toast && <p className="rounded-lg border border-border bg-muted p-3 text-muted-foreground">{toast}</p>}

          {cancelFor && (
            <div className="rounded-lg border border-border p-3">
              <p className="font-medium">Cancelar: {statusDef(cancelFor).label}</p>
              <label htmlFor="cancel-reason" className="mt-2 block text-xs text-muted-foreground">
                Motivo (opcional, queda en el historial)
              </label>
              <textarea
                id="cancel-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
              />
              <p className="mt-1 text-xs text-muted-foreground">Cancelar es definitivo. El evento se borra del calendario y Google avisa al invitado.</p>
              <div className="mt-2 flex gap-2">
                <button type="button" onClick={() => setCancelFor(null)} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted">
                  Volver
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => cancelBookingAsHost({ bookingId: booking.id, status: cancelFor, reason }), "Agenda cancelada")}
                  className="rounded-lg bg-destructive px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {pending ? "Cancelando…" : "Sí, cancelar"}
                </button>
              </div>
            </div>
          )}

          {pendingOutcome && canManage && !cancelFor && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
              <p className="font-medium">La llamada ya pasó. ¿Cómo resultó?</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {OUTCOME_SHORTCUTS.map((key) => (
                  <button
                    key={key}
                    type="button"
                    disabled={pending}
                    onClick={() => setStatus(key)}
                    className="rounded-lg border border-border bg-card px-2.5 py-1 text-xs hover:bg-muted disabled:opacity-60"
                  >
                    {statusDef(key).label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2">
            <dt className="text-muted-foreground">Cuándo</dt>
            <dd>
              <span className="tabular-nums">{capitalize(formatDateTimeWithZone(booking.startAt, timezone, timeFormat))}</span>
              <span className="block text-xs text-muted-foreground">Hora del invitado: {formatDateTimeWithZone(booking.startAt, booking.inviteeTimezone, timeFormat)}</span>
            </dd>
            <dt className="text-muted-foreground">Categoría</dt>
            <dd className="flex flex-wrap items-center gap-2">
              {booking.categoryLabel || "—"}
              {canManage && (
                <select
                  aria-label="Corregir la categoría"
                  defaultValue=""
                  disabled={pending}
                  onChange={(e) => e.target.value && run(() => fixBookingCategory({ bookingId: booking.id, categoryId: e.target.value }), "Categoría corregida")}
                  className="rounded-md border border-input bg-background px-1.5 py-0.5 text-xs"
                >
                  <option value="">Corregir…</option>
                  {categoryTree(categories).map(({ area, types }) => (
                    <optgroup key={area.id} label={area.name}>
                      <option value={area.id}>{area.name} (solo el área)</option>
                      {types.map((type) => (
                        <option key={type.id} value={type.id}>
                          {type.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              )}
            </dd>
            <dt className="text-muted-foreground">Anfitrión</dt>
            <dd>{booking.hostName}</dd>
            <dt className="text-muted-foreground">Dónde</dt>
            <dd>
              {booking.locationType === "google_meet" ? (
                booking.meetUrl ? (
                  <a href={booking.meetUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline">
                    Google Meet
                  </a>
                ) : (
                  "Google Meet (todavía sin link)"
                )
              ) : (
                booking.locationText || "A confirmar"
              )}
            </dd>
            <dt className="text-muted-foreground">Origen</dt>
            <dd>{booking.origin}</dd>
            <dt className="text-muted-foreground">Google Calendar</dt>
            <dd>
              {booking.syncStatus === "synced" && "Sincronizado"}
              {booking.syncStatus === "pending" && "Sincronizando…"}
              {booking.syncStatus === "not_applicable" && "Sin calendario conectado"}
              {booking.syncStatus === "failed" && (
                <span className="flex flex-col gap-1">
                  <span className="text-destructive">No se pudo sincronizar{booking.syncError ? `: ${booking.syncError}` : ""}</span>
                  {canManage && (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => run(() => retryBookingSync({ bookingId: booking.id }), "Lo vuelvo a intentar")}
                      className="self-start rounded-lg border border-border px-2 py-1 text-xs hover:bg-muted"
                    >
                      Reintentar sincronización
                    </button>
                  )}
                </span>
              )}
            </dd>
          </dl>

          <div className="flex flex-wrap gap-2">
            <Link href={`/dashboard/contacts/${booking.contactId}`} className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-muted">
              Ver contacto
            </Link>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(booking.rescheduleUrl);
                setToast("Link para reagendar copiado");
              }}
              className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-muted"
            >
              Copiar link de reagendar
            </button>
            {booking.meetUrl && (
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(booking.meetUrl!);
                  setToast("Link de Meet copiado");
                }}
                className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-muted"
              >
                Copiar Meet
              </button>
            )}
          </div>

          {booking.responses.length > 0 && (
            <section className="rounded-lg border border-border p-3">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Respuestas del formulario</h3>
              <dl className="flex flex-col gap-1.5">
                {booking.responses.map((r) => (
                  <div key={r.label}>
                    <dt className="text-xs font-medium">{r.label}</dt>
                    <dd className="text-muted-foreground">{r.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          {canManage && (
            <section className="rounded-lg border border-border p-3">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Ubicación y notas</h3>
              {booking.locationType !== "google_meet" && (
                <>
                  <label htmlFor="bk-location" className="text-xs text-muted-foreground">
                    Dónde
                  </label>
                  <input
                    id="bk-location"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    className="mb-2 mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                  />
                </>
              )}
              <label htmlFor="bk-notes" className="text-xs text-muted-foreground">
                Notas internas (solo las ve el equipo)
              </label>
              <textarea
                id="bk-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
              />
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  run(
                    () =>
                      updateBookingDetails({
                        bookingId: booking.id,
                        internalNotes: notes,
                        ...(booking.locationType !== "google_meet" ? { locationText: location } : {}),
                      }),
                    "Guardado",
                  )
                }
                className="mt-2 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-60"
              >
                Guardar
              </button>
            </section>
          )}

          <section className="rounded-lg border border-border p-3">
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Historial</h3>
            <ul className="flex flex-col gap-1.5 text-xs text-muted-foreground">
              {booking.history.length === 0 && <li>Todavía no hay nada.</li>}
              {booking.history.map((h) => (
                <li key={h.id}>
                  <span className="tabular-nums">{formatDateTimeWithZone(h.at, timezone, timeFormat)}</span> · {h.text}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </aside>
    </>
  );
}
