"use server";

import { revalidatePath } from "next/cache";
import { getPermissionAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { countPeople } from "@/lib/calls/classification";
import { pickBooking, type BookingCandidate } from "@/lib/calls/linking";
import { IMPORT_LIMIT_PER_HOUR, parseTranscriptText, validateImportFile, validateImportText } from "@/lib/calls/transcript-import";
import { tsToSeconds } from "@/lib/calls/detail";
import { enqueueClassify } from "@/lib/calls/queue";

/**
 * Importar una llamada a mano (F11): pegar texto o subir un .vtt, .srt o .txt.
 * Con `calls.edit`. Se guarda como `source = 'manual'` y sigue el MISMO camino
 * que una de Fathom: vinculacion con la agenda y clasificacion.
 *
 * El tamaño y el tipo se validan ACA aunque el navegador ya lo haya hecho.
 */

export type ImportResult = { ok: true; id: string } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function importCall(formData: FormData): Promise<ImportResult> {
  const ctx = await getPermissionAction("calls.edit");
  if (!ctx) return { ok: false, error: "No tenés permiso para importar llamadas" };

  const title = String(formData.get("title") ?? "").trim();
  const recordedAtRaw = String(formData.get("recordedAt") ?? "");
  const closerId = String(formData.get("closerId") ?? "") || ctx.user.id;
  const contactId = String(formData.get("contactId") ?? "") || null;
  const pasted = String(formData.get("text") ?? "");
  const file = formData.get("file");

  if (title.length < 1 || title.length > 200) return { ok: false, error: "Poné un título de hasta 200 caracteres" };
  const recordedAt = new Date(recordedAtRaw);
  if (!recordedAtRaw || Number.isNaN(recordedAt.getTime())) return { ok: false, error: "La fecha de la llamada no es válida" };
  if (recordedAt.getTime() > Date.now() + 24 * 3600_000) return { ok: false, error: "La fecha de la llamada está en el futuro" };
  if (!UUID.test(closerId)) return { ok: false, error: "Elegí un closer" };
  if (contactId && !UUID.test(contactId)) return { ok: false, error: "El contacto no es válido" };

  // El texto: de un archivo o pegado. Se valida el tamaño ACA.
  let text = pasted;
  if (file instanceof File && file.size > 0) {
    const fileCheck = validateImportFile({ name: file.name, size: file.size });
    if (!fileCheck.ok) return fileCheck;
    text = await file.text();
  }
  const textCheck = validateImportText(text);
  if (!textCheck.ok) return textCheck;

  const transcript = parseTranscriptText(text);
  if (transcript.length === 0) return { ok: false, error: "No encontré texto para importar en ese contenido" };

  const service = await createServiceClient();

  // El limite por persona y por hora.
  const hourStart = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000).toISOString();
  const { data: bumped } = await service.rpc("bump_rate_limit", { p_key: `calls-import:${ctx.user.id}`, p_window_start: hourStart });
  if (typeof bumped === "number" && bumped > IMPORT_LIMIT_PER_HOUR) {
    return { ok: false, error: "Importaste muchas llamadas en esta hora. Probá de nuevo más tarde." };
  }

  // El closer tiene que ser del equipo.
  const { data: member } = await service
    .from("workspace_members")
    .select("user_id")
    .eq("workspace_id", ctx.workspace.id)
    .eq("user_id", closerId)
    .maybeSingle();
  if (!member) return { ok: false, error: "Ese closer no está en el equipo" };

  // El contacto, solo si quien importa lo ve (la RLS decide).
  if (contactId) {
    const { data: contact } = await ctx.supabase.from("contacts").select("id").eq("id", contactId).eq("workspace_id", ctx.workspace.id).is("deleted_at", null).maybeSingle();
    if (!contact) return { ok: false, error: "No encontré ese contacto" };
  }

  // Duracion: solo si la transcripcion trae tiempos.
  const seconds = transcript.map((l) => tsToSeconds(l.timestamp)).filter((n): n is number => n !== null);
  const duration = seconds.length > 0 ? Math.max(...seconds) : null;
  const counts = countPeople([], transcript);

  // La agenda del contacto en la ventana de ±4 h.
  let bookingId: string | null = null;
  if (contactId) {
    const at = recordedAt.getTime();
    const { data: bookings } = await service
      .from("bookings")
      .select("id, contact_id, host_user_id, start_at, created_at, booker_email, status_group")
      .eq("workspace_id", ctx.workspace.id)
      .eq("contact_id", contactId)
      .gte("start_at", new Date(at - 4 * 3600_000).toISOString())
      .lte("start_at", new Date(at + 4 * 3600_000).toISOString());
    bookingId = pickBooking({ recordedAt: recordedAt.toISOString(), recorderUserId: closerId, contactId, inviteeEmails: [] }, (bookings ?? []) as BookingCandidate[])?.id ?? null;
  }

  const { data, error } = await service
    .from("calls")
    .insert({
      workspace_id: ctx.workspace.id,
      source: "manual",
      external_id: null,
      title,
      recorded_at: recordedAt.toISOString(),
      duration_seconds: duration,
      recorded_by_user_id: closerId,
      attendees: [],
      transcript,
      participants_count: counts.participants,
      speakers_count: counts.speakers,
      people_count: counts.people,
      contact_id: contactId,
      booking_id: bookingId,
      link_method: contactId ? "manual" : "none",
      linked_by: contactId ? ctx.user.id : null,
      linked_at: contactId ? new Date().toISOString() : null,
      analysis_status: "classifying",
      created_by: ctx.user.id,
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("[llamadas] no pude guardar la importación:", error?.message);
    return { ok: false, error: "No pude guardar la llamada" };
  }

  await logAudit({
    supabase: ctx.supabase,
    workspaceId: ctx.workspace.id,
    entityType: "call",
    entityId: data.id,
    action: "call.imported",
    metadata: { lines: transcript.length, linked_contact: !!contactId, linked_booking: !!bookingId },
    performedBy: ctx.user.id,
  });
  try {
    await enqueueClassify(service, data.id, new Date());
  } catch (err) {
    console.error("[llamadas] la llamada se guardó pero no se pudo encolar la clasificación:", err instanceof Error ? err.message : "error");
  }

  revalidatePath("/dashboard/llamadas");
  return { ok: true, id: data.id };
}
