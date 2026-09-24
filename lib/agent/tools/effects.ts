import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json, LeadTemperature } from "@/lib/types/database";
import { logAudit } from "@/lib/audit";

/**
 * Los efectos de negocio que el agente puede producir sobre el CRM.
 *
 * Viven aparte de las herramientas por una razon: la clasificacion al cierre
 * de una conversacion (F34) aplica tags, temperatura y seguimiento con LAS
 * MISMAS reglas que las herramientas (lista blanca, si puede bajar la
 * temperatura, maximo de dias, si puede pisar una fecha manual). Un solo lugar
 * valida contra la configuracion; la herramienta y el cierre lo llaman.
 *
 * Cada efecto deja su entrada en audit_log con performed_by_agent_id y una
 * metadata uniforme (origin, run_id, conversation_id, contact_id, channel_id):
 * es lo que permite armar la vista de Acciones sobre el audit_log, filtrarla
 * por canal, y revertir cada accion desde ahi. Nunca crea tags, nunca asigna a
 * alguien que no es miembro, nunca escribe fuera de los limites configurados.
 */

type Db = SupabaseClient<Database>;

export interface EffectContext {
  supabase: Db;
  workspaceId: string;
  agentId: string;
  runId: string | null;
  conversationId: string | null;
  contactId: string | null;
  channelId: string | null;
  /** Quien pidio el efecto: la herramienta en un turno, o la clasificacion al cierre. */
  origin: "tool" | "close_classification";
}

export interface EffectResult {
  ok: boolean;
  /** Lo que vuelve al modelo (o queda en el paso), en lenguaje llano. */
  message: string;
  auditLogId?: string | null;
  detail?: Record<string, Json>;
}

function auditMeta(ctx: EffectContext, extra: Record<string, Json> = {}): Record<string, Json> {
  return {
    origin: ctx.origin,
    run_id: ctx.runId,
    conversation_id: ctx.conversationId,
    contact_id: ctx.contactId,
    channel_id: ctx.channelId,
    agent_id: ctx.agentId,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Etiquetar
// ---------------------------------------------------------------------------

export interface TagEffectConfig {
  allowedTagIds: string[];
  canRemove: boolean;
}

/**
 * Agrega y quita tags de la lista blanca. Los nombres se comparan sin
 * distinguir mayusculas. Un nombre fuera de la lista se informa y NO se aplica;
 * nunca se crea un tag nuevo.
 */
export async function applyTags(
  ctx: EffectContext,
  config: TagEffectConfig,
  input: { add: string[]; remove: string[]; reason?: string | null },
): Promise<EffectResult> {
  if (!ctx.contactId) return { ok: false, message: "No hay un contacto al que etiquetar." };
  if (config.allowedTagIds.length === 0) {
    return { ok: false, message: "No hay etiquetas habilitadas para el agente." };
  }

  // Solo la lista blanca, y solo los que sigan existiendo en el workspace.
  const { data: allowedRows, error: tagsError } = await ctx.supabase
    .from("tags")
    .select("id, name")
    .eq("workspace_id", ctx.workspaceId)
    .in("id", config.allowedTagIds);
  if (tagsError) return { ok: false, message: "No pude leer las etiquetas." };
  const allowed = allowedRows ?? [];
  const byName = new Map(allowed.map((t) => [t.name.trim().toLowerCase(), t]));

  const resolve = (names: string[]) => {
    const found: Array<{ id: string; name: string }> = [];
    const rejected: string[] = [];
    for (const raw of names) {
      const tag = byName.get(raw.trim().toLowerCase());
      if (tag) found.push(tag);
      else rejected.push(raw.trim());
    }
    return { found, rejected };
  };
  const toAdd = resolve(input.add ?? []);
  const toRemove = config.canRemove ? resolve(input.remove ?? []) : { found: [], rejected: [] };
  const removeDenied = !config.canRemove && (input.remove ?? []).length > 0;

  const { data: currentRows } = await ctx.supabase.from("contact_tags").select("tag_id").eq("contact_id", ctx.contactId);
  const current = new Set((currentRows ?? []).map((r) => r.tag_id));

  const addIds = toAdd.found.map((t) => t.id).filter((id) => !current.has(id));
  const removeIds = toRemove.found.map((t) => t.id).filter((id) => current.has(id));

  if (addIds.length > 0) {
    const { error } = await ctx.supabase
      .from("contact_tags")
      .insert(addIds.map((tag_id) => ({ contact_id: ctx.contactId as string, tag_id })));
    if (error) return { ok: false, message: "No pude agregar las etiquetas." };
  }
  if (removeIds.length > 0) {
    const { error } = await ctx.supabase.from("contact_tags").delete().eq("contact_id", ctx.contactId).in("tag_id", removeIds);
    if (error) return { ok: false, message: "No pude quitar las etiquetas." };
  }

  const notes: string[] = [];
  if (addIds.length > 0) notes.push(`agregue: ${toAdd.found.filter((t) => addIds.includes(t.id)).map((t) => t.name).join(", ")}`);
  if (removeIds.length > 0) notes.push(`quite: ${toRemove.found.filter((t) => removeIds.includes(t.id)).map((t) => t.name).join(", ")}`);
  const rejected = [...toAdd.rejected, ...toRemove.rejected];
  if (rejected.length > 0) notes.push(`no estan en la lista permitida y no se aplicaron: ${rejected.join(", ")}`);
  if (removeDenied) notes.push("no tenes permitido quitar etiquetas");

  if (addIds.length === 0 && removeIds.length === 0) {
    return { ok: rejected.length === 0 && !removeDenied, message: notes.length ? notes.join("; ") : "Sin cambios: ya estaba asi.", detail: { rejected } };
  }

  const before = [...current];
  const after = [...new Set([...before.filter((id) => !removeIds.includes(id)), ...addIds])];
  const auditLogId = await logAudit({
    supabase: ctx.supabase,
    workspaceId: ctx.workspaceId,
    entityType: "contact",
    entityId: ctx.contactId,
    action: "tag",
    changes: { tags: { old: before.join(",") || null, new: after.join(",") || null } },
    metadata: auditMeta(ctx, { added: addIds, removed: removeIds, rejected, reason: input.reason ?? null }),
    performedByAgentId: ctx.agentId,
  });

  return { ok: true, message: `Listo: ${notes.join("; ")}.`, auditLogId, detail: { added: addIds, removed: removeIds, rejected } };
}

// ---------------------------------------------------------------------------
// Temperatura
// ---------------------------------------------------------------------------

export interface TemperatureEffectConfig {
  canLower: boolean;
}

export const TEMPERATURE_ORDER: Record<LeadTemperature, number> = { cold: 0, warm: 1, hot: 2 };

export async function setTemperature(
  ctx: EffectContext,
  config: TemperatureEffectConfig,
  input: { temperature: LeadTemperature; reason?: string | null },
): Promise<EffectResult> {
  if (!ctx.contactId) return { ok: false, message: "No hay un contacto." };
  const { data: contact } = await ctx.supabase.from("contacts").select("lead_temperature").eq("id", ctx.contactId).maybeSingle();
  if (!contact) return { ok: false, message: "No encontre el contacto." };

  const current = (contact.lead_temperature ?? null) as LeadTemperature | null;
  if (current === input.temperature) return { ok: true, message: `La temperatura ya era ${input.temperature}.` };
  if (current && !config.canLower && TEMPERATURE_ORDER[input.temperature] < TEMPERATURE_ORDER[current]) {
    return { ok: false, message: `No tenes permitido bajar la temperatura (esta en ${current}). Solo podes subirla.` };
  }

  const { error } = await ctx.supabase.from("contacts").update({ lead_temperature: input.temperature }).eq("id", ctx.contactId);
  if (error) return { ok: false, message: "No pude cambiar la temperatura." };

  const auditLogId = await logAudit({
    supabase: ctx.supabase,
    workspaceId: ctx.workspaceId,
    entityType: "contact",
    entityId: ctx.contactId,
    action: "temperature",
    changes: { lead_temperature: { old: current, new: input.temperature } },
    metadata: auditMeta(ctx, { reason: input.reason ?? null }),
    performedByAgentId: ctx.agentId,
  });
  return { ok: true, message: `Listo: temperatura ${current ?? "sin definir"} → ${input.temperature}.`, auditLogId };
}

// ---------------------------------------------------------------------------
// Proximo seguimiento
// ---------------------------------------------------------------------------

export interface FollowupEffectConfig {
  maxDaysAhead: number;
  canOverrideManual: boolean;
}

const DAY_MS = 86_400_000;

/**
 * "Puesta a mano" = la ultima entrada del audit que toco next_followup_date la
 * hizo una persona (performed_by) y no el agente. Se mira en memoria sobre las
 * ultimas entradas del contacto, sin filtros por JSON en la consulta.
 */
export async function isFollowupManual(supabase: Db, contactId: string): Promise<boolean> {
  const { data } = await supabase
    .from("audit_log")
    .select("changes, performed_by, performed_by_agent_id")
    .eq("entity_type", "contact")
    .eq("entity_id", contactId)
    .order("performed_at", { ascending: false })
    .limit(50);
  for (const row of data ?? []) {
    const changes = row.changes as Record<string, unknown> | null;
    if (changes && Object.prototype.hasOwnProperty.call(changes, "next_followup_date")) {
      return Boolean(row.performed_by) && !row.performed_by_agent_id;
    }
  }
  return false;
}

export async function setFollowup(
  ctx: EffectContext,
  config: FollowupEffectConfig,
  input: { days?: number | null; date?: string | null; reason?: string | null; now?: Date },
): Promise<EffectResult> {
  if (!ctx.contactId) return { ok: false, message: "No hay un contacto." };
  const now = input.now ?? new Date();

  let target: Date;
  if (input.date) {
    const parsed = new Date(`${input.date}T12:00:00Z`);
    if (Number.isNaN(parsed.getTime())) return { ok: false, message: "La fecha no es valida (usa AAAA-MM-DD)." };
    target = parsed;
  } else if (typeof input.days === "number" && Number.isFinite(input.days)) {
    target = new Date(now.getTime() + Math.round(input.days) * DAY_MS);
  } else {
    return { ok: false, message: "Indica en cuantos dias o en que fecha." };
  }

  const daysAhead = Math.ceil((target.getTime() - now.getTime()) / DAY_MS);
  if (daysAhead < 0) return { ok: false, message: "La fecha de seguimiento no puede estar en el pasado." };
  if (daysAhead > config.maxDaysAhead) {
    return { ok: false, message: `El seguimiento no puede ser a mas de ${config.maxDaysAhead} dias.` };
  }

  const { data: contact } = await ctx.supabase.from("contacts").select("next_followup_date").eq("id", ctx.contactId).maybeSingle();
  if (!contact) return { ok: false, message: "No encontre el contacto." };

  if (contact.next_followup_date && !config.canOverrideManual && (await isFollowupManual(ctx.supabase, ctx.contactId))) {
    return { ok: false, message: "Ya hay una fecha de seguimiento puesta por una persona y no tenes permitido pisarla." };
  }

  const iso = target.toISOString();
  const { error } = await ctx.supabase.from("contacts").update({ next_followup_date: iso }).eq("id", ctx.contactId);
  if (error) return { ok: false, message: "No pude guardar el seguimiento." };

  const auditLogId = await logAudit({
    supabase: ctx.supabase,
    workspaceId: ctx.workspaceId,
    entityType: "contact",
    entityId: ctx.contactId,
    action: "followup",
    changes: { next_followup_date: { old: contact.next_followup_date ?? null, new: iso } },
    metadata: auditMeta(ctx, { days_ahead: daysAhead, reason: input.reason ?? null }),
    performedByAgentId: ctx.agentId,
  });
  return { ok: true, message: `Listo: proximo seguimiento en ${daysAhead} dia${daysAhead === 1 ? "" : "s"} (${iso.slice(0, 10)}).`, auditLogId };
}

// ---------------------------------------------------------------------------
// Asignar conversacion
// ---------------------------------------------------------------------------

export type AssignStrategy = "round_robin" | "fixed" | "contact_setter";

export interface AssignEffectConfig {
  allowedUserIds: string[];
  strategy: AssignStrategy;
  fixedUserId: string | null;
}

/** Miembros vigentes del workspace entre los ids dados. */
async function membersAmong(supabase: Db, workspaceId: string, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { data } = await supabase.from("workspace_members").select("user_id").eq("workspace_id", workspaceId).in("user_id", ids);
  return new Set((data ?? []).map((m) => m.user_id));
}

/**
 * Elige a quien asignar segun el criterio. Round-robin sin estado nuevo: el
 * habilitado cuya ultima asignacion hecha por el agente (audit) sea mas vieja,
 * o que nunca recibio una.
 */
export async function pickAssignee(ctx: EffectContext, config: AssignEffectConfig): Promise<{ userId: string | null; why: string }> {
  const members = await membersAmong(ctx.supabase, ctx.workspaceId, [
    ...config.allowedUserIds,
    ...(config.fixedUserId ? [config.fixedUserId] : []),
  ]);
  const allowed = config.allowedUserIds.filter((id) => members.has(id));

  if (config.strategy === "contact_setter") {
    if (!ctx.contactId) return { userId: null, why: "sin contacto" };
    const { data: contact } = await ctx.supabase.from("contacts").select("setter_id").eq("id", ctx.contactId).maybeSingle();
    const setter = contact?.setter_id ?? null;
    if (!setter) return { userId: null, why: "el contacto no tiene setter" };
    const setterOk = (await membersAmong(ctx.supabase, ctx.workspaceId, [setter])).has(setter);
    return setterOk ? { userId: setter, why: "el setter del contacto" } : { userId: null, why: "el setter ya no es miembro" };
  }

  if (config.strategy === "fixed") {
    const fixed = config.fixedUserId && members.has(config.fixedUserId) && allowed.includes(config.fixedUserId) ? config.fixedUserId : null;
    return fixed ? { userId: fixed, why: "usuario fijo" } : { userId: null, why: "el usuario fijo no esta habilitado o no es miembro" };
  }

  if (allowed.length === 0) return { userId: null, why: "no hay usuarios habilitados" };
  if (allowed.length === 1) return { userId: allowed[0], why: "unico habilitado" };

  const { data: recent } = await ctx.supabase
    .from("audit_log")
    .select("changes, performed_at")
    .eq("workspace_id", ctx.workspaceId)
    .eq("entity_type", "conversation")
    .eq("action", "assign")
    .not("performed_by_agent_id", "is", null)
    .order("performed_at", { ascending: false })
    .limit(200);
  const lastAt = new Map<string, string>();
  for (const row of recent ?? []) {
    const changes = row.changes as { assigned_to?: { new?: unknown } } | null;
    const to = changes?.assigned_to?.new;
    if (typeof to === "string" && !lastAt.has(to)) lastAt.set(to, row.performed_at ?? "");
  }
  const never = allowed.find((id) => !lastAt.has(id));
  if (never) return { userId: never, why: "round-robin: nunca recibio una" };
  const oldest = [...allowed].sort((a, b) => (lastAt.get(a) as string).localeCompare(lastAt.get(b) as string))[0];
  return { userId: oldest, why: "round-robin: hace mas que no recibe una" };
}

export async function assignConversation(
  ctx: EffectContext,
  config: AssignEffectConfig,
  input: { reason?: string | null },
): Promise<EffectResult> {
  if (!ctx.conversationId) return { ok: false, message: "No hay una conversacion." };
  const pick = await pickAssignee(ctx, config);
  if (!pick.userId) return { ok: false, message: `No pude asignar: ${pick.why}.` };

  const { data: conversation } = await ctx.supabase.from("conversations").select("assigned_to").eq("id", ctx.conversationId).maybeSingle();
  if (!conversation) return { ok: false, message: "No encontre la conversacion." };
  const previous = conversation.assigned_to ?? null;
  if (previous === pick.userId) return { ok: true, message: "Ya estaba asignada a esa persona." };

  const { error } = await ctx.supabase.from("conversations").update({ assigned_to: pick.userId }).eq("id", ctx.conversationId);
  if (error) return { ok: false, message: "No pude asignar la conversacion." };

  const auditLogId = await logAudit({
    supabase: ctx.supabase,
    workspaceId: ctx.workspaceId,
    entityType: "conversation",
    entityId: ctx.conversationId,
    action: "assign",
    changes: { assigned_to: { old: previous, new: pick.userId } },
    metadata: auditMeta(ctx, { strategy: config.strategy, why: pick.why, reason: input.reason ?? null }),
    performedByAgentId: ctx.agentId,
  });
  return { ok: true, message: `Listo: la conversacion quedo asignada (${pick.why}).`, auditLogId, detail: { assigned_to: pick.userId } };
}

// ---------------------------------------------------------------------------
// Pausarse
// ---------------------------------------------------------------------------

export interface PauseEffectConfig {
  maxMinutes: number;
  autoResume: boolean;
}

export async function pauseAgentInConversation(
  ctx: EffectContext,
  config: PauseEffectConfig,
  input: { minutes: number; reason?: string | null; now?: Date },
): Promise<EffectResult> {
  if (!ctx.conversationId) return { ok: false, message: "No hay una conversacion." };
  const now = input.now ?? new Date();
  const minutes = Math.min(Math.max(1, Math.round(input.minutes)), config.maxMinutes);
  const until = config.autoResume ? new Date(now.getTime() + minutes * 60_000).toISOString() : "infinity";

  const { data: before } = await ctx.supabase.from("conversations").select("agent_paused_until").eq("id", ctx.conversationId).maybeSingle();
  if (!before) return { ok: false, message: "No encontre la conversacion." };

  const { error } = await ctx.supabase.from("conversations").update({ agent_paused_until: until }).eq("id", ctx.conversationId);
  if (error) return { ok: false, message: "No pude pausar." };

  const auditLogId = await logAudit({
    supabase: ctx.supabase,
    workspaceId: ctx.workspaceId,
    entityType: "conversation",
    entityId: ctx.conversationId,
    action: "agent_paused",
    changes: { agent_paused_until: { old: before.agent_paused_until ?? null, new: until } },
    metadata: auditMeta(ctx, { minutes, auto_resume: config.autoResume, reason: input.reason ?? null }),
    performedByAgentId: ctx.agentId,
  });
  const clipped = minutes < Math.round(input.minutes) ? ` (el maximo permitido es ${config.maxMinutes} minutos)` : "";
  return {
    ok: true,
    message: config.autoResume
      ? `Listo: quedas en pausa ${minutes} minutos${clipped}; despues volves a atender solo.`
      : "Listo: quedas en pausa hasta que una persona o un flow te reanude.",
    auditLogId,
    detail: { until, minutes },
  };
}
