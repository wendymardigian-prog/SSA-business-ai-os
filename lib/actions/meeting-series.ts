"use server";
// @plantilla-quitar(servicios)

/**
 * La serie de reuniones del camino y las vueltas de Reunión (00524, traído de RER #71).
 *
 *  - Fijar la serie y «Cambiar día y hora»: `services.items` y ser quien atiende el paso, o poder agendar por otros
 *    (`scheduling.manage_others`). El paso se lee primero CON LA SESIÓN: si la persona no ve el servicio, no existe.
 *    Google lo hace `lib/scheduling/series/run.ts` con el cliente de servicio.
 *  - Marcar una vuelta (asistió, no se presentó, perdida): la base mira `services.items` con la sesión.
 * Nada se agenda solo: una persona elige siempre el día y la hora.
 */
import { revalidatePath } from "next/cache";
import { getPermissionAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { svcRpc, svcSchema, type SvcResult } from "@/lib/services/db";
import { changeSeriesTimeCore, fixMeetingSeriesCore, loadSeriesStep } from "@/lib/scheduling/series/run";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const NOT_ALLOWED = { ok: false as const, error: { code: "SV004", message: "No tenés permiso para hacer esto", detail: null } };
const bad = (message: string, code = "SV049") => ({ ok: false as const, error: { code, message, detail: null } });

function refresh() {
  revalidatePath("/dashboard/clientes", "layout");
  revalidatePath("/dashboard/tareas");
}

async function seriesContext(itemId: string) {
  if (!UUID.test(itemId)) return null;
  const ctx = await getPermissionAction("services.items");
  if (!ctx) return null;
  // Con la sesión: si no ve el servicio, el paso no existe para esta persona.
  const { data } = await svcSchema(ctx.supabase).from("service_items").select("id").eq("id", itemId).eq("workspace_id", ctx.workspace.id).maybeSingle();
  if (!data) return null;
  const service = await createServiceClient();
  const found = await loadSeriesStep(service, ctx.workspace.id, itemId);
  if (!found) return null;
  if (found.hostUserId !== ctx.user.id && !ctx.can("scheduling.manage_others")) return null;
  return { ctx, service };
}

function validWhen(input: { date: string; time: string; timezone: string }): string | null {
  if (!DATE.test(input.date ?? "")) return "Elegí el primer día.";
  if (!TIME.test(input.time ?? "")) return "Elegí la hora.";
  try {
    new Intl.DateTimeFormat("en", { timeZone: input.timezone });
  } catch {
    return "La zona horaria no es válida.";
  }
  return null;
}

/** «Fijar reuniones recurrentes»: el primer día y la hora; cada cuánto se repite viene del paso. */
export async function fixMeetingSeries(input: { itemId: string; date: string; time: string; timezone: string }): Promise<SvcResult<{ booked: number }>> {
  const c = await seriesContext(input.itemId);
  if (!c) return NOT_ALLOWED;
  const problem = validWhen(input);
  if (problem) return bad(problem);
  const r = await fixMeetingSeriesCore(c.service, { workspaceId: c.ctx.workspace.id, itemId: input.itemId, date: input.date, time: input.time, timezone: input.timezone, actorUserId: c.ctx.user.id });
  if (!r.ok) return bad(r.message, r.code === "no_google" ? "SV050" : "SV049");
  refresh();
  return { ok: true, data: { booked: r.booked } };
}

/** «Cambiar día y hora»: la serie cambia desde la próxima reunión; las pasadas no se tocan. */
export async function changeMeetingSeriesTime(input: { itemId: string; date: string; time: string; timezone: string }): Promise<SvcResult<{ booked: number }>> {
  const c = await seriesContext(input.itemId);
  if (!c) return NOT_ALLOWED;
  const problem = validWhen(input);
  if (problem) return bad(problem);
  const r = await changeSeriesTimeCore(c.service, { workspaceId: c.ctx.workspace.id, itemId: input.itemId, date: input.date, time: input.time, timezone: input.timezone, actorUserId: c.ctx.user.id });
  if (!r.ok) return bad(r.message, r.code === "no_google" ? "SV050" : "SV049");
  refresh();
  return { ok: true, data: { booked: r.booked } };
}

/** Marcar una vuelta de Reunión: asistió, no se presentó o perdida. La base mira el permiso con la sesión. */
export async function markMeetingRound(itemId: string, state: "attended" | "no_show" | "lost"): Promise<SvcResult<string>> {
  if (!UUID.test(itemId) || !["attended", "no_show", "lost"].includes(state)) return NOT_ALLOWED;
  const ctx = await getPermissionAction("services.items");
  if (!ctx) return NOT_ALLOWED;
  const r = await svcRpc<string>(ctx.supabase, "svc_round_mark", { p_item_id: itemId, p_state: state });
  if (r.ok) refresh();
  return r;
}
