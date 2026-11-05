/**
 * Agendar a mano en un solo paso (octubre 2026), como en Google Calendar.
 *
 * Diferencias con `createBooking` (la pagina publica y el agente):
 *  - El horario es LIBRE: quien agenda decide (no se limita a los turnos del
 *    evento ni al aviso minimo). Lo unico que la base sigue cuidando es que el
 *    anfitrion no tenga dos reuniones a la misma hora (`bookings_no_overlap`):
 *    si se pisa, avisa y no la crea.
 *  - El evento es opcional. Sin evento, la reunion se cuelga del evento interno
 *    del anfitrion (00269, `ensureInternalEvent`) y guarda su propio titulo.
 *  - No hay formulario del evento: el invitado es un contacto que ya existe, o
 *    un nombre y un email.
 *  - La ubicacion la elige quien agenda (un Google Meet o un texto); sin
 *    elegir, la del evento. Un Meet se pide solo si quien atiende puede
 *    crearlo (`canHostCreateMeet`): si no, la reunion quedaria esperando un
 *    link que nunca llega.
 *
 * Igual que `createBooking`: todo pasa por `create_booking` (contacto,
 * asignacion, historial, automatizaciones, sincronizacion con Google), y los
 * avisos relativos se agendan despues, sin tumbar la reunion si fallan.
 *
 * Recibe el cliente de servicio: quien llama ya chequeo el permiso y saca el
 * workspace de la sesion.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import { categorySnapshot, type CategoryRow } from "@/lib/scheduling/categories";
import { listCategories, toCategoryRow } from "@/lib/scheduling/data/event-types";
import { newBookingUid } from "@/lib/scheduling/antispam";
import { syncRelativeJobs } from "@/lib/scheduling/automation/relative";
import { canHostCreateMeet } from "@/lib/scheduling/data/meet-availability";
import type { ManualBookingPlan } from "./manual-input";

type Db = SupabaseClient<Database>;
type EventRow = Database["public"]["Tables"]["event_types"]["Row"];

const INTERNAL_TITLE = "Reunión";
const IDENTITY_MESSAGE = "Necesitamos el email del invitado para agendar.";

export type ManualBookingResult =
  | { ok: true; bookingId: string; contactId: string; hostUserId: string }
  | { ok: false; error: string };

/** El area por defecto de una reunion sin evento: "Otros" (de sistema). Si no esta, la primera area. */
export function defaultManualCategory(categories: CategoryRow[]): string | null {
  const areas = categories.filter((c) => c.parent_id === null && !c.archived_at);
  return (areas.find((a) => a.is_system && a.name === "Otros") ?? areas[0])?.id ?? null;
}

/**
 * El evento interno de una persona (00269): lo busca y, si no existe, lo crea.
 * Dos pedidos a la vez: el indice unico deja uno solo y el otro vuelve a leer.
 */
export async function ensureInternalEvent(service: Db, workspaceId: string, ownerUserId: string, categoryId: string): Promise<EventRow | null> {
  const find = async () =>
    (
      await service
        .from("event_types")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("owner_user_id", ownerUserId)
        .eq("is_internal", true)
        .is("deleted_at", null)
        .maybeSingle()
    ).data as EventRow | null;

  const existing = await find();
  if (existing) return existing;

  const slug = `reunion-interna-${crypto.randomUUID().slice(0, 8)}`;
  const { data, error } = await service
    .from("event_types")
    .insert({
      workspace_id: workspaceId,
      owner_user_id: ownerUserId,
      category_id: categoryId,
      title: INTERNAL_TITLE,
      slug,
      status: "inactive",
      is_internal: true,
      duration_minutes: 30,
      minimum_notice_minutes: 0,
      location_type: "google_meet",
    })
    .select("*")
    .maybeSingle();
  if (data) return data as EventRow;
  if (error?.code === "23505") return find();
  if (error) console.error("[agenda] no pude crear el evento interno:", error.message);
  return null;
}

/** La zona del anfitrion: la de su perfil (la que ve en todo el sistema), si no la de su agenda, si no la del negocio. */
async function hostTimezone(service: Db, workspaceId: string, hostUserId: string, fallback: string): Promise<string> {
  const [{ data: profile }, { data: prefs }] = await Promise.all([
    service.from("scheduling_profiles").select("timezone").eq("workspace_id", workspaceId).eq("user_id", hostUserId).maybeSingle(),
    service.from("user_preferences").select("timezone").eq("user_id", hostUserId).maybeSingle(),
  ]);
  return prefs?.timezone || profile?.timezone || fallback;
}

export async function createManualBooking(
  service: Db,
  input: {
    workspaceId: string;
    workspaceTimezone: string;
    actorUserId: string;
    plan: ManualBookingPlan;
    hostName?: string | null;
    /** El nombre de quien atiende, para los avisos (con un evento, recien se sabe quien es aca). */
    hostNameOf?: (userId: string) => string | null;
  },
  now: Date = new Date(),
): Promise<ManualBookingResult> {
  const { workspaceId, plan } = input;
  const categories = (await listCategories(service, workspaceId)).map(toCategoryRow);

  // 1. El evento y el anfitrion.
  let event: EventRow | null = null;
  let hostUserId: string;
  let categoryId: string | null;
  if (plan.eventTypeId) {
    const { data } = await service
      .from("event_types")
      .select("*")
      .eq("id", plan.eventTypeId)
      .eq("workspace_id", workspaceId)
      .eq("is_internal", false)
      .is("deleted_at", null)
      .maybeSingle();
    if (!data) return { ok: false, error: "No encontré ese evento." };
    event = data as EventRow;
    hostUserId = event.owner_user_id;
    categoryId = event.category_id;
  } else {
    hostUserId = plan.hostUserId ?? input.actorUserId;
    const { data: member } = await service
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", workspaceId)
      .eq("user_id", hostUserId)
      .maybeSingle();
    if (!member) return { ok: false, error: "Esa persona ya no está en el equipo." };
    const chosen = plan.categoryId && categories.some((c) => c.id === plan.categoryId && !c.archived_at) ? plan.categoryId : null;
    categoryId = chosen ?? defaultManualCategory(categories);
    if (!categoryId) return { ok: false, error: "El negocio no tiene áreas de agenda. Creá una en Agenda → Configuración." };
    event = await ensureInternalEvent(service, workspaceId, hostUserId, categoryId);
    if (!event) return { ok: false, error: "No pude preparar la agenda. Probá de nuevo." };
  }

  const hostName = input.hostName ?? (hostUserId !== input.actorUserId ? (input.hostNameOf?.(hostUserId) ?? null) : null);

  // 2. El invitado: un contacto del workspace, o nombre + email.
  let name = plan.name;
  let email = plan.email;
  let phone = plan.phone;
  if (plan.contactId) {
    const { data: contact } = await service
      .from("contacts")
      .select("id, display_name, email, phone")
      .eq("id", plan.contactId)
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!contact) return { ok: false, error: "No encontré ese contacto." };
    name = contact.display_name;
    email = contact.email;
    phone = contact.phone;
  }

  // 3. Donde es. Lo que eligio quien agenda, o la ubicacion del evento.
  const wanted = plan.location ?? (event.location_type === "google_meet" ? { kind: "google_meet" as const } : { kind: "text" as const, text: event.location_text });
  let locationType: "google_meet" | "manual" = "manual";
  let locationText: string | null = wanted.kind === "text" ? wanted.text : null;
  if (wanted.kind === "google_meet") {
    if (await canHostCreateMeet(service, workspaceId, hostUserId, event.destination_calendar_id)) {
      locationType = "google_meet";
    } else if (plan.location) {
      // Se pidio un Meet a proposito: se avisa en vez de agendar sin link.
      const who =
        hostUserId === input.actorUserId ? "No tenés" : hostName ? `${hostName} no tiene` : "Quien atiende no tiene";
      return { ok: false, error: `${who} Google Calendar conectado, así que no se puede crear un Meet. Escribí la ubicación o elegí otra persona.` };
    }
    // Sin elegir (la del evento) y sin calendario: queda "A confirmar".
  }

  const title = plan.title || event.title;
  const responses: Record<string, string> = {};
  if (name) responses.name = name;
  if (email) responses.email = email;
  if (phone) responses.phone = phone;

  // 4. La transaccion.
  const { data, error } = await service.rpc("create_booking", {
    p_workspace_id: workspaceId,
    p_event_type_id: event.id,
    p_host_user_id: hostUserId,
    p_start_at: plan.startUtc,
    p_end_at: plan.endUtc,
    p_title: title,
    p_name: name ?? null,
    p_email: email ?? null,
    p_phone: phone ?? null,
    // La del invitado, NO la de quien agenda: con esta salen sus emails.
    p_timezone: plan.inviteeTimezone,
    p_host_timezone: await hostTimezone(service, workspaceId, hostUserId, input.workspaceTimezone || "UTC"),
    p_location_type: locationType,
    p_location_text: locationText,
    p_responses: responses as unknown as Json,
    p_origin: "manual",
    p_utm: {} as Json,
    p_referrer_url: null,
    p_landing_page: null,
    p_uid: newBookingUid(),
    p_category_id: categoryId,
    p_category_snapshot: categorySnapshot(categoryId, categories) as unknown as Json,
    p_contact_assignment: event.is_internal ? "none" : event.contact_assignment,
    p_created_by: input.actorUserId,
    p_contact_id: plan.contactId,
    // `without_event`: lo que mira el filtro de los flujos de "Reuniones sin evento".
    p_metadata: (event.is_internal ? { quick: true, without_event: true } : { quick: true }) as unknown as Json,
  });

  if (error) {
    if (error.code === "23P01") {
      const who = hostName ? `${hostName} ya tiene` : "El anfitrión ya tiene";
      return { ok: false, error: `${who} otra reunión en ese horario. Elegí otra hora.` };
    }
    if (error.code === "CB001") return { ok: false, error: IDENTITY_MESSAGE };
    console.error("[agenda] create_booking (manual) fallo:", error.message);
    return { ok: false, error: "No pude agendar. Probá de nuevo en un momento." };
  }

  const result = data as unknown as { booking_id: string; contact_id: string };

  // 5. Las notas: van a las notas internas de la reunion. Un fallo no la tumba.
  if (plan.notes) {
    const { error: notesError } = await service.from("bookings").update({ internal_notes: plan.notes }).eq("id", result.booking_id);
    if (notesError) console.error("[agenda] no pude guardar las notas de la reunion:", notesError.message);
  }

  // 6. La zona del invitado que eligio quien agenda. `create_booking` solo la completa
  // si el contacto no tenia ninguna: elegir otra a proposito es corregirla. Un fallo no tumba la reunion.
  if (plan.inviteeTimezoneChosen) {
    const { error: zoneError } = await service
      .from("contacts")
      .update({ timezone: plan.inviteeTimezone })
      .eq("id", result.contact_id)
      .eq("workspace_id", workspaceId);
    if (zoneError) console.error("[agenda] no pude guardar la zona del contacto:", zoneError.message);
  }

  // 7. Los avisos relativos (mismo criterio que createBooking).
  try {
    await syncRelativeJobs(
      service,
      {
        id: result.booking_id,
        workspace_id: workspaceId,
        event_type_id: event.id,
        host_user_id: hostUserId,
        origin: "manual",
        status: "scheduled",
        category_snapshot: categorySnapshot(categoryId, categories),
        start_at: plan.startUtc,
        end_at: plan.endUtc,
        created_at: now.toISOString(),
        reschedule_count: 0,
        metadata: event.is_internal ? { without_event: true } : {},
      },
      now,
    );
  } catch (err) {
    console.error("[agenda] no pude agendar los avisos:", err instanceof Error ? err.message : err);
  }

  return { ok: true, bookingId: result.booking_id, contactId: result.contact_id, hostUserId };
}
