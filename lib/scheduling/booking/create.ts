/**
 * Crear una agenda (F26). Lo usan la pagina publica, el agendar manual (F37)
 * y el agente (F55): los tres pasan por aca.
 *
 * El orden importa:
 *   1. Validar la entrada con el esquema del formulario del evento.
 *   2. Antispam (campo trampa y tope por IP), solo para lo publico.
 *   3. Recalcular en el SERVIDOR que el horario siga libre, con datos frescos
 *      de Google. El cliente nunca decide si un horario es valido.
 *   4. La RPC `create_booking`: contacto, asignacion, agenda, historial,
 *      evento de automatizacion y jobs, en UNA transaccion.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import { buildBookingSchema, contactDataFromResponses } from "@/lib/scheduling/booking-fields";
import { isSlotAvailable } from "@/lib/scheduling/slots";
import { categorySnapshot } from "@/lib/scheduling/categories";
import { listCategories, toCategoryRow } from "@/lib/scheduling/data/event-types";
import { buildSlotsInput, findPublicEvent } from "@/lib/scheduling/data/slots-input";
import { checkRateLimit, newBookingUid, HONEYPOT_FIELD } from "@/lib/scheduling/antispam";
import { minutesToWallTime } from "@/lib/scheduling/time/tz";

type Db = SupabaseClient<Database>;

export interface CreateBookingInput {
  /** El evento, por usuario y slug (publico) o por id (manual y agente). */
  username?: string;
  slug?: string;
  eventTypeId?: string;
  startUtc: string;
  inviteeTz: string;
  responses: Record<string, unknown>;
  /** Contacto ya conocido: se saltea la deduplicacion (F37, F55). */
  contactId?: string | null;
  origin: "public_page" | "embed" | "manual" | "agent" | "api";
  utm?: Record<string, string>;
  referrerUrl?: string | null;
  /** El campo trampa del formulario publico. */
  honeypot?: unknown;
  /** La IP, para el tope. Solo en lo publico. */
  ip?: string | null;
  createdBy?: string | null;
  metadata?: Record<string, unknown>;
  /** Solo el equipo (F37). */
  ignoreMinimumNotice?: boolean;
  now?: Date;
}

export type CreateBookingResult =
  | { ok: true; uid: string; bookingId: string; contactId: string; startUtc: string; endUtc: string; redirectUrl: string | null }
  /** El honeypot: se responde como si hubiera salido bien, sin crear nada. */
  | { ok: true; uid: null; bookingId: null; contactId: null; startUtc: string; endUtc: string; redirectUrl: null; ignored: true }
  | { ok: false; status: number; reason: "not_found" | "rate_limited" | "invalid" | "slot_taken" | "slot_unavailable" | "temporarily_unavailable"; message?: string; fields?: Record<string, string> };

export async function createBooking(service: Db, input: CreateBookingInput): Promise<CreateBookingResult> {
  const now = input.now ?? new Date();

  // 1. El evento.
  let event: Database["public"]["Tables"]["event_types"]["Row"] | null = null;
  let profile: Database["public"]["Tables"]["scheduling_profiles"]["Row"] | null = null;
  if (input.eventTypeId) {
    const { data: row } = await service.from("event_types").select("*").eq("id", input.eventTypeId).is("deleted_at", null).maybeSingle();
    if (!row) return { ok: false, status: 404, reason: "not_found" };
    event = row;
    const { data: p } = await service.from("scheduling_profiles").select("*").eq("workspace_id", row.workspace_id).eq("user_id", row.owner_user_id).maybeSingle();
    if (!p) return { ok: false, status: 404, reason: "not_found" };
    profile = p;
  } else if (input.username && input.slug) {
    const found = await findPublicEvent(service, input.username, input.slug);
    if (!found) return { ok: false, status: 404, reason: "not_found" };
    event = found.event;
    profile = found.profile;
  } else {
    return { ok: false, status: 404, reason: "not_found" };
  }

  const endUtc = new Date(new Date(input.startUtc).getTime() + event.duration_minutes * 60_000).toISOString();

  // 2. El campo trampa: respuesta falsa, sin crear nada.
  const honeypot = input.honeypot ?? (input.responses as Record<string, unknown>)[HONEYPOT_FIELD];
  if (typeof honeypot === "string" && honeypot.trim().length > 0) {
    return { ok: true, uid: null, bookingId: null, contactId: null, startUtc: input.startUtc, endUtc, redirectUrl: null, ignored: true };
  }

  // 3. El tope por IP (solo lo publico).
  if (input.ip && (input.origin === "public_page" || input.origin === "embed")) {
    const limit = await checkRateLimit(service, "create", input.ip, now);
    if (!limit.allowed) return { ok: false, status: 429, reason: "rate_limited", message: "Demasiados intentos. Probá de nuevo en un rato." };
  }

  // 4. Las respuestas del formulario.
  const { data: workspace } = await service.from("workspaces").select("timezone").eq("id", event.workspace_id).maybeSingle();
  const fields = (event.booking_fields as unknown as Parameters<typeof buildBookingSchema>[0]) ?? [];
  const schema = buildBookingSchema(fields, { defaultCountry: countryFromTimezone(workspace?.timezone ?? null) });
  const parsed = schema.safeParse(input.responses);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[issue.path.join(".") || "_"] = issue.message;
    return { ok: false, status: 400, reason: "invalid", message: parsed.error.issues[0]?.message, fields: fieldErrors };
  }
  const responses = parsed.data as Record<string, unknown>;
  const contactData = contactDataFromResponses(responses);

  // 5. El horario, recalculado con datos frescos: Google sin cache.
  const from = new Date(new Date(input.startUtc).getTime() - 24 * 60 * 60 * 1000).toISOString();
  const to = new Date(new Date(endUtc).getTime() + 24 * 60 * 60 * 1000).toISOString();
  const built = await buildSlotsInput(service, event, profile, {
    from,
    to,
    inviteeTz: input.inviteeTz,
    now,
    freshGoogle: true,
    ignoreMinimumNotice: input.ignoreMinimumNotice,
  });
  if (!built.ok) {
    // Google no contesto: no se crea nada y se dice que vuelva a probar.
    return { ok: false, status: 503, reason: "temporarily_unavailable" };
  }
  if (!isSlotAvailable(built.input, input.startUtc)) {
    return { ok: false, status: 409, reason: "slot_unavailable", message: "Ese horario ya no está disponible." };
  }

  // 6. La transaccion.
  const categories = (await listCategories(service, event.workspace_id)).map(toCategoryRow);
  const uid = newBookingUid();
  const { data, error } = await service.rpc("create_booking", {
    p_workspace_id: event.workspace_id,
    p_event_type_id: event.id,
    p_host_user_id: event.owner_user_id,
    p_start_at: input.startUtc,
    p_end_at: endUtc,
    p_title: event.title,
    p_name: contactData.name || null,
    p_email: contactData.email,
    p_phone: contactData.phone,
    p_timezone: input.inviteeTz,
    p_host_timezone: built.context.hostTimezone,
    p_location_type: event.location_type,
    p_location_text: event.location_text,
    p_responses: responses as unknown as Json,
    p_origin: input.origin,
    p_utm: (input.utm ?? {}) as unknown as Json,
    p_referrer_url: input.referrerUrl ?? null,
    p_uid: uid,
    p_category_id: event.category_id,
    p_category_snapshot: categorySnapshot(event.category_id, categories) as unknown as Json,
    p_contact_assignment: event.contact_assignment,
    p_created_by: input.createdBy ?? null,
    p_contact_id: input.contactId ?? null,
    p_metadata: (input.metadata ?? {}) as unknown as Json,
  });

  if (error) {
    // 23P01 = la exclusion: otro pedido gano la carrera por el mismo horario.
    if (error.code === "23P01") return { ok: false, status: 409, reason: "slot_taken", message: "Ese horario se acaba de ocupar." };
    console.error("[agenda] create_booking fallo:", error.message);
    return { ok: false, status: 500, reason: "temporarily_unavailable" };
  }

  const result = data as unknown as { booking_id: string; contact_id: string };
  return {
    ok: true,
    uid,
    bookingId: result.booking_id,
    contactId: result.contact_id,
    startUtc: input.startUtc,
    endUtc,
    redirectUrl: event.success_redirect_url,
  };
}

/** El pais por defecto del selector de telefono, desde la zona del negocio. */
export function countryFromTimezone(timezone: string | null): string | undefined {
  const map: Record<string, string> = {
    "America/Costa_Rica": "CR",
    "America/Mexico_City": "MX",
    "America/Argentina/Buenos_Aires": "AR",
    "America/Bogota": "CO",
    "America/Lima": "PE",
    "America/Santiago": "CL",
    "Europe/Madrid": "ES",
  };
  return timezone ? map[timezone] : undefined;
}

/** La hora de pared del inicio, en la zona que se pida. Para los mensajes. */
export function wallTimeOf(startUtc: string, tz: string): string {
  const minutes = new Date(startUtc).getTime();
  void minutes;
  return minutesToWallTime(
    Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz }).format(new Date(startUtc)).split(":")[0]) * 60 +
      Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz }).format(new Date(startUtc)).split(":")[1]),
  );
}
