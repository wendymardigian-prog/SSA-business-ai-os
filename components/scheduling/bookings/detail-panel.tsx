"use client";

/**
 * El detalle de una agenda (F36): un panel lateral con el estado, las
 * acciones del anfitrión, las respuestas de la reserva, las notas internas
 * y el historial.
 *
 * El estado se cambia desde acá con el menú: es el camino que no depende de
 * arrastrar nada. Los estados que todavía no se pueden usar aparecen
 * deshabilitados con el motivo, en vez de esconderse.
 */

import { EntryUrlBlock } from "@/components/attribution/entry-url-block";
import { MetaMatchControl } from "@/components/attribution/meta-match-control";
import { attributionSections, bestEntryUrl } from "@/lib/attribution/attribution-view";
import type { MetaLink } from "@/lib/attribution/meta-link";
import { Fragment, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, Mail, MessageCircle, Video, X } from "lucide-react";
import { Tip } from "@/components/ui/tooltip";
import { AutoTextarea } from "@/components/ui/auto-textarea";
import { useAutosave, type AutosaveStatus } from "./use-autosave";
import { PortalMenu, PortalMenuItem, PortalMenuLabel } from "@/components/ui/portal-menu";
import { getDmLink } from "@/lib/contacts/links";
import type { BookingAnswer } from "@/lib/scheduling/booking-detail-view";
import type { BookingStatus } from "@/lib/scheduling/types";
import { BOOKING_STATUSES, evaluateTransition, groupOf, isActive, statusDef, TRANSITION_REASON_TEXT } from "@/lib/scheduling/booking-status";
import { needsOutcome } from "@/lib/scheduling/bookings-view";
import { capitalize, formatDateTimeWithZone } from "@/lib/scheduling/booker/format";
import { categoryTree, type CategoryRow } from "@/lib/scheduling/categories";
import { meetJoinHref, waitingForMeet } from "@/lib/scheduling/meet-link";
import { changeBookingStatus, cancelBookingAsHost, fixBookingCategory, getBookingMeetState, occupyBookingSlotAsHost, reassignBookingHostAsHost, releaseBookingSlotAsHost, retryBookingSync, updateBookingDetails } from "@/lib/actions/scheduling/bookings";
import { StatusChip, SlotReleasedChip, statusDotClass } from "./status-chip";
import { CallSectionList } from "@/components/calls/call-section-list"; // @plantilla-quitar(llamadas)
import type { CallSectionRow } from "@/lib/calls/contact-section"; // @plantilla-quitar(llamadas)
import { SaleWizard } from "@/components/sales/wizard/sale-wizard"; // @plantilla-quitar(ventas)
import type { WizardConfig, WizardInitial } from "@/components/sales/wizard/types"; // @plantilla-quitar(ventas)
import { StatusChip as SaleStatusChip } from "@/components/sales/sales-list"; // @plantilla-quitar(ventas)
import { formatMoney } from "@/lib/shared/format";

export interface BookingDetailData {
  id: string;
  uid: string;
  title: string;
  startAt: string;
  endAt: string;
  status: BookingStatus;
  hostUserId: string;
  hostName: string;
  hostTimezone: string;
  inviteeTimezone: string;
  contactId: string;
  contactName: string | null;
  bookerEmail: string | null;
  bookerPhone: string | null;
  responses: BookingAnswer[];
  /** El chat de WhatsApp de este contacto en la bandeja (el más reciente), si hay uno y quien mira puede verlo. */
  whatsappConversationId: string | null;
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
  /** De dónde vino el lead que agendó: solo texto. Vacía si se agendó a mano o por el agente. */
  attribution: Record<string, string>;
  /** El vínculo con Meta de su toque o, si no tiene, de un toque anterior del contacto. */
  metaLink: MetaLink | null;
  /** Agenda v2: su horario dejó de contar como ocupado. null = nunca se liberó. */
  slotReleasedAt: string | null;
  /** Las llamadas vinculadas a esta agenda que quien mira puede ver (vacio si no tiene `calls.view` o no hay ninguna). */ // @plantilla-quitar(llamadas)
  calls: CallSectionRow[]; // @plantilla-quitar(llamadas)
  /** Las ventas que nacieron de esta agenda y que quien mira puede ver (vacío sin `sales.view`). */ // @plantilla-quitar(ventas)
  sales: Array<{ id: string; status: string; finalAmount: number; product: string }>; // @plantilla-quitar(ventas)
  /** «Cargar venta»: solo con `sales.manage`, reunión pasada y con resultado. El asistente abre con el contacto y la agenda resueltos. */ // @plantilla-quitar(ventas)
  saleLoad: { config: WizardConfig; initial: WizardInitial } | null; // @plantilla-quitar(ventas)
}

/**
 * El panel mientras llega el detalle (se pide aparte, `loadBookingDetail`): se
 * abre en el momento con el mismo marco, así el clic responde enseguida.
 */
export function BookingDetailSkeleton({ missing, onClose }: { missing: boolean; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} aria-hidden />
      <aside role="dialog" aria-label="Detalle de la agenda" aria-busy={!missing} className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border bg-card shadow-xl">
        <header className="flex items-start gap-2 border-b border-border p-4">
          <div className="min-w-0 flex-1 space-y-2">
            {missing ? <p className="font-semibold">No encontré esa agenda</p> : <div className="h-4 w-40 animate-pulse rounded bg-muted" />}
            {!missing && <div className="h-3 w-56 animate-pulse rounded bg-muted" />}
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="flex flex-col gap-3 p-4">
          {missing ? (
            <p className="text-sm text-muted-foreground">Puede que se haya borrado o que no tengas acceso a ella.</p>
          ) : (
            Array.from({ length: 6 }, (_, i) => <div key={i} className="h-4 animate-pulse rounded bg-muted" style={{ width: `${90 - i * 8}%` }} />)
          )}
        </div>
      </aside>
    </>
  );
}

/** El boton cuadrado de iconos de las respuestas (WhatsApp, email). */
const ICON_BUTTON = "inline-grid h-6 w-6 shrink-0 place-items-center rounded-md border border-border text-primary-ink hover:bg-accent";
/** Un valor que se toca para elegir otro (categoria, anfitrion): se lee como texto, con una flechita. */
const VALUE_TRIGGER = "-mx-1.5 max-w-full gap-1 px-1.5 py-0.5 text-left hover:bg-muted";

/**
 * Lo que se puede hacer con una respuesta de teléfono o de email: ir al chat de WhatsApp de esa persona (en la misma
 * app, si ya hay uno) o escribirle un email. Se decide por el TIPO de la pregunta, nunca por cómo se ve el texto.
 */
function AnswerActions({ answer, whatsappConversationId }: { answer: BookingAnswer; whatsappConversationId: string | null }) {
  if (answer.kind === "email") {
    if (!/^[^\s@]+@[^\s@]+$/.test(answer.value.trim())) return null;
    return (
      <Tip content="Abre tu programa de correo para escribirle a este email.">
        <a href={`mailto:${answer.value.trim()}`} aria-label={`Escribir un email a ${answer.value}`} className={ICON_BUTTON}>
          <Mail className="h-3.5 w-3.5" aria-hidden />
        </a>
      </Tip>
    );
  }
  if (answer.kind === "phone") {
    // El chat de la bandeja es del contacto: solo corresponde al teléfono propio del invitado, no a otro número que escribió.
    if (answer.own && whatsappConversationId) {
      return (
        <Tip content="Abre en la bandeja el chat de WhatsApp con este contacto.">
          <Link href={`/dashboard/inbox?c=${whatsappConversationId}`} aria-label="Abrir el chat de WhatsApp" className={ICON_BUTTON}>
            <MessageCircle className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </Tip>
      );
    }
    const url = getDmLink("whatsapp", answer.value).url;
    if (!url || answer.value.replace(/\D/g, "").length < 7) return null;
    return (
      <Tip content={answer.own ? "Todavía no hay un chat de WhatsApp con este contacto en el sistema. Abre WhatsApp con este número en otra pestaña." : "Abre WhatsApp con este número en otra pestaña."}>
        <a href={url} target="_blank" rel="noopener noreferrer" aria-label="Abrir WhatsApp con este número" className={ICON_BUTTON}>
          <MessageCircle className="h-3.5 w-3.5" aria-hidden />
        </a>
      </Tip>
    );
  }
  return null;
}

/** El texto que reemplaza al botón de guardar: dice qué pasa con lo que se escribió. */
function AutosaveNote({ status, error, onRetry }: { status: AutosaveStatus; error: string | null; onRetry: () => void }) {
  return (
    <p role="status" aria-live="polite" className={`mt-1.5 min-h-4 text-xs ${status === "error" ? "text-destructive" : "text-muted-foreground"}`}>
      {status === "idle" && "Se guarda solo mientras escribís."}
      {(status === "pending" || status === "saving") && "Guardando…"}
      {status === "saved" && "Guardado automáticamente"}
      {status === "error" && (
        <>
          {error ?? "No se pudo guardar."}{" "}
          <button type="button" onClick={onRetry} className="underline">
            Reintentar
          </button>
        </>
      )}
    </p>
  );
}

const OUTCOME_SHORTCUTS: BookingStatus[] = ["no_show", "followup_warm", "followup_cold", "sale", "not_qualified"];

export function BookingDetailPanel({
  booking,
  categories,
  timezone,
  timeFormat,
  canManage,
  canLinkMeta,
  canReassign,
  hostOptions,
  onClose,
}: {
  booking: BookingDetailData;
  categories: CategoryRow[];
  timezone: string;
  timeFormat: "12h" | "24h";
  canManage: boolean;
  /** `settings.general`: vincular, ignorar o quitar el vínculo con Meta. */
  canLinkMeta: boolean;
  /** Owner/Admin con alcance total (Agenda v2): solo ellos pueden reasignar. */
  canReassign: boolean;
  /** Quién tiene perfil de agenda, para elegir a quién reasignar. Sin el anfitrión actual. */
  hostOptions: Array<{ userId: string; label: string; hasGoogle: boolean }>;
  onClose: () => void;
}) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [cancelFor, setCancelFor] = useState<BookingStatus | null>(null);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [saleOpen, setSaleOpen] = useState(false); // @plantilla-quitar(ventas)
  const [newHostId, setNewHostId] = useState("");
  const reassignRef = useRef<HTMLDivElement>(null);
  const [transferAssignment, setTransferAssignment] = useState(true);
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState({ notes: booking.internalNotes ?? "", location: booking.locationText ?? "" });
  const isMeet = booking.locationType === "google_meet";
  // «Dónde» y las notas se guardan solas al dejar de escribir; no hay botón de guardar.
  const autosave = useAutosave({
    value: details,
    initial: { notes: booking.internalNotes ?? "", location: booking.locationText ?? "" },
    equals: (a, b) => a.notes === b.notes && (isMeet || a.location === b.location),
    save: (v) => updateBookingDetails({ bookingId: booking.id, internalNotes: v.notes, ...(isMeet ? {} : { locationText: v.location }) }),
  });
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

  // Una reunion recien agendada con Meet: el link lo crea un job unos segundos
  // despues. Se pregunta cada 2 s (hasta 1 minuto) y, cuando cambia, se
  // vuelve a pedir la pagina para ver el link y el estado de Google.
  const waiting = waitingForMeet(booking);
  useEffect(() => {
    if (!waiting) return;
    let alive = true;
    let tries = 0;
    const id = setInterval(async () => {
      tries += 1;
      const result = await getBookingMeetState({ bookingId: booking.id });
      if (!alive) return;
      if (!result.ok || result.data.meetUrl || result.data.syncStatus !== "pending" || tries >= 30) {
        clearInterval(id);
        router.refresh();
      }
    }, 2000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [waiting, booking.id, router]);
  // Al elegir un anfitrión nuevo, el cartel de confirmación puede quedar fuera de la vista: se lo trae.
  useEffect(() => {
    if (reassignOpen) reassignRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [reassignOpen, newHostId]);
  const joinHref = meetJoinHref(booking.meetUrl);
  const attributionSectionsOf = attributionSections(booking.attribution);
  const entryUrl = bestEntryUrl(booking.attribution);

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
      setReassignOpen(false);
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

          {reassignOpen && (
            <div ref={reassignRef} className="rounded-lg border border-border p-3">
              <p className="font-medium">Reasignar anfitrión</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {booking.hostName} → <span className="font-medium text-foreground">{hostOptions.find((h) => h.userId === newHostId)?.label ?? "elegí a quién en «Anfitrión»"}</span>
                {hostOptions.find((h) => h.userId === newHostId)?.hasGoogle === false && " (sin Google Calendar conectado)"}
              </p>
              <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                <input type="checkbox" checked={transferAssignment} onChange={(e) => setTransferAssignment(e.target.checked)} />
                También pasarle los leads asignados (si el closer o el setter era {booking.hostName})
              </label>
              <p className="mt-2 text-xs text-muted-foreground">
                El invitado no se entera: sigue viendo el mismo link de Meet. La nueva persona aparece confirmada en su calendario.
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setReassignOpen(false);
                    setNewHostId("");
                  }}
                  className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted"
                >
                  Volver
                </button>
                <button
                  type="button"
                  disabled={pending || !newHostId}
                  onClick={() => run(() => reassignBookingHostAsHost({ bookingId: booking.id, newHostUserId: newHostId, transferAssignment }), "Agenda reasignada")}
                  className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                >
                  {pending ? "Reasignando…" : "Reasignar"}
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
            <dd>
              {canManage && categories.length > 0 ? (
                // El nombre de la categoría ES el desplegable: un clic y se elige otra.
                <PortalMenu
                  label="Corregir la categoría"
                  title="Corregir la categoría"
                  disabled={pending}
                  width={290}
                  triggerClassName={VALUE_TRIGGER}
                  trigger={
                    <>
                      <span className="min-w-0 truncate">{booking.categoryLabel || "Sin categoría"}</span>
                      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    </>
                  }
                >
                  {categoryTree(categories).map(({ area, types }) => (
                    <Fragment key={area.id}>
                      <PortalMenuLabel>{area.name}</PortalMenuLabel>
                      <PortalMenuItem selected={booking.categoryId === area.id} onSelect={() => run(() => fixBookingCategory({ bookingId: booking.id, categoryId: area.id }), "Categoría corregida")}>
                        <span className="truncate">{area.name} (solo el área)</span>
                      </PortalMenuItem>
                      {types.map((type) => (
                        <PortalMenuItem
                          key={type.id}
                          selected={booking.categoryId === type.id}
                          onSelect={() => run(() => fixBookingCategory({ bookingId: booking.id, categoryId: type.id }), "Categoría corregida")}
                        >
                          <span className="truncate pl-3">{type.name}</span>
                        </PortalMenuItem>
                      ))}
                    </Fragment>
                  ))}
                </PortalMenu>
              ) : (
                booking.categoryLabel || "—"
              )}
            </dd>
            <dt className="text-muted-foreground">Anfitrión</dt>
            <dd>
              {canReassign && isActive(booking.status) && hostOptions.length > 0 ? (
                // Igual que la categoría: el nombre es el desplegable. Elegir a alguien abre el cartel para confirmar (el cambio toca Google Calendar).
                <PortalMenu
                  label="Reasignar el anfitrión"
                  title="Reasignar el anfitrión"
                  disabled={pending}
                  width={290}
                  triggerClassName={VALUE_TRIGGER}
                  trigger={
                    <>
                      <span className="min-w-0 truncate">{booking.hostName}</span>
                      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    </>
                  }
                >
                  <PortalMenuLabel>Reasignar a…</PortalMenuLabel>
                  {hostOptions.map((h) => (
                    <PortalMenuItem
                      key={h.userId}
                      selected={reassignOpen && newHostId === h.userId}
                      onSelect={() => {
                        setNewHostId(h.userId);
                        setReassignOpen(true);
                      }}
                    >
                      <span className="truncate">{h.label}</span>
                      {!h.hasGoogle && <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">sin Google</span>}
                    </PortalMenuItem>
                  ))}
                </PortalMenu>
              ) : (
                booking.hostName
              )}
            </dd>
            <dt className="text-muted-foreground">Dónde</dt>
            <dd>
              {booking.locationType === "google_meet" ? (
                joinHref ? (
                  <a href={joinHref} target="_blank" rel="noopener noreferrer" className="break-all text-primary-ink underline">
                    {joinHref.replace(/^https:\/\//, "")}
                  </a>
                ) : waiting ? (
                  "Creando el Meet…"
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
                    <Tip content="Vuelve a intentar copiar esta reunión a Google Calendar." className="self-start">
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => run(() => retryBookingSync({ bookingId: booking.id }), "Lo vuelvo a intentar")}
                        className="rounded-lg border border-border px-2 py-1 text-xs hover:bg-muted"
                      >
                        Reintentar sincronización
                      </button>
                    </Tip>
                  )}
                </span>
              )}
            </dd>
          </dl>

          <div className="flex flex-wrap gap-2">
            {joinHref && isActive(booking.status) && (
              <Tip content="Abre la videollamada de Google Meet de esta reunión en una pestaña nueva.">
                <a
                  href={joinHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
                >
                  <Video className="h-3.5 w-3.5" aria-hidden />
                  Unirse a Meet
                </a>
              </Tip>
            )}
            <Tip content="Abre la ficha del contacto: sus datos, notas, conversaciones e historial.">
              <Link href={`/dashboard/contacts/${booking.contactId}`} className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-muted">
                Ver contacto
              </Link>
            </Tip>
            <Tip content="Copia el link con el que el invitado puede cambiar el horario o cancelar por su cuenta. Pegalo en un mensaje para mandárselo.">
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
            </Tip>
            {joinHref && (
              <Tip content="Copia el link de la videollamada de Google Meet para mandárselo al invitado (por WhatsApp, por ejemplo).">
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(joinHref);
                    setToast("Link de Meet copiado");
                  }}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-muted"
                >
                  Copiar Meet
                </button>
              </Tip>
            )}
            {canManage && isActive(booking.status) && (
              <Tip
                content={
                  booking.slotReleasedAt
                    ? "Vuelve a bloquear este horario: ya no se va a poder agendar a otro lead encima de esta reunión."
                    : "Deja este horario libre para que otro lead pueda agendar a la misma hora. La reunión no se cancela ni cambia de estado."
                }
              >
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    booking.slotReleasedAt
                      ? run(() => occupyBookingSlotAsHost({ bookingId: booking.id }), "El espacio vuelve a estar ocupado")
                      : run(() => releaseBookingSlotAsHost({ bookingId: booking.id }), "El espacio quedó libre para otra agenda")
                  }
                  className="rounded-lg border border-dashed border-violet-400 px-3 py-1.5 text-xs text-violet-600 hover:bg-violet-500/10 disabled:opacity-60 dark:text-violet-300"
                >
                  {booking.slotReleasedAt ? "Volver a ocupar el espacio" : "Liberar espacio"}
                </button>
              </Tip>
            )}
          </div>
          {booking.slotReleasedAt && (
            <p className="text-xs text-muted-foreground">
              <SlotReleasedChip /> desde el {formatDateTimeWithZone(booking.slotReleasedAt, timezone, timeFormat)}: otro lead puede agendar este mismo horario.
            </p>
          )}

          {booking.responses.length > 0 && (
            <section className="rounded-lg border border-border p-3">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Respuestas del formulario</h3>
              <dl className="flex flex-col gap-1.5">
                {booking.responses.map((r) => (
                  <div key={r.label}>
                    <dt className="text-xs font-medium">{r.label}</dt>
                    <dd className="flex items-start gap-2 text-muted-foreground">
                      <span className="min-w-0 flex-1 break-words">{r.value}</span>
                      <AnswerActions answer={r} whatsappConversationId={booking.whatsappConversationId} />
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          {canManage && (
            <section className="rounded-lg border border-border p-3">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Ubicación y notas</h3>
              {!isMeet && (
                <>
                  <label htmlFor="bk-location" className="text-xs text-muted-foreground">
                    Dónde
                  </label>
                  <input
                    id="bk-location"
                    value={details.location}
                    onChange={(e) => setDetails((d) => ({ ...d, location: e.target.value }))}
                    onBlur={() => void autosave.flush()}
                    className="mb-2 mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                  />
                </>
              )}
              <label htmlFor="bk-notes" className="text-xs text-muted-foreground">
                Notas internas (solo las ve el equipo)
              </label>
              {/* La caja crece con el texto. */}
              <AutoTextarea
                id="bk-notes"
                value={details.notes}
                onChange={(e) => setDetails((d) => ({ ...d, notes: e.target.value }))}
                onBlur={() => void autosave.flush()}
                minRows={3}
                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
              />
              <AutosaveNote status={autosave.status} error={autosave.error} onRetry={() => void autosave.flush()} />
            </section>
          )}

          <section className="rounded-lg border border-border p-3">
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Atribución</h3>
            <div className="mb-3 rounded-md border border-border p-2.5">
              <h4 className="mb-1 text-xs font-medium text-muted-foreground">Vínculo con Meta</h4>
              <MetaMatchControl
                link={booking.metaLink}
                target={booking.metaLink?.touchId ? { touchId: booking.metaLink.touchId } : { bookingId: booking.id }}
                canManage={canLinkMeta}
              />
            </div>
            {attributionSectionsOf.length > 0 || entryUrl ? (
              <div className="flex flex-col gap-3">
                {attributionSectionsOf.map((section) => (
                  <div key={section.title}>
                    <h4 className="mb-1 text-xs font-medium text-muted-foreground">{section.title}</h4>
                    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                      {section.items.map((item) => (
                        <div key={item.key} className="contents">
                          <dt className="text-muted-foreground">{item.label}</dt>
                          <dd className="min-w-0 truncate" title={item.value}>
                            {item.value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                ))}
                {entryUrl && <EntryUrlBlock url={entryUrl} />}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Sin datos de atribución ({booking.origin === "A mano" || booking.origin === "Agente de IA" ? "agendada a mano o por el agente" : "no llegó ningún UTM"}).
              </p>
            )}
          </section>

          {/* @plantilla-desde(llamadas) */}
          {booking.calls.length > 0 && (
            <section className="rounded-lg border border-border p-3">
              <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {booking.calls.length === 1 ? "Ver la llamada" : "Llamadas de esta reunión"}
              </h3>
              <CallSectionList rows={booking.calls} timeZone={timezone} compact />
            </section>
          )}
          {/* @plantilla-hasta(llamadas) */}

          {/* @plantilla-desde(ventas) */}
          {(booking.sales.length > 0 || booking.saleLoad) && (
            <section className="rounded-lg border border-border p-3">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Ventas</h3>
              {booking.sales.length === 0 ? (
                <p className="text-xs text-muted-foreground">Sin venta.</p>
              ) : (
                <ul className="divide-y divide-border text-sm">
                  {booking.sales.map((s) => (
                    <li key={s.id}>
                      <Link href={`/dashboard/ventas/${s.id}`} className="flex flex-wrap items-center gap-2 py-1.5 hover:underline">
                        <span className="min-w-0 flex-1 truncate font-medium">{s.product}</span>
                        <span className="tabular-nums text-xs">{formatMoney(s.finalAmount)}</span>
                        <SaleStatusChip status={s.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {booking.saleLoad && (
                <button type="button" onClick={() => setSaleOpen(true)} className="mt-2 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-muted">
                  Cargar venta
                </button>
              )}
            </section>
          )}
          {/* @plantilla-hasta(ventas) */}

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
      {/* @plantilla-desde(ventas) */}
      {saleOpen && booking.saleLoad && <SaleWizard config={booking.saleLoad.config} initial={booking.saleLoad.initial} onClose={() => setSaleOpen(false)} />}
      {/* @plantilla-hasta(ventas) */}
    </>
  );
}
