"use server";

import { revalidatePath } from "next/cache";
import { getPermissionAction, type PermissionContext } from "@/lib/auth/guards";
import { logAudit } from "@/lib/audit";
import type { Json } from "@/lib/types/database";
import {
  DEFAULT_MINIMUM_NOTICE_MINUTES,
  DEFAULT_PERIOD_DAYS,
} from "@/lib/scheduling/limits/buffers";
import {
  activationChecklist,
  canActivate,
  deleteEventNeedsConfirmation,
  slugChangeNeedsConfirmation,
  validateEventDetails,
  validateEventLimits,
  EVENT_COLORS,
  suggestSlug,
} from "@/lib/scheduling/event-validation";
import { defaultBookingFields, validateBookingFields } from "@/lib/scheduling/booking-fields";
import { validateUnavailableMessages } from "@/lib/scheduling/booker/unavailable";
import { isValidSlug, nextCopySlug, slugify } from "@/lib/scheduling/slug";
import { defaultAssignmentForArea } from "@/lib/scheduling/assignment";
import { resolveCategory } from "@/lib/scheduling/categories";
import { resolveEventCalendars } from "@/lib/scheduling/resolve-calendars";
import { futureBookingsCount, getEventType, listCategories, listEventTypes, toCategoryRow, toEventType } from "@/lib/scheduling/data/event-types";
import { getProfileForUser } from "@/lib/scheduling/data/profiles";
import { listSchedules } from "@/lib/scheduling/data/schedules";
import { listUserCalendars, listCalendarConnections } from "@/lib/scheduling/data/calendars";
import { createEventFlows } from "@/lib/scheduling/automation/templates";

/**
 * Eventos (F16 a F22). Crear pide lo minimo y completa el resto con lo que la
 * persona ya tiene configurado; el editor guarda por seccion.
 */

const LIST_PATH = "/dashboard/agenda/configuracion/eventos";

export type EventActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { data: T }))
  | { ok: false; error: string; needsConfirmation?: boolean; field?: string };

async function ownerOf(eventId: string): Promise<{ ctx: PermissionContext; row: NonNullable<Awaited<ReturnType<typeof getEventType>>> } | { error: string }> {
  const ctx = await getPermissionAction("scheduling.use");
  if (!ctx) return { error: "No tenes permiso para tener una agenda" };
  const row = await getEventType(ctx.supabase, eventId);
  if (!row || row.workspace_id !== ctx.workspace.id) return { error: "No encontré ese evento" };
  if (row.owner_user_id !== ctx.user.id && !ctx.can("scheduling.manage_others")) {
    return { error: "No tenes permiso para editar eventos de otra persona" };
  }
  return { ctx, row };
}

export interface NewEventInput {
  title: string;
  slug: string;
  categoryId: string;
  durationMinutes: number;
  locationType: "google_meet" | "manual";
  locationText?: string | null;
  forUserId?: string | null;
}

/**
 * "+ Nuevo evento" (F17): crea el evento INACTIVO con el horario por defecto,
 * los calendarios del perfil, el formulario base, la asignacion por area y
 * los 7 flujos sugeridos apagados (si la opcion del workspace esta encendida).
 */
export async function createEventType(input: NewEventInput): Promise<EventActionResult<{ id: string; flows: number }>> {
  const ctx = await getPermissionAction("scheduling.use");
  if (!ctx) return { ok: false, error: "No tenes permiso para tener una agenda" };
  const ownerId = input.forUserId && input.forUserId !== ctx.user.id ? input.forUserId : ctx.user.id;
  if (ownerId !== ctx.user.id && !ctx.can("scheduling.manage_others")) {
    return { ok: false, error: "No tenes permiso para crear eventos de otra persona" };
  }

  const title = (input.title ?? "").trim();
  if (title.length < 1 || title.length > 120) return { ok: false, error: "El título es obligatorio", field: "title" };
  const slug = slugify(input.slug || suggestSlug(title)).slice(0, 60);
  if (!isValidSlug(slug, 1, 60)) return { ok: false, error: "El link solo admite minúsculas, números y guiones", field: "slug" };

  const categories = (await listCategories(ctx.supabase, ctx.workspace.id)).map(toCategoryRow);
  const { area, type } = resolveCategory(input.categoryId, categories);
  if (!area) return { ok: false, error: "Elegí un área", field: "categoryId" };
  if ((type ?? area).archived_at) return { ok: false, error: "Esa categoría está archivada", field: "categoryId" };

  if (input.durationMinutes < 5 || input.durationMinutes > 480) return { ok: false, error: "La duración va de 5 a 480 minutos", field: "duration" };
  if (input.locationType === "manual" && !(input.locationText ?? "").trim()) return { ok: false, error: "Escribí la ubicación", field: "locationText" };

  const [profile, schedules] = await Promise.all([
    getProfileForUser(ctx.supabase, ctx.workspace.id, ownerId),
    listSchedules(ctx.supabase, ctx.workspace.id, ownerId),
  ]);
  if (!profile) return { ok: false, error: "Primero completá tu perfil de agenda en Ajustes" };

  const { data, error } = await ctx.supabase
    .from("event_types")
    .insert({
      workspace_id: ctx.workspace.id,
      owner_user_id: ownerId,
      category_id: input.categoryId,
      title,
      slug,
      duration_minutes: input.durationMinutes,
      color: EVENT_COLORS[0],
      location_type: input.locationType,
      location_text: input.locationType === "manual" ? (input.locationText ?? "").trim().slice(0, 500) : null,
      status: "inactive",
      // null = usa el horario por defecto de la persona (F17).
      schedule_id: null,
      destination_calendar_id: null,
      conflict_calendar_ids: [],
      minimum_notice_minutes: DEFAULT_MINIMUM_NOTICE_MINUTES,
      period_type: "rolling_calendar",
      period_days: DEFAULT_PERIOD_DAYS,
      contact_assignment: defaultAssignmentForArea(area),
      booking_fields: defaultBookingFields() as unknown as Json,
    })
    .select("id")
    .maybeSingle();

  if (error || !data) {
    return { ok: false, error: error?.code === "23505" ? "Ya usás ese link en otro evento" : `No pude crear el evento: ${error?.message ?? ""}` };
  }

  // Los 7 flujos sugeridos, apagados (F49).
  const autoFlows = (ctx.workspace as { scheduling_auto_create_flows?: boolean }).scheduling_auto_create_flows !== false;
  let flows = 0;
  if (autoFlows && schedules.length >= 0) {
    flows = await createEventFlows(ctx.supabase, { workspaceId: ctx.workspace.id, eventTypeId: data.id, eventTitle: title });
  }

  await logAudit({ supabase: ctx.supabase, workspaceId: ctx.workspace.id, entityType: "event_type", entityId: data.id, action: "event_type.created", metadata: { title, slug, flows }, performedBy: ctx.user.id });
  revalidatePath(LIST_PATH);
  return { ok: true, data: { id: data.id, flows } };
}

/** Guarda la seccion Detalles (F18). */
export async function saveEventDetails(input: {
  eventId: string;
  title: string;
  slug: string;
  descriptionMd?: string | null;
  durationMinutes: number;
  color: string;
  categoryId: string;
  locationType: "google_meet" | "manual";
  locationText?: string | null;
  hideLocationUntilBooked: boolean;
  status: "active" | "hidden" | "inactive";
  successRedirectUrl?: string | null;
  redirectWithParams: boolean;
  contactAssignment: "none" | "setter_if_empty" | "vendedor_if_empty";
  confirmSlugChange?: boolean;
}): Promise<EventActionResult> {
  const owned = await ownerOf(input.eventId);
  if ("error" in owned) return { ok: false, error: owned.error };
  const { ctx, row } = owned;

  const slug = slugify(input.slug).slice(0, 60);
  const checked = validateEventDetails({
    title: input.title,
    slug,
    description_md: input.descriptionMd ?? null,
    duration_minutes: input.durationMinutes,
    color: input.color,
    location_type: input.locationType,
    location_text: input.locationText ?? null,
    hide_location_until_booked: input.hideLocationUntilBooked,
    status: input.status,
    success_redirect_url: input.successRedirectUrl?.trim() ? input.successRedirectUrl.trim() : null,
    redirect_with_params: input.redirectWithParams,
    contact_assignment: input.contactAssignment,
  });
  if (!checked.ok) return { ok: false, error: checked.errors[0]?.message ?? "Revisá los detalles", field: checked.errors[0]?.path };

  const categories = (await listCategories(ctx.supabase, ctx.workspace.id)).map(toCategoryRow);
  const { area } = resolveCategory(input.categoryId, categories);
  if (!area) return { ok: false, error: "Elegí un área", field: "categoryId" };

  if (slug !== row.slug) {
    const futureBookings = await futureBookingsCount(ctx.supabase, row.id);
    const confirmation = slugChangeNeedsConfirmation({ currentSlug: row.slug, nextSlug: slug, futureBookings, confirm: input.confirmSlugChange });
    if (!confirmation.ok) return { ok: false, error: confirmation.message ?? "", needsConfirmation: true };
  }

  // Activar exige el chequeo completo (F18): los tres obligatorios.
  if (input.status !== "inactive" && row.status === "inactive") {
    const ready = await activationContext(ctx, { ...row, ...checked.data, category_id: input.categoryId } as never);
    const decision = canActivate(ready);
    if (!decision.ok) return { ok: false, error: decision.blockers[0] ?? "Falta algo para activar el evento" };
  }

  const { error } = await ctx.supabase
    .from("event_types")
    .update({
      title: checked.data.title,
      slug,
      description_md: checked.data.description_md ?? null,
      duration_minutes: checked.data.duration_minutes,
      color: checked.data.color ?? null,
      category_id: input.categoryId,
      location_type: checked.data.location_type,
      location_text: checked.data.location_text ?? null,
      hide_location_until_booked: Boolean(checked.data.hide_location_until_booked),
      status: checked.data.status,
      success_redirect_url: checked.data.success_redirect_url ?? null,
      redirect_with_params: Boolean(checked.data.redirect_with_params),
      contact_assignment: input.contactAssignment,
    })
    .eq("id", row.id);
  if (error) return { ok: false, error: error.code === "23505" ? "Ya usás ese link en otro evento" : `No pude guardar: ${error.message}` };

  await logAudit({
    supabase: ctx.supabase,
    workspaceId: ctx.workspace.id,
    entityType: "event_type",
    entityId: row.id,
    action: "event_type.updated",
    changes: {
      ...(row.slug !== slug ? { slug: { old: row.slug, new: slug } } : {}),
      ...(row.status !== input.status ? { status: { old: row.status, new: input.status } } : {}),
    },
    performedBy: ctx.user.id,
  });
  revalidatePath(LIST_PATH);
  revalidatePath(`${LIST_PATH}/${row.id}`);
  return { ok: true };
}

/** Seccion Disponibilidad y calendarios (F19). */
export async function saveEventAvailability(input: {
  eventId: string;
  scheduleId: string | null;
  destinationCalendarId: string | null;
  conflictCalendarIds: string[];
}): Promise<EventActionResult> {
  const owned = await ownerOf(input.eventId);
  if ("error" in owned) return { ok: false, error: owned.error };
  const { ctx, row } = owned;

  if (input.scheduleId) {
    const schedules = await listSchedules(ctx.supabase, ctx.workspace.id, row.owner_user_id);
    if (!schedules.some((s) => s.id === input.scheduleId)) return { ok: false, error: "Ese horario no existe" };
  }
  const calendars = await listUserCalendars(ctx.supabase, ctx.workspace.id, row.owner_user_id);
  if (input.destinationCalendarId) {
    const cal = calendars.find((c) => c.id === input.destinationCalendarId);
    if (!cal || !cal.is_active) return { ok: false, error: "Ese calendario no está disponible" };
    if (cal.access_role !== "owner" && cal.access_role !== "writer") return { ok: false, error: "Ese calendario es de solo lectura" };
  }
  const conflictIds = input.conflictCalendarIds.filter((id) => calendars.some((c) => c.id === id));

  const { error } = await ctx.supabase
    .from("event_types")
    .update({ schedule_id: input.scheduleId, destination_calendar_id: input.destinationCalendarId, conflict_calendar_ids: conflictIds })
    .eq("id", row.id);
  if (error) return { ok: false, error: `No pude guardar: ${error.message}` };
  revalidatePath(`${LIST_PATH}/${row.id}`);
  return { ok: true };
}

/** Seccion Formulario (F20). */
export async function saveEventForm(input: { eventId: string; fields: unknown }): Promise<EventActionResult> {
  const owned = await ownerOf(input.eventId);
  if ("error" in owned) return { ok: false, error: owned.error };
  const { ctx, row } = owned;

  const checked = validateBookingFields(input.fields);
  if (!checked.ok) return { ok: false, error: checked.errors[0]?.message ?? "Revisá el formulario", field: checked.errors[0]?.path };

  const { error } = await ctx.supabase
    .from("event_types")
    .update({ booking_fields: checked.fields as unknown as Json })
    .eq("id", row.id);
  if (error) return { ok: false, error: `No pude guardar el formulario: ${error.message}` };
  revalidatePath(`${LIST_PATH}/${row.id}`);
  return { ok: true };
}

/** Seccion Limites y buffers (F21). */
export async function saveEventLimits(input: {
  eventId: string;
  beforeBufferMinutes: number;
  afterBufferMinutes: number;
  minimumNoticeMinutes: number;
  slotIntervalMinutes: number | null;
  maxPerDay: number | null;
  maxPerWeek: number | null;
  periodType: "rolling_calendar" | "rolling_business" | "range" | "unlimited";
  periodDays: number | null;
  periodStartDate: string | null;
  periodEndDate: string | null;
}): Promise<EventActionResult<{ warnings: string[] }>> {
  const owned = await ownerOf(input.eventId);
  if ("error" in owned) return { ok: false, error: owned.error };
  const { ctx, row } = owned;

  const checked = validateEventLimits({
    before_buffer_minutes: input.beforeBufferMinutes,
    after_buffer_minutes: input.afterBufferMinutes,
    minimum_notice_minutes: input.minimumNoticeMinutes,
    slot_interval_minutes: input.slotIntervalMinutes,
    max_per_day: input.maxPerDay,
    max_per_week: input.maxPerWeek,
    period_type: input.periodType,
    period_days: input.periodDays,
    period_start_date: input.periodStartDate,
    period_end_date: input.periodEndDate,
  });
  if (!checked.ok) return { ok: false, error: checked.errors[0]?.message ?? "Revisá los límites" };

  const { error } = await ctx.supabase
    .from("event_types")
    .update({
      before_buffer_minutes: input.beforeBufferMinutes,
      after_buffer_minutes: input.afterBufferMinutes,
      minimum_notice_minutes: input.minimumNoticeMinutes,
      slot_interval_minutes: input.slotIntervalMinutes,
      max_per_day: input.maxPerDay,
      max_per_week: input.maxPerWeek,
      period_type: input.periodType,
      period_days: input.periodDays,
      period_start_date: input.periodStartDate,
      period_end_date: input.periodEndDate,
    })
    .eq("id", row.id);
  if (error) return { ok: false, error: `No pude guardar: ${error.message}` };
  revalidatePath(`${LIST_PATH}/${row.id}`);
  return { ok: true, data: { warnings: checked.warnings ?? [] } };
}

/** Seccion "Si no se puede agendar" (F58). */
export async function saveUnavailableMessages(input: { eventId: string; messages: unknown }): Promise<EventActionResult> {
  const owned = await ownerOf(input.eventId);
  if ("error" in owned) return { ok: false, error: owned.error };
  const { ctx, row } = owned;

  if (input.messages === null) {
    const { error } = await ctx.supabase.from("event_types").update({ unavailable_messages: null }).eq("id", row.id);
    if (error) return { ok: false, error: `No pude guardar: ${error.message}` };
    revalidatePath(`${LIST_PATH}/${row.id}`);
    return { ok: true };
  }

  const checked = validateUnavailableMessages(input.messages);
  if (!checked.ok) return { ok: false, error: checked.errors[0]?.message ?? "Revisá los mensajes", field: checked.errors[0]?.path };
  const { error } = await ctx.supabase
    .from("event_types")
    .update({ unavailable_messages: checked.data as unknown as Json })
    .eq("id", row.id);
  if (error) return { ok: false, error: `No pude guardar: ${error.message}` };
  revalidatePath(`${LIST_PATH}/${row.id}`);
  return { ok: true };
}

export async function setEventStatus(input: { eventId: string; status: "active" | "hidden" | "inactive" }): Promise<EventActionResult> {
  const owned = await ownerOf(input.eventId);
  if ("error" in owned) return { ok: false, error: owned.error };
  const { ctx, row } = owned;

  if (input.status !== "inactive") {
    const checklist = await activationContext(ctx, row);
    const decision = canActivate(checklist);
    if (!decision.ok) return { ok: false, error: decision.blockers[0] ?? "Falta algo para activar el evento" };
  }

  const { error } = await ctx.supabase.from("event_types").update({ status: input.status }).eq("id", row.id);
  if (error) return { ok: false, error: `No pude cambiar el estado: ${error.message}` };
  await logAudit({ supabase: ctx.supabase, workspaceId: ctx.workspace.id, entityType: "event_type", entityId: row.id, action: "event_type.updated", changes: { status: { old: row.status, new: input.status } }, performedBy: ctx.user.id });
  revalidatePath(LIST_PATH);
  revalidatePath(`${LIST_PATH}/${row.id}`);
  return { ok: true };
}

export async function duplicateEventType(eventId: string): Promise<EventActionResult<{ id: string }>> {
  const owned = await ownerOf(eventId);
  if ("error" in owned) return { ok: false, error: owned.error };
  const { ctx, row } = owned;

  const siblings = await listEventTypes(ctx.supabase, ctx.workspace.id, { ownerUserId: row.owner_user_id });
  const slug = nextCopySlug(row.slug, siblings.map((e) => e.slug));

  const { data, error } = await ctx.supabase
    .from("event_types")
    .insert({
      workspace_id: row.workspace_id,
      owner_user_id: row.owner_user_id,
      category_id: row.category_id,
      title: `${row.title} (copia)`.slice(0, 120),
      slug,
      description_md: row.description_md,
      duration_minutes: row.duration_minutes,
      color: row.color,
      location_type: row.location_type,
      location_text: row.location_text,
      hide_location_until_booked: row.hide_location_until_booked,
      // Una copia nace inactiva y sin agendas.
      status: "inactive",
      schedule_id: row.schedule_id,
      destination_calendar_id: row.destination_calendar_id,
      conflict_calendar_ids: row.conflict_calendar_ids,
      before_buffer_minutes: row.before_buffer_minutes,
      after_buffer_minutes: row.after_buffer_minutes,
      minimum_notice_minutes: row.minimum_notice_minutes,
      slot_interval_minutes: row.slot_interval_minutes,
      max_per_day: row.max_per_day,
      max_per_week: row.max_per_week,
      period_type: row.period_type,
      period_days: row.period_days,
      period_start_date: row.period_start_date,
      period_end_date: row.period_end_date,
      contact_assignment: row.contact_assignment,
      success_redirect_url: row.success_redirect_url,
      redirect_with_params: row.redirect_with_params,
      booking_fields: row.booking_fields,
      unavailable_messages: row.unavailable_messages,
    })
    .select("id")
    .maybeSingle();
  if (error || !data) return { ok: false, error: `No pude duplicar el evento: ${error?.message ?? ""}` };

  // Duplicar un evento duplica sus flujos precreados, apagados (F49).
  const autoFlows = (ctx.workspace as { scheduling_auto_create_flows?: boolean }).scheduling_auto_create_flows !== false;
  if (autoFlows) {
    await createEventFlows(ctx.supabase, { workspaceId: ctx.workspace.id, eventTypeId: data.id, eventTitle: `${row.title} (copia)` });
  }

  await logAudit({ supabase: ctx.supabase, workspaceId: ctx.workspace.id, entityType: "event_type", entityId: data.id, action: "event_type.created", metadata: { duplicated_from: row.id }, performedBy: ctx.user.id });
  revalidatePath(LIST_PATH);
  return { ok: true, data: { id: data.id } };
}

/** Borrar (soft): con agendas futuras exige confirmar; las agendas se conservan (F17). */
export async function deleteEventType(input: { eventId: string; confirm?: boolean }): Promise<EventActionResult> {
  const owned = await ownerOf(input.eventId);
  if ("error" in owned) return { ok: false, error: owned.error };
  const { ctx, row } = owned;

  const futureBookings = await futureBookingsCount(ctx.supabase, row.id);
  const confirmation = deleteEventNeedsConfirmation(futureBookings, input.confirm);
  if (!confirmation.ok) return { ok: false, error: confirmation.message ?? "", needsConfirmation: true };

  const { error } = await ctx.supabase
    .from("event_types")
    .update({ deleted_at: new Date().toISOString(), status: "inactive" })
    .eq("id", row.id);
  if (error) return { ok: false, error: `No pude borrar el evento: ${error.message}` };

  // Sus flujos quedan apagados, con el vínculo intacto para el historial (F49).
  await ctx.supabase.from("flows").update({ status: "draft" }).eq("event_type_id", row.id);

  await logAudit({ supabase: ctx.supabase, workspaceId: ctx.workspace.id, entityType: "event_type", entityId: row.id, action: "event_type.deleted", metadata: { future_bookings: futureBookings }, performedBy: ctx.user.id });
  revalidatePath(LIST_PATH);
  return { ok: true };
}

/** El contexto del chequeo "Listo para activar" (F18), leido de la base. */
async function activationContext(ctx: PermissionContext, row: NonNullable<Awaited<ReturnType<typeof getEventType>>>) {
  const [profile, schedules, calendars, connections, flowsResult] = await Promise.all([
    getProfileForUser(ctx.supabase, ctx.workspace.id, row.owner_user_id),
    listSchedules(ctx.supabase, ctx.workspace.id, row.owner_user_id),
    listUserCalendars(ctx.supabase, ctx.workspace.id, row.owner_user_id),
    listCalendarConnections(ctx.supabase, ctx.workspace.id, row.owner_user_id),
    ctx.supabase.from("flows").select("id, status").eq("event_type_id", row.id).eq("status", "published"),
  ]);

  const broken = new Set(connections.filter((c) => c.status === "revoked" || c.status === "error").map((c) => c.id));
  const schedule = row.schedule_id ? schedules.find((s) => s.id === row.schedule_id) : schedules.find((s) => s.is_default);
  const resolved = resolveEventCalendars(
    { destination_calendar_id: row.destination_calendar_id, conflict_calendar_ids: row.conflict_calendar_ids },
    profile ? { default_destination_calendar_id: profile.default_destination_calendar_id } : null,
    calendars.map((c) => ({
      id: c.id,
      name: c.name,
      access_role: c.access_role,
      check_conflicts: c.check_conflicts,
      is_active: c.is_active,
      connection_broken: broken.has(c.connection_id),
    })),
  );

  const fields = validateBookingFields(row.booking_fields);
  return activationChecklist(toEventType(row), {
    scheduleName: schedule?.name ?? null,
    destinationCalendar: resolved.destination
      ? { name: resolved.destination.name, provider: "google", writable: resolved.destination.access_role === "owner" || resolved.destination.access_role === "writer" }
      : null,
    formValid: fields.ok,
    enabledFlows: (flowsResult.data ?? []).length,
  });
}

/** Lo que el editor necesita para dibujar la tarjeta "Listo para activar". */
export async function loadActivationChecklist(eventId: string): Promise<EventActionResult<{ checklist: Awaited<ReturnType<typeof activationContext>>; canActivate: boolean; blockers: string[] }>> {
  const owned = await ownerOf(eventId);
  if ("error" in owned) return { ok: false, error: owned.error };
  const checklist = await activationContext(owned.ctx, owned.row);
  const decision = canActivate(checklist);
  return { ok: true, data: { checklist, canActivate: decision.ok, blockers: decision.blockers } };
}
