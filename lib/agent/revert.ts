import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuditAction, AuditEntityType, Database, Json } from "@/lib/types/database";
import { logAudit, type AuditChanges } from "@/lib/audit";

/**
 * Revertir una accion del agente (F28): el inverso de lo que quedo en
 * audit_log.changes, aplicado con el cliente de quien revierte (la RLS decide
 * si puede tocar ese contacto o esa conversacion), y auditado a su vez.
 *
 * `planRevert` es pura: dado un asiento del audit, dice que hay que escribir.
 * Es lo que se testea. `applyRevert` lo ejecuta y deja la entrada `revert`.
 * Marcar el asiento original como revertido lo hace la Server Action con
 * service role (audit_log no tiene policy de UPDATE).
 */

type Db = SupabaseClient<Database>;

export interface AuditEntry {
  id: string;
  workspace_id: string;
  entity_type: AuditEntityType;
  entity_id: string;
  action: AuditAction;
  changes: Json | null;
  metadata: Json | null;
  performed_by_agent_id: string | null;
  reverted_at: string | null;
}

export type RevertPlan =
  | { kind: "tags"; contactId: string; add: string[]; remove: string[] }
  | { kind: "contact"; contactId: string; patch: Record<string, Json> }
  | { kind: "conversation"; conversationId: string; patch: Record<string, Json> }
  | { kind: "agent"; agentId: string; patch: Record<string, Json> };

/** Las acciones del agente que se pueden deshacer desde la pestana. */
export const REVERTIBLE_ACTIONS: AuditAction[] = ["tag", "temperature", "followup", "summary", "assign", "human_takeover", "agent_paused", "update"];

function change(entry: AuditEntry, field: string): { old: Json; new: Json } | null {
  const changes = entry.changes;
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) return null;
  const c = (changes as Record<string, unknown>)[field];
  if (!c || typeof c !== "object" || Array.isArray(c)) return null;
  const pair = c as { old?: Json; new?: Json };
  return { old: pair.old ?? null, new: pair.new ?? null };
}

const splitIds = (value: Json): string[] => (typeof value === "string" && value ? value.split(",").filter(Boolean) : []);

export function planRevert(entry: AuditEntry): RevertPlan | null {
  if (!entry.performed_by_agent_id || entry.reverted_at) return null;

  switch (entry.action) {
    case "tag": {
      const tags = change(entry, "tags");
      if (!tags) return null;
      const before = new Set(splitIds(tags.old));
      const after = new Set(splitIds(tags.new));
      return {
        kind: "tags",
        contactId: entry.entity_id,
        add: [...before].filter((id) => !after.has(id)),
        remove: [...after].filter((id) => !before.has(id)),
      };
    }
    case "temperature": {
      const c = change(entry, "lead_temperature");
      return c ? { kind: "contact", contactId: entry.entity_id, patch: { lead_temperature: c.old } } : null;
    }
    case "followup": {
      const c = change(entry, "next_followup_date");
      return c ? { kind: "contact", contactId: entry.entity_id, patch: { next_followup_date: c.old } } : null;
    }
    case "summary": {
      const c = change(entry, "ai_conversation_summary");
      return c ? { kind: "contact", contactId: entry.entity_id, patch: { ai_conversation_summary: c.old } } : null;
    }
    case "assign": {
      const c = change(entry, "assigned_to");
      return c ? { kind: "conversation", conversationId: entry.entity_id, patch: { assigned_to: c.old } } : null;
    }
    case "human_takeover": {
      const enabled = change(entry, "agent_enabled");
      const paused = change(entry, "is_automation_paused");
      if (!enabled && !paused) return null;
      const patch: Record<string, Json> = {};
      if (enabled) patch.agent_enabled = enabled.old;
      if (paused) patch.is_automation_paused = paused.old ?? false;
      return { kind: "conversation", conversationId: entry.entity_id, patch };
    }
    case "agent_paused": {
      const c = change(entry, "agent_paused_until");
      return c ? { kind: "conversation", conversationId: entry.entity_id, patch: { agent_paused_until: c.old } } : null;
    }
    case "update": {
      // El agente se apago solo por un tope de gasto.
      const c = change(entry, "is_enabled");
      return c && entry.entity_type === "agent" ? { kind: "agent", agentId: entry.entity_id, patch: { is_enabled: c.old } } : null;
    }
    default:
      return null;
  }
}

/** Lo que va en `changes` del asiento de reversion: el camino inverso. */
export function invertedChanges(entry: AuditEntry): AuditChanges | null {
  const changes = entry.changes;
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) return null;
  const out: AuditChanges = {};
  for (const [field, pair] of Object.entries(changes as Record<string, unknown>)) {
    if (!pair || typeof pair !== "object" || Array.isArray(pair)) continue;
    const p = pair as { old?: Json; new?: Json };
    out[field] = { old: p.new ?? null, new: p.old ?? null };
  }
  return Object.keys(out).length ? out : null;
}

export type RevertResult = { ok: true; revertAuditId: string | null } | { ok: false; error: string };

export async function applyRevert(
  supabase: Db,
  entry: AuditEntry,
  actor: { userId: string },
): Promise<RevertResult> {
  const plan = planRevert(entry);
  if (!plan) return { ok: false, error: "Esta accion no se puede revertir." };

  if (plan.kind === "tags") {
    if (plan.remove.length > 0) {
      const { error } = await supabase.from("contact_tags").delete().eq("contact_id", plan.contactId).in("tag_id", plan.remove);
      if (error) return { ok: false, error: "No pude quitar las etiquetas." };
    }
    if (plan.add.length > 0) {
      // Solo los tags que sigan existiendo: uno borrado no se puede volver a poner.
      const { data: existing } = await supabase.from("tags").select("id").eq("workspace_id", entry.workspace_id).in("id", plan.add);
      const ids = (existing ?? []).map((t) => t.id);
      if (ids.length > 0) {
        const { error } = await supabase.from("contact_tags").insert(ids.map((tag_id) => ({ contact_id: plan.contactId, tag_id })));
        if (error && error.code !== "23505") return { ok: false, error: "No pude volver a poner las etiquetas." };
      }
    }
  } else if (plan.kind === "contact") {
    const { data, error } = await supabase.from("contacts").update(plan.patch as never).eq("id", plan.contactId).select("id");
    if (error || !data?.length) return { ok: false, error: "No pude revertir: el contacto no esta a tu alcance o ya no existe." };
  } else if (plan.kind === "conversation") {
    const { data, error } = await supabase.from("conversations").update(plan.patch as never).eq("id", plan.conversationId).select("id");
    if (error || !data?.length) return { ok: false, error: "No pude revertir: la conversacion no esta a tu alcance o ya no existe." };
  } else {
    const { data, error } = await supabase.from("agents").update(plan.patch as never).eq("id", plan.agentId).select("id");
    if (error || !data?.length) return { ok: false, error: "No pude revertir: solo Owner/Admin pueden volver a encender el agente." };
  }

  const revertAuditId = await logAudit({
    supabase,
    workspaceId: entry.workspace_id,
    entityType: entry.entity_type,
    entityId: entry.entity_id,
    action: "revert",
    changes: invertedChanges(entry),
    metadata: { reverted_audit_id: entry.id, original_action: entry.action, agent_id: entry.performed_by_agent_id },
    performedBy: actor.userId,
  });
  return { ok: true, revertAuditId };
}
