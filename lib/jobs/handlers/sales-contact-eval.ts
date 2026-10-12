/**
 * El job `sales_contact_eval` (plano F15): evalúa las reglas de asignación de un
 * contacto y escribe SOLO lo que corresponde.
 *
 * Lo encola el trigger `contacts_enqueue_sales_eval` (00161) cuando el workspace
 * tiene alguna regla que no es manual y el contacto se crea o cambia su atribución.
 *
 * Reglas de escritura (las decide `resolveAssignments`, que es pura; acá solo se
 * aplican, cada campo con su propia condición para no pisar a otra escritura):
 *  - con `assignment_locked_at` setter y vendedor no se tocan nunca;
 *  - un campo con valor se toca solo si la regla "puede reasignar";
 *  - un contacto anonimo no se evalua (no es un lead hasta que tiene datos);
 *  - se escribe con un UPDATE condicional (`... WHERE campo IS NULL`), así dos jobs
 *    del mismo contacto no se pisan.
 *
 * `assignment_changed` lo sigue emitiendo el trigger que ya tenía `contacts` al
 * cambiar `setter_id` / `vendedor_id`: acá NO se emite a mano. La auditoría sale
 * con actor sistema y el nombre de la regla.
 *
 * Un error de la base lanza (la cola reintenta); no hay proveedores externos.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import { auditAsSystem } from "@/lib/audit";
import { registerJobHandler, type JobContext } from "@/lib/jobs/registry";
import { resolveAssignments, type ContactForResolve } from "@/lib/sales/assignment/resolve";
import { parseConditionRules, type AssignmentKind, type AssignmentRuleRow } from "@/lib/sales/assignment/types";

type Db = SupabaseClient<Database>;

export const SALES_CONTACT_EVAL_JOB = "sales_contact_eval";

interface EvalPayload {
  contact_id: string;
  workspace_id: string;
}

const FIELD_OF: Record<AssignmentKind, (destinationType: "user" | "contact") => "setter_id" | "vendedor_id" | "referred_by_user_id" | "referred_by_contact_id"> = {
  setter: () => "setter_id",
  vendedor: () => "vendedor_id",
  referral: (type) => (type === "user" ? "referred_by_user_id" : "referred_by_contact_id"),
};

/** Las reglas del workspace tal como las lee el motor (una por kind). */
export async function loadAssignmentRules(db: Db, workspaceId: string): Promise<Partial<Record<AssignmentKind, AssignmentRuleRow>>> {
  const { data, error } = await db
    .from("assignment_rules")
    .select("id, kind, mode, enabled_member_ids, last_assigned_member_id, condition_rules")
    .eq("workspace_id", workspaceId)
    .eq("entity_type", "contact");
  if (error) throw new Error(`no pude leer las reglas de asignación: ${error.message}`);

  const out: Partial<Record<AssignmentKind, AssignmentRuleRow>> = {};
  for (const row of data ?? []) {
    out[row.kind] = {
      id: row.id,
      kind: row.kind,
      mode: row.mode,
      enabled_member_ids: row.enabled_member_ids ?? [],
      last_assigned_member_id: row.last_assigned_member_id,
      condition_rules: parseConditionRules(row.condition_rules),
    };
  }
  return out;
}

/** Las personas activas del workspace (los destinos válidos). */
export async function loadActiveMembers(db: Db, workspaceId: string): Promise<Set<string>> {
  const { data, error } = await db.from("workspace_members").select("user_id").eq("workspace_id", workspaceId);
  if (error) throw new Error(`no pude leer los miembros: ${error.message}`);
  return new Set((data ?? []).map((m) => m.user_id));
}

/** Los contactos de destino que existen (para validar una regla de referido a un contacto). */
export async function loadValidContactIds(db: Db, workspaceId: string, rules: Partial<Record<AssignmentKind, AssignmentRuleRow>>): Promise<Set<string>> {
  const wanted = new Set<string>();
  for (const rule of Object.values(rules)) {
    for (const r of rule?.condition_rules ?? []) if (r.destination.type === "contact") wanted.add(r.destination.contact_id);
  }
  if (wanted.size === 0) return new Set();
  const { data } = await db.from("contacts").select("id").eq("workspace_id", workspaceId).is("deleted_at", null).in("id", [...wanted]);
  return new Set((data ?? []).map((c) => c.id));
}

/** La plataforma de la conversación más reciente del contacto (para las condiciones por canal). */
export async function loadContactChannel(db: Db, contactId: string): Promise<string | null> {
  const { data: conversation } = await db
    .from("conversations")
    .select("channel_id")
    .eq("contact_id", contactId)
    .order("last_message_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!conversation?.channel_id) return null;
  const { data: channel } = await db.from("channels").select("platform").eq("id", conversation.channel_id).maybeSingle();
  return channel?.platform ?? null;
}

export async function handleSalesContactEval(ctx: JobContext): Promise<void> {
  const db = ctx.supabase;
  const payload = ctx.job.payload as unknown as EvalPayload;
  if (!payload?.contact_id || !payload?.workspace_id) return;

  const { data: contact, error } = await db
    .from("contacts")
    .select("id, workspace_id, setter_id, vendedor_id, referred_by_user_id, referred_by_contact_id, assignment_locked_at, attribution, country, email, phone, whatsapp_phone, deleted_at, is_anonymous")
    .eq("id", payload.contact_id)
    .eq("workspace_id", payload.workspace_id)
    .maybeSingle();
  if (error) throw new Error(`no pude leer el contacto: ${error.message}`);
  if (!contact || contact.deleted_at) return;
  // Un contacto anonimo (el que crea un comentario sin datos) no es un lead todavia: no gasta turnos del reparto.
  if (contact.is_anonymous) return;

  const rules = await loadAssignmentRules(db, contact.workspace_id);
  if (Object.values(rules).every((r) => !r || r.mode === "manual")) return;

  const [members, validContactIds, channel] = await Promise.all([
    loadActiveMembers(db, contact.workspace_id),
    loadValidContactIds(db, contact.workspace_id, rules),
    loadContactChannel(db, contact.id),
  ]);

  const resolution = resolveAssignments(contact as unknown as ContactForResolve, rules, members, { channel, validContactIds });

  for (const entry of resolution.trace) {
    if (entry.outcome !== "applied" || !entry.candidate) continue;
    const { kind, candidate } = entry;
    const field = FIELD_OF[kind](candidate.destination.type);
    const before = (contact as Record<string, unknown>)[field] ?? null;

    // El UPDATE condicional es lo que hace la escritura segura ante dos jobs a la vez.
    let query = db.from("contacts").update({ [field]: candidate.destination.id } as never).eq("id", contact.id).eq("workspace_id", contact.workspace_id);
    if (!candidate.canReassign) query = query.is(field, null);
    if (kind !== "referral") query = query.is("assignment_locked_at", null);
    const { data: written, error: writeError } = await query.select("id");
    if (writeError) throw new Error(`no pude asignar el contacto: ${writeError.message}`);
    if (!written || written.length === 0) continue; // otro proceso asignó primero: no se pisa.

    await auditAsSystem({
      supabase: db,
      workspaceId: contact.workspace_id,
      entityType: "contact",
      entityId: contact.id,
      action: "assignment.automatic",
      changes: { [field]: { old: before as Json, new: candidate.destination.id } },
      metadata: { rule_id: candidate.ruleId, kind },
      label: candidate.ruleName,
    });
  }

  // Los punteros del reparto avanzan solo para lo que se escribió.
  const written = new Set(resolution.trace.filter((t) => t.outcome === "applied").map((t) => t.kind));
  for (const pointer of resolution.pointerUpdates) {
    if (!written.has(pointer.kind)) continue;
    if (pointer.scope === "mode") {
      await db.from("assignment_rules").update({ last_assigned_member_id: pointer.lastAssignedMemberId }).eq("id", pointer.assignmentRuleId);
    } else {
      const { data: current } = await db.from("assignment_rules").select("condition_rules, updated_at").eq("id", pointer.assignmentRuleId).maybeSingle();
      if (!current) continue;
      const list = (Array.isArray(current.condition_rules) ? current.condition_rules : []) as Array<Record<string, unknown>>;
      const next = list.map((r) =>
        r.id === pointer.conditionRuleId && r.destination && typeof r.destination === "object"
          ? { ...r, destination: { ...(r.destination as object), last_index: pointer.lastIndex } }
          : r,
      );
      // Si alguien editó la regla justo ahora, se deja: el próximo job vuelve a avanzar el puntero.
      await db.from("assignment_rules").update({ condition_rules: next as unknown as Json }).eq("id", pointer.assignmentRuleId).eq("updated_at", current.updated_at);
    }
  }
}

export function registerSalesContactEvalHandler(): void {
  registerJobHandler(SALES_CONTACT_EVAL_JOB, handleSalesContactEval);
}
