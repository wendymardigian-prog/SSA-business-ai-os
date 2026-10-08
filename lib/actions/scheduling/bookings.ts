"use server";

import { revalidatePath } from "next/cache";
import { getPermissionAction, type PermissionContext } from "@/lib/auth/guards";
import { logAudit } from "@/lib/audit";
import { createServiceClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/lib/types/database";
import type { BookingStatus } from "@/lib/scheduling/types";
import { evaluateTransition, groupOf, isBookingStatus, TRANSITION_REASON_TEXT } from "@/lib/scheduling/booking-status";
import { cancelBooking, type CancelStatus } from "@/lib/scheduling/booking/cancel";
import { rescheduleBooking } from "@/lib/scheduling/booking/reschedule";
import { createBooking } from "@/lib/scheduling/booking/create";
import { getPublicSlots } from "@/lib/scheduling/slots-service";
import { notifyBooking } from "@/lib/scheduling/notifications";
import { BOOKING_GOOGLE_SYNC_JOB } from "@/lib/jobs/handlers/booking-sync";
import { categorySnapshot } from "@/lib/scheduling/categories";
import { listCategories, toCategoryRow } from "@/lib/scheduling/data/event-types";

/**
 * Las acciones del anfitrion sobre una agenda (F36, F37).
 *
 * Todas piden `bookings.manage`. El alcance lo aplica RLS: si la agenda no es
 * suya y no tiene alcance total, la fila no aparece y la accion falla con
 * "no encontré esa agenda", que es lo correcto (no se confirma que exista).
 */

const PATH = "/dashboard/agenda";

export type BookingActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { data: T }))
  | { ok: false; error: string };

/** La agenda, leída con el cliente del usuario: RLS decide si la ve. */
type VisibleBooking =
  | { error: string; ctx?: undefined; booking?: undefined }
  | { error?: undefined; ctx: PermissionContext; booking: Database["public"]["Tables"]["bookings"]["Row"] };

async function visibleBooking(bookingId: string): Promise<VisibleBooking> {
  const ctx = await getPermissionAction("bookings.manage");
  if (!ctx) return { error: "No tenés permiso para tocar agendas." };
  const { data } = await ctx.supabase.from("bookings").select("*").eq("id", bookingId).maybeSingle();
  if (!data) return { error: "No encontré esa agenda." };
  return { ctx, booking: data };
}

/** Cambiar el estado (F32, F36). */
export async function changeBookingStatus(input: { bookingId: string; status: string; reason?: string | null }): Promise<BookingActionResult> {
  if (!isBookingStatus(input.status)) return { ok: false, error: "Ese estado no existe." };
  const found = await visibleBooking(input.bookingId);
  if (found.error !== undefined) return { ok: false, error: found.error };
  const { ctx, booking } = found;

  const now = new Date();
  const verdict = evaluateTransition(booking.status, input.status, booking, now);
  if (!verdict.ok) return { ok: false, error: verdict.reason ? TRANSITION_REASON_TEXT[verdict.reason] : "Ese cambio de estado no se puede." };

  // Cancelar pasa por la función de cancelar, que además borra el evento de
  // Google y anula los avisos. Un UPDATE pelado dejaría todo eso colgado.
  if (groupOf(input.status) === "cancelled") {
    const result = await cancelBooking(await createServiceClient(), {
      bookingId: booking.id,
      by: "host",
      status: input.status as CancelStatus,
      reason: input.reason ?? null,
      actorUserId: ctx.user.id,
    });
    if (!result.ok) return { ok: false, error: result.message ?? "No pude cancelar." };
    revalidatePath(PATH);
    return { ok: true };
  }

  // `bookings` solo tiene policy de SELECT (escribir es del servidor): el
  // cliente del usuario no puede hacer este UPDATE. `.select("id")` detecta
  // el caso silencioso (0 filas, sin error) en vez de festejar un cambio que
  // nunca se guardó.
  const service = await createServiceClient();
  const { data: updated, error } = await service
    .from("bookings")
    .update({ status: input.status, status_changed_at: now.toISOString(), status_changed_by: ctx.user.id })
    .eq("id", booking.id)
    .select("id");
  if (error) return { ok: false, error: `No pude guardar: ${error.message}` };
  if (!updated?.length) return { ok: false, error: "No pude guardar el cambio de estado." };

  await logAudit({
    supabase: service,
    workspaceId: booking.workspace_id,
    entityType: "booking",
    entityId: booking.id,
    action: "booking.status_changed",
    changes: { status: { old: booking.status, new: input.status } },
    metadata: { reason: input.reason ?? null },
    performedBy: ctx.user.id,
  });

  await service.from("automation_events").insert({
    workspace_id: booking.workspace_id,
    event_type: "booking_status_changed",
    contact_id: booking.contact_id,
    payload: {
      booking_id: booking.id,
      event_type_id: booking.event_type_id,
      host_user_id: booking.host_user_id,
      from_status: booking.status,
      to_status: input.status,
      by_whom: "host",
    } as unknown as Json,
  });

  revalidatePath(PATH);
  return { ok: true };
}

/** Cancelar desde el equipo, con motivo (F36). */
export async function cancelBookingAsHost(input: { bookingId: string; status: string; reason?: string | null }): Promise<BookingActionResult> {
  if (!isBookingStatus(input.status) || groupOf(input.status) !== "cancelled") {
    return { ok: false, error: "Elegí un motivo de cancelación." };
  }
  return changeBookingStatus(input);
}

/** Reagendar desde el equipo (F36). Puede ignorar la disponibilidad. */
export async function rescheduleAsHost(input: {
  bookingId: string;
  startUtc: string;
  ignoreAvailability?: boolean;
  reason?: string | null;
}): Promise<BookingActionResult<{ startUtc: string; endUtc: string }>> {
  const found = await visibleBooking(input.bookingId);
  if (found.error !== undefined) return { ok: false, error: found.error };
  const { ctx, booking } = found;

  const result = await rescheduleBooking(await createServiceClient(), {
    bookingId: booking.id,
    startUtc: input.startUtc,
    by: "host",
    actorUserId: ctx.user.id,
    ignoreAvailability: input.ignoreAvailability,
    reason: input.reason ?? null,
  });
  if (!result.ok) return { ok: false, error: result.message ?? "No pude reagendar." };
  revalidatePath(PATH);
  return { ok: true, data: { startUtc: result.startUtc, endUtc: result.endUtc } };
}

/** Editar ubicación y notas internas (F36). */
export async function updateBookingDetails(input: {
  bookingId: string;
  locationText?: string | null;
  internalNotes?: string | null;
}): Promise<BookingActionResult> {
  const found = await visibleBooking(input.bookingId);
  if (found.error !== undefined) return { ok: false, error: found.error };
  const { ctx, booking } = found;

  const patch: Record<string, unknown> = {};
  if (input.locationText !== undefined) patch.location_text = input.locationText?.trim() || null;
  if (input.internalNotes !== undefined) patch.internal_notes = input.internalNotes?.trim() || null;
  if (Object.keys(patch).length === 0) return { ok: true };

  // Escribir es del servidor: `bookings` no tiene policy de UPDATE para el
  // usuario logueado.
  const service = await createServiceClient();
  const { data: updated, error } = await service.from("bookings").update(patch).eq("id", booking.id).select("id");
  if (error) return { ok: false, error: `No pude guardar: ${error.message}` };
  if (!updated?.length) return { ok: false, error: "No pude guardar los cambios." };

  await logAudit({
    supabase: service,
    workspaceId: booking.workspace_id,
    entityType: "booking",
    entityId: booking.id,
    action: "booking.updated",
    changes: {
      ...(input.locationText !== undefined ? { location_text: { old: booking.location_text, new: patch.location_text as Json } } : {}),
      ...(input.internalNotes !== undefined ? { internal_notes: { old: null, new: null } } : {}),
    },
    performedBy: ctx.user.id,
  });

  await service.from("automation_events").insert({
    workspace_id: booking.workspace_id,
    event_type: "booking_updated",
    contact_id: booking.contact_id,
    payload: { booking_id: booking.id, event_type_id: booking.event_type_id, host_user_id: booking.host_user_id, fields: Object.keys(patch) } as unknown as Json,
  });

  // Si cambió dónde es, el evento de Google tiene que enterarse.
  if (input.locationText !== undefined && booking.google_event_id) {
    await service.from("scheduled_jobs").insert({
      type: BOOKING_GOOGLE_SYNC_JOB,
      payload: { booking_id: booking.id, action: "update", attempt: 0 } as unknown as Json,
      run_at: new Date().toISOString(),
      status: "pending",
    });
  }

  revalidatePath(PATH);
  return { ok: true };
}

/**
 * Corregir la categoría de una agenda (F36).
 *
 * Cambia el snapshot: es la única vez que se toca, y a mano. El resto del
 * tiempo queda congelado a propósito.
 */
export async function fixBookingCategory(input: { bookingId: string; categoryId: string }): Promise<BookingActionResult> {
  const found = await visibleBooking(input.bookingId);
  if (found.error !== undefined) return { ok: false, error: found.error };
  const { ctx, booking } = found;

  const categories = (await listCategories(ctx.supabase, booking.workspace_id)).map(toCategoryRow);
  const snapshot = categorySnapshot(input.categoryId, categories);
  // `categorySnapshot` siempre devuelve el objeto: si el id no resuelve, sus
  // cuatro campos vienen en null. Eso es lo que hay que rechazar.
  if (!snapshot.area_id && !snapshot.type_id) return { ok: false, error: "Esa categoría no existe." };

  // Escribir es del servidor: `bookings` no tiene policy de UPDATE para el
  // usuario logueado.
  const service = await createServiceClient();
  const { data: updated, error } = await service
    .from("bookings")
    .update({ category_id: input.categoryId, category_snapshot: snapshot as unknown as Json })
    .eq("id", booking.id)
    .select("id");
  if (error) return { ok: false, error: `No pude guardar: ${error.message}` };
  if (!updated?.length) return { ok: false, error: "No pude guardar la categoría." };

  await logAudit({
    supabase: service,
    workspaceId: booking.workspace_id,
    entityType: "booking",
    entityId: booking.id,
    action: "booking.updated",
    changes: { category_id: { old: booking.category_id, new: input.categoryId } },
    performedBy: ctx.user.id,
  });
  revalidatePath(PATH);
  return { ok: true };
}

/** Volver a mandar la agenda a Google después de un fallo (F36). */
export async function retryBookingSync(input: { bookingId: string }): Promise<BookingActionResult> {
  const found = await visibleBooking(input.bookingId);
  if (found.error !== undefined) return { ok: false, error: found.error };
  const { booking } = found;

  const service = await createServiceClient();
  await service.from("bookings").update({ google_sync_status: "pending", google_sync_error: null }).eq("id", booking.id);
  await service.from("scheduled_jobs").insert({
    type: BOOKING_GOOGLE_SYNC_JOB,
    payload: { booking_id: booking.id, action: booking.google_event_id ? "update" : "create", attempt: 0 } as unknown as Json,
    run_at: new Date().toISOString(),
    status: "pending",
  });
  revalidatePath(PATH);
  return { ok: true };
}

/**
 * Agendar a mano (F37).
 *
 * Pasa por la misma función que la página pública, así la agenda queda igual
 * de completa: contacto, asignación, historial, automatizaciones y jobs.
 */
export async function bookManually(input: {
  eventTypeId: string;
  startUtc: string;
  timezone: string;
  responses: Record<string, unknown>;
  contactId?: string | null;
  ignoreMinimumNotice?: boolean;
}): Promise<BookingActionResult<{ uid: string; bookingId: string }>> {
  const ctx = await getPermissionAction("bookings.manage");
  if (!ctx) return { ok: false, error: "No tenés permiso para agendar." };

  const service = await createServiceClient();
  const { data: event } = await ctx.supabase.from("event_types").select("id").eq("id", input.eventTypeId).maybeSingle();
  if (!event) return { ok: false, error: "No encontré ese evento." };

  const result = await createBooking(service, {
    eventTypeId: input.eventTypeId,
    startUtc: input.startUtc,
    inviteeTz: input.timezone,
    responses: input.responses,
    contactId: input.contactId ?? null,
    origin: "manual",
    createdBy: ctx.user.id,
    ignoreMinimumNotice: input.ignoreMinimumNotice,
  });

  if (!result.ok) return { ok: false, error: result.message ?? messageFor(result.reason) };
  if (!result.uid) return { ok: false, error: "No pude agendar." };

  // El anfitrión se entera, salvo que sea quien agendó.
  await notifyBooking(service, result.bookingId, "booking_created", { actorUserId: ctx.user.id });
  revalidatePath(PATH);
  return { ok: true, data: { uid: result.uid, bookingId: result.bookingId } };
}

function messageFor(reason: string): string {
  switch (reason) {
    case "not_found":
      return "No encontré ese evento.";
    case "slot_taken":
      return "Ese horario se acaba de ocupar.";
    case "slot_unavailable":
      return "Ese horario no está disponible. Probá con 'ignorar el aviso mínimo' o elegí otro.";
    case "temporarily_unavailable":
      return "No pude confirmar con Google. Probá de nuevo en un momento.";
    default:
      return "Revisá los datos e intentá de nuevo.";
  }
}

/** Buscar contactos para el paso 2 del agendar manual (F37). */
export async function searchContactsForBooking(term: string): Promise<Array<{ id: string; name: string; detail: string; timezone: string | null }>> {
  const ctx = await getPermissionAction("bookings.manage");
  if (!ctx) return [];

  let query = ctx.supabase
    .from("contacts")
    .select("id, display_name, email, phone, timezone")
    .eq("workspace_id", ctx.workspace.id)
    .is("deleted_at", null)
    .order("last_interaction_at", { ascending: false, nullsFirst: false })
    .limit(10);

  const needle = term.trim();
  if (needle) {
    const like = `%${needle.replace(/[%_]/g, "")}%`;
    query = query.or(`display_name.ilike.${like},email.ilike.${like},phone.ilike.${like}`);
  }

  const { data } = await query;
  return (data ?? []).map((c) => ({
    id: c.id,
    name: c.display_name ?? "Sin nombre",
    detail: [c.email, c.phone].filter(Boolean).join(" · ") || "Sin datos de contacto",
    timezone: c.timezone,
  }));
}

/**
 * Los horarios libres de un evento para el agendar manual (F37).
 *
 * Es la misma función que usa la página pública: el equipo no puede agendar
 * en un hueco que el invitado no vería.
 */
export async function slotsForManualBooking(input: {
  eventTypeId: string;
  from: string;
  to: string;
  timezone: string;
  ignoreMinimumNotice?: boolean;
}): Promise<Record<string, Array<{ startUtc: string; endUtc: string }>>> {
  const ctx = await getPermissionAction("bookings.manage");
  if (!ctx) return {};

  const { data: event } = await ctx.supabase.from("event_types").select("id").eq("id", input.eventTypeId).maybeSingle();
  if (!event) return {};

  const result = await getPublicSlots(await createServiceClient(), {
    eventTypeId: input.eventTypeId,
    from: input.from,
    to: input.to,
    timezone: input.timezone,
    ignoreMinimumNotice: input.ignoreMinimumNotice,
  });
  return result.ok ? result.slots : {};
}
