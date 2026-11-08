"use server";

import { getAnyPermissionAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { getBookingDetail, bookingAttributionOf, hostNames } from "@/lib/scheduling/data/bookings";
import { metaLinkFromTouch, touchMetaIds } from "@/lib/attribution/meta-link";
import { EMPTY_META_NAMES, loadMetaNamesByIds } from "@/lib/attribution/meta-names";
import { loadBookingMatches } from "@/lib/attribution/source-touches";
import { loadBookingCalls } from "@/lib/calls/contact-section"; // @plantilla-quitar(llamadas)
import { canLoadSaleFromBooking, prefillFromBooking } from "@/lib/sales/booking-link"; // @plantilla-quitar(ventas)
import { snapshotText } from "@/lib/sales/sale-text"; // @plantilla-quitar(ventas)
import { loadWizardConfig } from "@/lib/sales/wizard/load"; // @plantilla-quitar(ventas)
import { ORIGIN_LABELS } from "@/lib/scheduling/agenda-filters";
import { publicBaseUrl, bookingPublicUrl } from "@/lib/scheduling/public-url";
import { answersOf, historyText, snapshotLabel } from "@/lib/scheduling/booking-detail-view";
import { resolveViewerTimezone } from "@/lib/user-timezone";
import type { BookingField } from "@/lib/scheduling/types";
import type { BookingDetailData } from "@/components/scheduling/bookings/detail-panel";

/**
 * El detalle de una reunión, pedido APARTE de la página de Agenda.
 *
 * Antes se armaba dentro de la página: abrir o cerrar el panel recargaba la
 * pantalla entera en el servidor (unas 14 consultas). Ahora la pantalla abre
 * el panel en el momento y le pide esto. Mismos permisos que la página
 * (`scheduling.use` o `bookings.view`); la reunión se lee con la sesión, así
 * que la RLS decide si la ve, y se filtra por el negocio de la sesión.
 */
export async function loadBookingDetail(bookingId: string): Promise<BookingDetailData | null> {
  const ctx = await getAnyPermissionAction(["scheduling.use", "bookings.view"]);
  if (!ctx || typeof bookingId !== "string" || !/^[0-9a-f-]{36}$/i.test(bookingId)) return null;

  // Todo lo que solo necesita el id arranca a la vez; despues, lo que necesita
  // la reunion (el toque, por su contacto). Cada viaje a la base cuenta.
  const namesPromise = hostNames(ctx.workspace.id);
  const servicePromise = createServiceClient();
  // @plantilla-desde(llamadas)
  // Las llamadas vinculadas (F34): solo con `calls.view`, y solo las que la RLS deja ver.
  const callsPromise = ctx.can("calls.view")
    ? namesPromise.then((names) => loadBookingCalls(ctx.supabase, { workspaceId: ctx.workspace.id, bookingId, names }))
    : Promise.resolve([]);
  // @plantilla-hasta(llamadas)
  // @plantilla-desde(ventas)
  // Las ventas que nacieron de esta agenda (Ventas, F24): solo con `sales.view`.
  const salesPromise = ctx.can("sales.view")
    ? ctx.supabase
        .from("sales")
        .select("id, status, final_amount, product_snapshot")
        .eq("booking_id", bookingId)
        .eq("workspace_id", ctx.workspace.id)
        .order("created_at", { ascending: false })
        .then((r) => r.data ?? [])
    : Promise.resolve([]);
  // @plantilla-hasta(ventas)

  const [detail, names, timezone, service] = await Promise.all([
    getBookingDetail(ctx.supabase, bookingId),
    namesPromise,
    resolveViewerTimezone((ctx.workspace as { timezone?: string }).timezone),
    servicePromise,
  ]);
  if (!detail || detail.booking.workspace_id !== ctx.workspace.id) return null;
  const booking = detail.booking;
  const publicBase = publicBaseUrl(ctx.workspace as { scheduling_public_base_url?: string | null });

  // El toque va con el cliente de servicio: quien atiende una reunión puede no ver su contacto.
  const matches = await loadBookingMatches(service, ctx.workspace.id, [{ id: booking.id, contactId: booking.contact_id, createdAt: booking.created_at }]);
  const calls = await callsPromise; // @plantilla-quitar(llamadas)
  const sales = await salesPromise; // @plantilla-quitar(ventas)

  const match = matches.get(booking.id);
  let metaLink: BookingDetailData["metaLink"] = null;
  if (match?.touch) {
    const metaNames = ctx.can("dashboards.ads.view") ? await loadMetaNamesByIds(ctx.supabase, ctx.workspace.id, [touchMetaIds(match.touch)]) : EMPTY_META_NAMES;
    metaLink = metaLinkFromTouch(match.touch, metaNames, { ownTouchId: match.ownTouchId, inherited: match.inherited });
  }

  // @plantilla-desde(ventas)
  // «Cargar venta»: con `sales.manage`, si la reunión ya pasó y tiene un resultado.
  let saleLoad: BookingDetailData["saleLoad"] = null;
  if (ctx.can("sales.manage") && canLoadSaleFromBooking({ status: booking.status, contact_id: booking.contact_id, start_at: booking.start_at }, new Date())) {
    const config = await loadWizardConfig(ctx);
    const prefill = prefillFromBooking(
      { id: booking.id, contact_id: booking.contact_id, start_at: booking.start_at, status: booking.status, host_user_id: booking.host_user_id },
      new Set(config.members.map((m) => m.id)),
    );
    if (prefill && config.catalog.length > 0) {
      saleLoad = { config, initial: { contact: { id: prefill.contactId, name: detail.contact?.display_name ?? booking.booker_name ?? "Contacto" }, bookingId: prefill.bookingId, vendedorId: prefill.vendedorId } };
    }
  }
  // @plantilla-hasta(ventas)

  return {
    id: booking.id,
    uid: booking.uid,
    title: booking.title,
    startAt: booking.start_at,
    endAt: booking.end_at,
    status: booking.status as BookingDetailData["status"],
    hostUserId: booking.host_user_id,
    hostName: names.get(booking.host_user_id) ?? "Sin nombre",
    hostTimezone: booking.host_timezone ?? timezone,
    inviteeTimezone: booking.booker_timezone ?? timezone,
    contactId: booking.contact_id,
    contactName: detail.contact?.display_name ?? booking.booker_name ?? null,
    bookerEmail: booking.booker_email,
    bookerPhone: booking.booker_phone,
    responses: answersOf(booking.responses, (detail.event?.booking_fields as BookingField[] | null) ?? []),
    internalNotes: booking.internal_notes,
    locationType: booking.location_type,
    locationText: booking.location_text,
    meetUrl: booking.meet_url,
    origin: ORIGIN_LABELS[booking.origin as keyof typeof ORIGIN_LABELS] ?? booking.origin,
    categoryId: booking.category_id,
    categoryLabel: snapshotLabel(booking.category_snapshot),
    syncStatus: booking.google_sync_status,
    syncError: booking.google_sync_error,
    rescheduleUrl: `${bookingPublicUrl(publicBase, booking.uid)}/reagendar`,
    history: detail.history.map((h) => ({ id: h.id, at: h.performed_at, text: historyText(h, names) })),
    attribution: bookingAttributionOf(booking.utm, booking.referrer_url),
    metaLink,
    slotReleasedAt: booking.slot_released_at,
    calls, // @plantilla-quitar(llamadas)
    sales: sales.map((x) => ({ id: x.id, status: x.status, finalAmount: Number(x.final_amount) || 0, product: snapshotText(x.product_snapshot) })), // @plantilla-quitar(ventas)
    saleLoad, // @plantilla-quitar(ventas)
  };
}
