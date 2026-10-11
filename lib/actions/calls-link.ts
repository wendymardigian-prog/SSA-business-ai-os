"use server";

import { revalidatePath } from "next/cache";
import { getPermissionAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { emitCallEvent } from "@/lib/calls/automation/emit";
import { meetingPeople, meetingDayRange, suggestBookings, sanitizeTerm, type BookingSuggestion } from "@/lib/calls/booking-suggestions";
import type { CallAttendee, CallTranscriptLine } from "@/lib/types/database";
import { sanitizeSearch } from "@/lib/url-params";

/**
 * Vincular una llamada a mano con su contacto y su agenda (F13). Con `calls.edit`.
 *
 * Tres reglas:
 *  - Todo lo que se lee para vincular se lee con el cliente de QUIEN VINCULA:
 *    la RLS decide que contactos y agendas ve. Un id mandado a mano que esa
 *    persona no ve se rechaza.
 *  - Vincular un contacto a una agenda de OTRO contacto se permite (puede ser
 *    un acompañante) pero se avisa; el contacto de la llamada no cambia solo.
 *  - Todo queda en el historial, con el antes y el despues.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type LinkResult = { ok: true; warning?: string } | { ok: false; error: string };

export interface ContactOption {
  id: string;
  name: string;
  email: string | null;
}

async function loadVisibleCall(ctx: NonNullable<Awaited<ReturnType<typeof getPermissionAction>>>, callId: string) {
  // Con el cliente de la persona: si no ve la llamada, es como si no existiera.
  const { data } = await ctx.supabase
    .from("calls")
    .select("id, workspace_id, contact_id, booking_id, link_method, recorded_at, recorded_by_user_id, recorded_by_email, attendees, transcript")
    .eq("id", callId)
    .eq("workspace_id", ctx.workspace.id)
    .is("archived_at", null)
    .maybeSingle();
  return data;
}

/** Cambia (o saca) el contacto de la llamada. */
export async function linkCallContact(input: { callId: string; contactId: string | null }): Promise<LinkResult> {
  const ctx = await getPermissionAction("calls.edit");
  if (!ctx) return { ok: false, error: "No tenés permiso para editar llamadas" };
  if (!UUID.test(input.callId) || (input.contactId !== null && !UUID.test(input.contactId))) return { ok: false, error: "Los datos no son válidos" };

  const call = await loadVisibleCall(ctx, input.callId);
  if (!call) return { ok: false, error: "No encontré esa llamada" };

  if (input.contactId) {
    // Solo contactos que ESTA persona puede ver (la RLS de contacts).
    const { data: contact } = await ctx.supabase.from("contacts").select("id").eq("id", input.contactId).eq("workspace_id", ctx.workspace.id).is("deleted_at", null).maybeSingle();
    if (!contact) return { ok: false, error: "No encontré ese contacto" };
  }
  if (call.contact_id === input.contactId) return { ok: true };

  const service = await createServiceClient();
  const now = new Date().toISOString();
  const { error } = await service
    .from("calls")
    .update(
      input.contactId
        ? { contact_id: input.contactId, link_method: "manual", linked_by: ctx.user.id, linked_at: now }
        : { contact_id: null, link_method: call.booking_id ? "manual" : "none", linked_by: ctx.user.id, linked_at: now },
    )
    .eq("id", call.id);
  if (error) {
    console.error("[llamadas] no pude vincular el contacto:", error.message);
    return { ok: false, error: "No pude guardar el cambio" };
  }

  await logAudit({
    supabase: ctx.supabase,
    workspaceId: ctx.workspace.id,
    entityType: "call",
    entityId: call.id,
    action: input.contactId ? "call.linked" : "call.unlinked",
    changes: { contact_id: { old: call.contact_id, new: input.contactId } },
    metadata: { what: "contact" },
    performedBy: ctx.user.id,
  });

  // Quedo vinculada a un contacto: dispara los flujos de `call_linked`. Sacar el contacto no emite nada.
  if (input.contactId) await emitCallEvent(service, "call_linked", call.id);

  revalidatePath(`/dashboard/llamadas/${call.id}`);
  revalidatePath("/dashboard/llamadas");
  return { ok: true };
}

/** Cambia (o saca) la agenda de la llamada. */
export async function linkCallBooking(input: { callId: string; bookingId: string | null }): Promise<LinkResult> {
  const ctx = await getPermissionAction("calls.edit");
  if (!ctx) return { ok: false, error: "No tenés permiso para editar llamadas" };
  if (!UUID.test(input.callId) || (input.bookingId !== null && !UUID.test(input.bookingId))) return { ok: false, error: "Los datos no son válidos" };

  const call = await loadVisibleCall(ctx, input.callId);
  if (!call) return { ok: false, error: "No encontré esa llamada" };

  let warning: string | undefined;
  if (input.bookingId) {
    // Solo agendas que esta persona puede ver (la RLS de bookings).
    const { data: booking } = await ctx.supabase.from("bookings").select("id, contact_id").eq("id", input.bookingId).eq("workspace_id", ctx.workspace.id).maybeSingle();
    if (!booking) return { ok: false, error: "No encontré esa agenda" };
    if (call.contact_id && booking.contact_id !== call.contact_id) {
      warning = "Esa agenda es de otro contacto. Se vinculó igual (puede ser un acompañante); el contacto de la llamada no cambió.";
    }
  }
  if (call.booking_id === input.bookingId) return { ok: true };

  const service = await createServiceClient();
  const { error } = await service
    .from("calls")
    .update({
      booking_id: input.bookingId,
      link_method: input.bookingId || call.contact_id ? "manual" : "none",
      linked_by: ctx.user.id,
      linked_at: new Date().toISOString(),
    })
    .eq("id", call.id);
  if (error) {
    console.error("[llamadas] no pude vincular la agenda:", error.message);
    return { ok: false, error: "No pude guardar el cambio" };
  }

  await logAudit({
    supabase: ctx.supabase,
    workspaceId: ctx.workspace.id,
    entityType: "call",
    entityId: call.id,
    action: input.bookingId ? "call.linked" : "call.unlinked",
    changes: { booking_id: { old: call.booking_id, new: input.bookingId } },
    metadata: { what: "booking" },
    performedBy: ctx.user.id,
  });

  revalidatePath(`/dashboard/llamadas/${call.id}`);
  return { ok: true, ...(warning ? { warning } : {}) };
}

/** El buscador de contactos del popover: solo los que quien busca puede ver. */
export async function searchContactsForCall(query: string): Promise<ContactOption[]> {
  const ctx = await getPermissionAction("calls.edit");
  if (!ctx) return [];
  const q = sanitizeSearch(query, 60);
  if (q.length < 2) return [];
  const { data } = await ctx.supabase
    .from("contacts")
    .select("id, display_name, email")
    .eq("workspace_id", ctx.workspace.id)
    .is("deleted_at", null)
    .or(`display_name.ilike.%${q}%,email.ilike.%${q}%`)
    .order("display_name", { ascending: true })
    .limit(8);
  return (data ?? []).map((c) => ({ id: c.id, name: c.display_name || c.email || "Sin nombre", email: c.email ?? null }));
}

/** Las agendas sugeridas para vincular: por correo, por nombre y por fecha. */
export async function suggestBookingsForCall(input: { callId: string; timeZone: string }): Promise<BookingSuggestion[]> {
  const ctx = await getPermissionAction("calls.edit");
  if (!ctx || !UUID.test(input.callId)) return [];
  const call = await loadVisibleCall(ctx, input.callId);
  if (!call) return [];

  const { emails, names } = meetingPeople(call.attendees as CallAttendee[], call.transcript as CallTranscriptLine[], call.recorded_by_email, []);
  const day = meetingDayRange(call.recorded_at, input.timeZone || "UTC");
  const cols = "id, start_at, booker_email, booker_name";
  const norm = (rows: Array<{ id: string; start_at: string; booker_email: string | null; booker_name: string | null }> | null) =>
    (rows ?? []).map((b) => ({ id: b.id, start_at: b.start_at, email: b.booker_email, full_name: b.booker_name }));

  const byEmail = emails.length
    ? await ctx.supabase.from("bookings").select(cols).eq("workspace_id", ctx.workspace.id).in("booker_email", emails).order("start_at", { ascending: false }).limit(10)
    : { data: [] };
  const byName = names.length
    ? await ctx.supabase.from("bookings").select(cols).eq("workspace_id", ctx.workspace.id).or(names.map((n) => `booker_name.ilike.%${sanitizeTerm(n)}%`).join(",")).order("start_at", { ascending: false }).limit(10)
    : { data: [] };
  const byDate = await ctx.supabase.from("bookings").select(cols).eq("workspace_id", ctx.workspace.id).gte("start_at", day.from).lte("start_at", day.to).order("start_at", { ascending: true }).limit(10);

  return suggestBookings(norm(byEmail.data), norm(byName.data), norm(byDate.data));
}
