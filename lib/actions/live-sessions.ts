"use server";
// @plantilla-quitar(servicios)

import { revalidatePath } from "next/cache";
import { getPermissionAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { svcRpc, svcSchema, type SvcResult } from "@/lib/services/db";
import { wallClockToUtc } from "@/lib/scheduling/time/tz";
import type { DateString, WallTime } from "@/lib/scheduling/types";
import { liveDateIssues, liveSessionIssues, liveSessionPayload, type LiveSessionInput } from "@/lib/program/live-sessions";
import { addToPortalPlan, type AddToPortalChoice, type CallForPortal } from "@/lib/program/add-to-portal";
import { saveLessonTranscriptCore } from "@/lib/program/transcript-store";
import { sanitizeSearch } from "@/lib/url-params";

/**
 * El Calendario del programa (bloque CA, F58-F65). Las sesiones y sus fechas piden `live_sessions.manage`; marcar y
 * quitar asistencias, `attendance.manage`; «Agregar al portal» desde Grabaciones, `recordings.to_portal` (y, para
 * escribir, la clave de lo que crea). Las funciones de la base vuelven a pedir la clave con la sesión.
 */

const NOT_ALLOWED = { ok: false as const, error: { code: "SV004", message: "No tenés permiso para hacer esto", detail: null } };
const fail = (message: string) => ({ ok: false as const, error: { code: "CA001", message, detail: null } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const refresh = (productId: string) => revalidatePath(`/dashboard/portal/${productId}`);

/** «2026-11-20T19:00» en la zona `tz` → ISO en UTC. */
function localToUtc(local: string, tz: string): string {
  const [d, t] = local.split("T");
  return wallClockToUtc(d as DateString, t as WallTime, tz).toISOString();
}

export async function saveLiveSession(productId: string, sessionId: string | null, input: LiveSessionInput): Promise<SvcResult<string>> {
  const ctx = await getPermissionAction("live_sessions.manage");
  if (!ctx || !UUID.test(productId) || (sessionId && !UUID.test(sessionId))) return NOT_ALLOWED;
  const issues = liveSessionIssues(input);
  if (issues.length) return fail(issues.join(". "));
  let payload: Record<string, unknown>;
  try {
    payload = liveSessionPayload(input, localToUtc);
  } catch {
    return fail("La zona horaria no es válida");
  }
  const res = await svcRpc<string>(ctx.supabase, "live_session_save", { p_product_id: productId, p_session_id: sessionId, p: payload });
  if (res.ok) refresh(productId);
  return res;
}

export async function archiveLiveSession(productId: string, sessionId: string, archived: boolean): Promise<SvcResult<null>> {
  const ctx = await getPermissionAction("live_sessions.manage");
  if (!ctx || !UUID.test(sessionId)) return NOT_ALLOWED;
  const res = await svcRpc<null>(ctx.supabase, "live_session_archive", { p_live_session_id: sessionId, p_archived: archived });
  if (res.ok) refresh(productId);
  return res;
}

export interface LiveDatePatch {
  status?: "normal" | "cancelled" | "moved";
  /** Mover: la fecha y hora nuevas, en la zona de la sesión. */
  movedToLocal?: string | null;
  recordingUrl?: string | null;
  recordingCallId?: string | null;
  recordingActive?: boolean;
  note?: string | null;
}

/** Cancelar, mover, o cargar la grabación de UNA fecha. Lo que carga una persona es `manual` y ningún proceso lo pisa. */
export async function saveLiveDate(productId: string, sessionId: string, occursOn: string, patch: LiveDatePatch): Promise<SvcResult<null>> {
  const ctx = await getPermissionAction("live_sessions.manage");
  if (!ctx || !UUID.test(sessionId) || !DATE.test(occursOn) || (patch.recordingCallId && !UUID.test(patch.recordingCallId))) return NOT_ALLOWED;
  const issues = liveDateIssues(patch);
  if (issues.length) return fail(issues.join(". "));
  const p: Record<string, unknown> = {};
  if (patch.status) p.status = patch.status;
  if (patch.status === "moved") {
    const { data: s } = await svcSchema(ctx.supabase).from("live_sessions").select("timezone").eq("id", sessionId).eq("workspace_id", ctx.workspace.id).maybeSingle();
    if (!s) return NOT_ALLOWED;
    p.moved_to = localToUtc(patch.movedToLocal as string, (s as { timezone: string }).timezone);
  } else if (patch.status) p.moved_to = null;
  if ("recordingUrl" in patch || "recordingCallId" in patch) {
    const url = (patch.recordingUrl ?? "").trim() || null;
    const call = patch.recordingCallId || null;
    Object.assign(p, { recording_url: url, recording_call_id: call, recording_source: url || call ? (call ? "fathom" : "manual") : null });
  }
  if (typeof patch.recordingActive === "boolean") p.recording_active = patch.recordingActive;
  if ("note" in patch) p.note = (patch.note ?? "").trim() || null;
  const res = await svcRpc<null>(ctx.supabase, "live_date_save", { p_live_session_id: sessionId, p_occurs_on: occursOn, p });
  if (res.ok) refresh(productId);
  return res;
}

export async function markAttendance(productId: string, sessionId: string, occursOn: string, contactId: string): Promise<SvcResult<string>> {
  const ctx = await getPermissionAction("attendance.manage");
  if (!ctx || !UUID.test(sessionId) || !DATE.test(occursOn) || !UUID.test(contactId)) return NOT_ALLOWED;
  const res = await svcRpc<string>(ctx.supabase, "attendance_mark", { p_live_session_id: sessionId, p_occurs_on: occursOn, p_contact_id: contactId, p_source: "team" });
  if (res.ok) refresh(productId);
  return res;
}

export async function removeAttendance(productId: string, attendanceId: string, reason: string): Promise<SvcResult<null>> {
  const ctx = await getPermissionAction("attendance.manage");
  if (!ctx || !UUID.test(attendanceId)) return NOT_ALLOWED;
  if (!reason.trim()) return fail("Escribí el motivo");
  const res = await svcRpc<null>(ctx.supabase, "attendance_remove", { p_attendance_id: attendanceId, p_reason: reason.trim() });
  if (res.ok) refresh(productId);
  return res;
}

export interface SessionSheet {
  base: string[];
  attended: Array<{ id: string; contact_id: string; source: "self" | "team" | "click"; added_manually: boolean }>;
  clicks: Array<{ contact_id: string | null; clicked_at: string }>;
  contacts: Record<string, { name: string; email: string | null }>;
}

/** La ficha de una fecha pasada: la base, quiénes asistieron, los clics y los nombres (que la persona puede ver). */
export async function loadSessionSheet(sessionId: string, occursOn: string): Promise<SvcResult<SessionSheet>> {
  const ctx = await getPermissionAction("portal.view").then((c) => c ?? getPermissionAction("attendance.manage")).then((c) => c ?? getPermissionAction("live_sessions.manage"));
  if (!ctx || !UUID.test(sessionId) || !DATE.test(occursOn)) return NOT_ALLOWED;
  const res = await svcRpc<Omit<SessionSheet, "contacts"> | null>(ctx.supabase, "live_session_attendance", { p_live_session_id: sessionId, p_occurs_on: occursOn });
  if (!res.ok) return res;
  const d = res.data ?? { base: [], attended: [], clicks: [] };
  const ids = [...new Set([...d.base, ...d.attended.map((a) => a.contact_id), ...d.clicks.map((c) => c.contact_id).filter((x): x is string => !!x)])];
  const contacts: SessionSheet["contacts"] = {};
  if (ids.length) {
    const { data } = await ctx.supabase.from("contacts").select("id, display_name, email").in("id", ids.slice(0, 1000));
    for (const c of (data ?? []) as Array<{ id: string; display_name: string | null; email: string | null }>) contacts[c.id] = { name: c.display_name || c.email || "Sin nombre", email: c.email };
  }
  return { ok: true, data: { ...d, contacts } };
}

/**
 * «Agregar un estudiante que asistió»: estudiantes con un servicio activo del negocio (otra variante, sin acceso ese
 * día, fuera de la base) que no están en la lista. Cada uno dice si cuenta para el promedio. Lee con la sesión.
 */
export async function searchStudentsForAttendance(sessionId: string, occursOn: string, query: string): Promise<SvcResult<Array<{ contactId: string; name: string; email: string | null; inBase: boolean }>>> {
  const ctx = await getPermissionAction("attendance.manage");
  if (!ctx || !UUID.test(sessionId) || !DATE.test(occursOn)) return NOT_ALLOWED;
  const q = sanitizeSearch(query, 60);
  if (q.length < 2) return { ok: true, data: [] };
  const sheet = await svcRpc<{ base: string[]; attended: Array<{ contact_id: string }> } | null>(ctx.supabase, "live_session_attendance", { p_live_session_id: sessionId, p_occurs_on: occursOn });
  if (!sheet.ok) return sheet;
  const base = new Set(sheet.data?.base ?? []);
  const attended = new Set((sheet.data?.attended ?? []).map((a) => a.contact_id));
  const { data: services } = await svcSchema(ctx.supabase).from("services").select("contact_id").eq("workspace_id", ctx.workspace.id).in("status", ["active", "paused"]).limit(2000);
  const ids = [...new Set(((services ?? []) as Array<{ contact_id: string }>).map((s) => s.contact_id))].filter((id) => !attended.has(id));
  if (!ids.length) return { ok: true, data: [] };
  const { data } = await ctx.supabase.from("contacts").select("id, display_name, email").eq("workspace_id", ctx.workspace.id).is("deleted_at", null).in("id", ids.slice(0, 1000)).or(`display_name.ilike.%${q}%,email.ilike.%${q}%`).limit(10);
  return {
    ok: true,
    data: ((data ?? []) as Array<{ id: string; display_name: string | null; email: string | null }>).map((c) => ({ contactId: c.id, name: c.display_name || c.email || "Sin nombre", email: c.email, inBase: base.has(c.id) })),
  };
}

/** «Vincular un Fathom»: las grabaciones del negocio de ese día y hora (±12 h), las que la persona puede ver. */
export async function suggestRecordings(startsAt: string): Promise<SvcResult<Array<{ id: string; title: string; recorded_at: string }>>> {
  const ctx = await getPermissionAction("live_sessions.manage");
  const at = Date.parse(startsAt);
  if (!ctx || Number.isNaN(at)) return NOT_ALLOWED;
  const { data } = await ctx.supabase
    .from("calls")
    .select("id, title, recorded_at")
    .eq("workspace_id", ctx.workspace.id)
    .gte("recorded_at", new Date(at - 12 * 3600_000).toISOString())
    .lte("recorded_at", new Date(at + 12 * 3600_000).toISOString())
    .order("recorded_at")
    .limit(10);
  return { ok: true, data: (data ?? []) as Array<{ id: string; title: string; recorded_at: string }> };
}

/**
 * «Agregar al portal» desde Grabaciones (F65): como grabación de una clase en vivo (la fecha guarda `recording_call_id`)
 * o como clase nueva (guarda `source_call_id`, y la transcripción va a Conocimiento con el segundo de cada parte).
 */
export async function addRecordingToPortal(callId: string, choice: AddToPortalChoice): Promise<SvcResult<{ warning: string | null; itemId: string | null }>> {
  const ctx = await getPermissionAction("recordings.to_portal");
  if (!ctx || !UUID.test(callId)) return NOT_ALLOWED;
  const needs = choice.target.kind === "live" ? "live_sessions.manage" : "program.manage";
  if (!(await getPermissionAction(needs))) return NOT_ALLOWED;
  const { data: c } = await ctx.supabase.from("calls").select("id, title, recorded_at, transcript").eq("id", callId).eq("workspace_id", ctx.workspace.id).maybeSingle();
  if (!c) return NOT_ALLOWED;
  const plan = addToPortalPlan(c as unknown as CallForPortal, choice);
  if (!plan.ok) return fail(plan.issues.join(". "));
  let moduleId: string | null = null;
  let itemId: string | null = null;
  for (const step of plan.steps) {
    if (step.op === "live_date") {
      const r = await saveLiveDate(choice.productId, step.sessionId, step.occursOn, { recordingCallId: step.callId, recordingUrl: step.recordingUrl });
      if (!r.ok) return r;
    } else if (step.op === "create_module") {
      const r = await svcRpc<string>(ctx.supabase, "program_create_item", { p_product_id: choice.productId, p: { kind: "module", parent_id: null, lesson_type: null, title: step.title } });
      if (!r.ok) return r;
      moduleId = r.data;
    } else if (step.op === "create_lesson") {
      const parent = step.parent === "new_module" ? moduleId : step.parent;
      const r = await svcRpc<string>(ctx.supabase, "program_create_item", { p_product_id: choice.productId, p: { kind: "lesson", parent_id: parent, lesson_type: "video", title: step.title } });
      if (!r.ok) return r;
      itemId = r.data;
    } else if (step.op === "update_lesson") {
      const r = await svcRpc<null>(ctx.supabase, "program_update_item", { p_item_id: itemId, p: step.patch });
      if (!r.ok) return r;
    } else if (step.op === "activate_lesson") {
      const r = await svcRpc<number>(ctx.supabase, "program_set_status", { p_item_id: itemId, p_status: "active", p_children: false });
      if (!r.ok) return r;
    } else if (step.op === "index_transcript" && itemId) {
      // La transcripción no frena el alta: si falla, la clase queda y se puede subir después a mano.
      await saveLessonTranscriptCore(ctx, choice.productId, itemId, step.vtt, "vtt").catch((e) => console.error("[add-to-portal] transcripcion", e instanceof Error ? e.message : "error"));
    }
  }
  refresh(choice.productId);
  revalidatePath("/dashboard/llamadas");
  return { ok: true, data: { warning: plan.warning, itemId } };
}

/** Dónde está ya una grabación en el portal (para «Ver en el portal» y «Ya está en…»). */
export async function recordingPortalPlaces(callId: string): Promise<SvcResult<Array<{ productId: string; productName: string; where: string }>>> {
  const ctx = await getPermissionAction("recordings.to_portal");
  if (!ctx || !UUID.test(callId)) return NOT_ALLOWED;
  const service = await createServiceClient();
  const [{ data: items }, { data: dates }] = await Promise.all([
    svcSchema(service).from("program_items").select("product_id, title").eq("workspace_id", ctx.workspace.id).eq("source_call_id", callId).neq("status", "archived"),
    svcSchema(service).from("live_session_dates").select("live_session_id, occurs_on").eq("workspace_id", ctx.workspace.id).eq("recording_call_id", callId),
  ]);
  const sessionIds = ((dates ?? []) as Array<{ live_session_id: string }>).map((d) => d.live_session_id);
  const { data: sessions } = sessionIds.length ? await svcSchema(service).from("live_sessions").select("id, product_id, title").in("id", sessionIds) : { data: [] };
  const sById = new Map(((sessions ?? []) as Array<{ id: string; product_id: string; title: string }>).map((s) => [s.id, s]));
  const places = [
    ...((items ?? []) as Array<{ product_id: string; title: string }>).map((i) => ({ productId: i.product_id, where: `Clase «${i.title}»` })),
    ...((dates ?? []) as Array<{ live_session_id: string; occurs_on: string }>).flatMap((d) => {
      const s = sById.get(d.live_session_id);
      return s ? [{ productId: s.product_id, where: `Grabación de «${s.title}» del ${d.occurs_on}` }] : [];
    }),
  ];
  const pIds = [...new Set(places.map((p) => p.productId))];
  const { data: products } = pIds.length ? await service.from("products").select("id, name").in("id", pIds).eq("workspace_id", ctx.workspace.id) : { data: [] };
  const pName = new Map(((products ?? []) as Array<{ id: string; name: string }>).map((p) => [p.id, p.name]));
  return { ok: true, data: places.filter((p) => pName.has(p.productId)).map((p) => ({ ...p, productName: pName.get(p.productId) as string })) };
}

/** Lo que pide el asistente para elegir: programas con portal, sus módulos y sus sesiones (con las fechas cercanas a la grabación). */
export async function portalTargets(callId: string): Promise<SvcResult<{
  recordedAt: string;
  title: string;
  programs: Array<{ id: string; name: string; modules: Array<{ id: string; title: string; kind: string }>; sessions: Array<{ id: string; title: string; occurrences: Array<{ occurs_on: string; starts_at: string; status: string }> }> }>;
}>> {
  const ctx = await getPermissionAction("recordings.to_portal");
  if (!ctx || !UUID.test(callId)) return NOT_ALLOWED;
  const { data: call } = await ctx.supabase.from("calls").select("title, recorded_at").eq("id", callId).eq("workspace_id", ctx.workspace.id).maybeSingle();
  if (!call) return NOT_ALLOWED;
  const c = call as { title: string; recorded_at: string };
  const { data: products } = await ctx.supabase.from("products").select("id, name").eq("workspace_id", ctx.workspace.id).eq("portal_enabled" as never, true as never).is("archived_at", null).order("name");
  const ps = (products ?? []) as Array<{ id: string; name: string }>;
  const ids = ps.map((p) => p.id);
  const day = c.recorded_at.slice(0, 10);
  const from = new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const to = new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const [{ data: mods }, { data: sess }] = ids.length
    ? await Promise.all([
        svcSchema(ctx.supabase).from("program_items").select("id, product_id, title, kind, position").in("product_id", ids).in("kind", ["module", "submodule"]).neq("status", "archived").order("position"),
        svcSchema(ctx.supabase).from("live_sessions").select("id, product_id, title").in("product_id", ids).is("archived_at", null),
      ])
    : [{ data: [] }, { data: [] }];
  const programs = await Promise.all(
    ps.map(async (p) => {
      const occ = await svcRpc<Array<{ live_session_id: string; occurs_on: string; starts_at: string; status: string }>>(ctx.supabase, "live_session_occurrences", { p_product_id: p.id, p_from: from, p_to: to });
      const list = occ.ok ? occ.data ?? [] : [];
      return {
        id: p.id,
        name: p.name,
        modules: ((mods ?? []) as Array<{ id: string; product_id: string; title: string; kind: string }>).filter((m) => m.product_id === p.id).map(({ id, title, kind }) => ({ id, title, kind })),
        sessions: ((sess ?? []) as Array<{ id: string; product_id: string; title: string }>)
          .filter((s) => s.product_id === p.id)
          .map((s) => ({ id: s.id, title: s.title, occurrences: list.filter((o) => o.live_session_id === s.id).map(({ occurs_on, starts_at, status }) => ({ occurs_on, starts_at, status })) })),
      };
    }),
  );
  return { ok: true, data: { recordedAt: c.recorded_at, title: c.title, programs } };
}
