import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuditAction, Database, Json } from "@/lib/types/database";
import { DATE_PRESETS, resolveDateRange, type DatePreset } from "@/lib/dates";
import { firstParam, pickEnum, pickPage, type SearchParams } from "@/lib/url-params";
import { REVERTIBLE_ACTIONS } from "./revert";
import type { ActionFilters, ActionRow } from "./screen";

/**
 * La pestana Acciones (F28): una fila por accion ejecutada por el agente,
 * armada sobre audit_log (performed_by_agent_id IS NOT NULL). Sin tabla nueva.
 *
 * Los filtros por canal, contacto y conversacion salen de `metadata`, que
 * todos los efectos del agente escriben con la misma forma (tools/effects.ts).
 * Un Member consulta con su cliente: la policy de la 00068 le deja ver solo
 * las acciones sobre contactos y conversaciones de su scope.
 */

type Db = SupabaseClient<Database>;

export const ACTIONS_PAGE_SIZE = 25;

/** Las acciones que el agente ejecuta, con su etiqueta para el filtro. */
export const AGENT_ACTION_LABELS: Record<string, string> = {
  tag: "Etiquetó",
  temperature: "Cambió la temperatura",
  followup: "Programó el seguimiento",
  assign: "Asignó la conversación",
  human_takeover: "Derivó a una persona",
  agent_paused: "Se pausó",
  summary: "Guardó el resumen",
  update: "Se apagó por tope de gasto",
};

export const REVERTED_VALUES = ["si", "no"] as const;

const UUID = /^[0-9a-f-]{36}$/i;

export function parseActionFilters(
  params: SearchParams,
  known: { currentAgentId: string; agentIds: string[]; channelIds: string[] },
): ActionFilters {
  const agenteRaw = firstParam(params.agente);
  return {
    page: pickPage(params.page),
    accion: pickEnum(params.accion, Object.keys(AGENT_ACTION_LABELS)),
    datePreset: pickEnum<DatePreset>(params.fecha, DATE_PRESETS),
    dateFrom: firstParam(params.desde),
    dateTo: firstParam(params.hasta),
    agente: agenteRaw === "todos" ? "todos" : known.agentIds.includes(agenteRaw) ? agenteRaw : known.currentAgentId,
    canal: pickEnum(params.canal, known.channelIds),
    contacto: UUID.test(firstParam(params.contacto)) ? firstParam(params.contacto) : "",
    revertida: pickEnum(params.revertida, REVERTED_VALUES),
  };
}

export function countActiveActionFilters(f: ActionFilters, currentAgentId: string): number {
  let n = 0;
  if (f.accion) n++;
  if (f.datePreset) n++;
  if (f.agente !== currentAgentId) n++;
  if (f.canal) n++;
  if (f.contacto) n++;
  if (f.revertida) n++;
  return n;
}

interface RawEntry {
  id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  changes: Json | null;
  metadata: Json | null;
  performed_by_agent_id: string | null;
  performed_at: string;
  reverted_at: string | null;
  reverted_by_audit_id: string | null;
}

const meta = (entry: RawEntry, key: string): string | null => {
  const m = entry.metadata;
  if (!m || typeof m !== "object" || Array.isArray(m)) return null;
  const v = (m as Record<string, unknown>)[key];
  return typeof v === "string" ? v : null;
};

export async function loadActions(
  client: Db,
  args: { workspaceId: string; filters: ActionFilters; agentNames: Map<string, string>; channelLabels: Map<string, string>; tagNames: Map<string, string>; memberNames: Map<string, string>; timeZone?: string },
): Promise<{ rows: ActionRow[]; total: number }> {
  const f = args.filters;
  let query = client
    .from("audit_log")
    .select("id, entity_type, entity_id, action, changes, metadata, performed_by_agent_id, performed_at, reverted_at, reverted_by_audit_id", { count: "exact" })
    .eq("workspace_id", args.workspaceId)
    .not("performed_by_agent_id", "is", null)
    .in("action", Object.keys(AGENT_ACTION_LABELS) as AuditAction[]);

  if (f.accion) query = query.eq("action", f.accion as AuditAction);
  if (f.agente !== "todos") query = query.eq("performed_by_agent_id", f.agente);
  if (f.canal) query = query.contains("metadata", { channel_id: f.canal });
  if (f.contacto) query = query.or(`entity_id.eq.${f.contacto},metadata->>contact_id.eq.${f.contacto}`);
  if (f.revertida === "si") query = query.not("reverted_at", "is", null);
  if (f.revertida === "no") query = query.is("reverted_at", null);

  const range = resolveDateRange(f.datePreset, f.dateFrom, f.dateTo, new Date(), args.timeZone);
  if (range.from) query = query.gte("performed_at", range.from);
  if (range.to) query = query.lte("performed_at", range.to);

  const from = (f.page - 1) * ACTIONS_PAGE_SIZE;
  const { data, count, error } = await query.order("performed_at", { ascending: false }).range(from, from + ACTIONS_PAGE_SIZE - 1);
  if (error) {
    console.error("[actions] no pude leer las acciones:", error.message);
    return { rows: [], total: 0 };
  }
  const raw = (data ?? []) as unknown as RawEntry[];

  // Nombres de contacto en una sola consulta (pasa por la RLS del cliente).
  const contactIds = [...new Set(raw.map((e) => (e.entity_type === "contact" ? e.entity_id : meta(e, "contact_id"))).filter((id): id is string => Boolean(id)))];
  const contactNames = new Map<string, string | null>();
  if (contactIds.length > 0) {
    const { data: contacts } = await client.from("contacts").select("id, display_name").in("id", contactIds);
    for (const c of contacts ?? []) contactNames.set(c.id, c.display_name);
  }

  const rows: ActionRow[] = raw.map((e) => {
    const contactId = e.entity_type === "contact" ? e.entity_id : meta(e, "contact_id");
    const conversationId = e.entity_type === "conversation" ? e.entity_id : meta(e, "conversation_id");
    const channelId = meta(e, "channel_id");
    return {
      id: e.id,
      performedAt: e.performed_at,
      action: e.action,
      actionLabel: AGENT_ACTION_LABELS[e.action] ?? e.action,
      agentId: e.performed_by_agent_id,
      agentName: e.performed_by_agent_id ? args.agentNames.get(e.performed_by_agent_id) ?? null : null,
      contactId,
      contactName: contactId ? contactNames.get(contactId) ?? null : null,
      conversationId,
      channelId,
      channelLabel: channelId ? args.channelLabels.get(channelId) ?? null : null,
      runId: meta(e, "run_id"),
      origin: meta(e, "origin"),
      changes: describeChanges(e, args.tagNames, args.memberNames),
      reason: meta(e, "reason"),
      revertedAt: e.reverted_at,
      revertible: !e.reverted_at && REVERTIBLE_ACTIONS.includes(e.action as AuditAction),
    };
  });

  return { rows, total: count ?? rows.length };
}

const FIELD_LABELS: Record<string, string> = {
  tags: "Etiquetas",
  lead_temperature: "Temperatura",
  next_followup_date: "Próximo seguimiento",
  ai_conversation_summary: "Resumen",
  assigned_to: "Asignada a",
  agent_enabled: "Agente en la conversación",
  is_automation_paused: "Automatizaciones pausadas",
  agent_paused_until: "Agente pausado hasta",
  status: "Estado",
  is_enabled: "Agente encendido",
};

const TEMPERATURES: Record<string, string> = { cold: "frío", warm: "tibio", hot: "caliente" };

/** El antes y el despues en palabras: ids de tags y de miembros a nombres. */
export function describeChanges(entry: RawEntry, tagNames: Map<string, string>, memberNames: Map<string, string>): Array<{ field: string; before: string; after: string }> {
  const changes = entry.changes;
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) return [];
  const render = (field: string, value: unknown): string => {
    // null tiene significado propio en el interruptor de tres estados.
    if (field === "agent_enabled") return value === true ? "prendido" : value === false ? "apagado" : "hereda del canal";
    if (value === null || value === undefined || value === "") return "vacío";
    if (field === "tags") return String(value).split(",").filter(Boolean).map((id) => tagNames.get(id) ?? "etiqueta borrada").join(", ") || "vacío";
    if (field === "assigned_to") return memberNames.get(String(value)) ?? "una persona";
    if (field === "lead_temperature") return TEMPERATURES[String(value)] ?? String(value);
    if (field === "agent_paused_until") return value === "infinity" ? "hasta que lo reanuden" : String(value).slice(0, 16).replace("T", " ");
    if (field === "next_followup_date") return String(value).slice(0, 10);
    if (field === "ai_conversation_summary") return `${String(value).slice(0, 160)}${String(value).length > 160 ? "…" : ""}`;
    if (typeof value === "boolean") return value ? "sí" : "no";
    return String(value);
  };
  return Object.entries(changes as Record<string, unknown>).map(([field, pair]) => {
    const p = (pair && typeof pair === "object" && !Array.isArray(pair) ? pair : {}) as { old?: unknown; new?: unknown };
    return { field: FIELD_LABELS[field] ?? field, before: render(field, p.old), after: render(field, p.new) };
  });
}
