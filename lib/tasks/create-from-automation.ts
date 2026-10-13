/**
 * Crear una tarea desde una automatizacion (Extra A, F22, F23, F24, F26): un flujo (nodo «Crear tarea») o el agente de IA
 * (herramienta `crear_tarea`, o la opcion «crear una tarea cuando derive a una persona»).
 *
 * Reglas:
 *  - NUNCA lanza. Toda excepcion se atrapa y se registra con `console.error('[tareas] ...')`: una tarea que no se pudo
 *    crear no rompe el flujo, el turno del agente ni el escalamiento que la origino.
 *  - Es idempotente: el unico parcial `(workspace, source, source_ref)` evita crear dos veces la misma tarea abierta.
 *  - El responsable y los seguidores se filtran a miembros del workspace. Si el responsable pedido no es miembro, la
 *    tarea queda sin responsable y se avisa a CADA Owner/Admin (con `recipient_id` concreto).
 *  - Se audita como el sistema (flujos) o como el agente (con su id), y se avisa a quien corresponde.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { auditAsSystem, diffFields, logAudit } from "@/lib/audit";
import { createNotification } from "@/lib/notifications/create";
import type { Database, Json } from "@/lib/types/database";
import { isDateOnly } from "./dates";
import { TASK_COLUMNS } from "./core";
import { planCreated, sendTaskNotifications } from "./notifications";
import { cleanProjectName } from "./project";
import { TASK_LIMITS, TASK_PRIORITIES, type TaskPriority, type TaskRow } from "./types";

type Db = SupabaseClient<Database>;

export type AutomationActor =
  | { kind: "flow"; label: string; flowId: string; runId?: string | null; nodeId?: string | null }
  | { kind: "agent"; label: string; agentId: string; runId?: string | null; origin: "tool" | "escalation" };

export interface AutomationTaskInput {
  workspaceId: string;
  title: string;
  description?: string | null;
  priority?: string | null;
  /** AAAA-MM-DD. Una fecha invalida se descarta. */
  dueDate?: string | null;
  /** Quien queda a cargo si es miembro del workspace. */
  ownerId?: string | null;
  followerIds?: string[];
  project?: string | null;
  contactId?: string | null;
  conversationId?: string | null;
  source: "flow" | "agent";
  /** Lo que hace unica a la tarea abierta: `flow:run:nodo` o el `run_id` del agente. */
  sourceRef: string;
  actor: AutomationActor;
  /** Sin responsable (o con uno invalido), avisar a cada Owner/Admin. Los flujos que eligen «nadie» a proposito lo apagan. */
  notifyIfUnassigned: boolean;
  /** Para la metadata de la auditoria: por que se creo. */
  reason?: string | null;
}

export type AutomationTaskResult =
  | { ok: true; duplicate: false; task: TaskRow; ownerDropped: boolean }
  | { ok: true; duplicate: true; taskId: string | null }
  | { ok: false; reason: "invalid" | "error"; message: string };

const clip = (value: string, max: number) => (value.length > max ? value.slice(0, max) : value);

async function memberIds(db: Db, workspaceId: string, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { data } = await db.from("workspace_members").select("user_id").eq("workspace_id", workspaceId).in("user_id", ids);
  return new Set((data ?? []).map((r) => r.user_id));
}

/** Los Owner y Admin del workspace. */
export async function ownerAdminIds(db: Db, workspaceId: string): Promise<string[]> {
  const { data } = await db.from("workspace_members").select("user_id").eq("workspace_id", workspaceId).in("role", ["owner", "admin"]);
  return [...new Set((data ?? []).map((r) => r.user_id))];
}

async function notifyUnassigned(db: Db, task: TaskRow, actorLabel: string, reason: "dropped" | "none"): Promise<void> {
  const admins = await ownerAdminIds(db, task.workspace_id);
  await Promise.all(
    admins.map((recipientId) =>
      createNotification({
        supabase: db,
        workspaceId: task.workspace_id,
        type: "task_assigned",
        title: `«${task.title}» no tiene responsable`,
        body: reason === "dropped" ? `${actorLabel} la creó, pero la persona elegida ya no es del equipo. Asignala desde Tareas.` : `${actorLabel} la creó y no se pudo elegir a nadie. Asignala desde Tareas.`,
        entityType: "task",
        entityId: task.id,
        recipientId,
        metadata: { task_id: task.id, unassigned: true },
      }),
    ),
  );
}

export async function createTaskFromAutomation(db: Db, input: AutomationTaskInput): Promise<AutomationTaskResult> {
  try {
    const title = clip(input.title.replace(/\s+/g, " ").trim(), TASK_LIMITS.title);
    if (!title) return { ok: false, reason: "invalid", message: "sin título" };

    const description = input.description ? clip(input.description.trim(), TASK_LIMITS.description) || null : null;
    const priority: TaskPriority = (TASK_PRIORITIES as readonly string[]).includes(input.priority ?? "") ? (input.priority as TaskPriority) : "normal";
    const dueDate = isDateOnly(input.dueDate) ? input.dueDate : null;
    const project = cleanProjectName(input.project ? clip(input.project, TASK_LIMITS.project) : null);

    const wanted = [...(input.ownerId ? [input.ownerId] : []), ...(input.followerIds ?? [])];
    const members = await memberIds(db, input.workspaceId, [...new Set(wanted)]);
    const ownerId = input.ownerId && members.has(input.ownerId) ? input.ownerId : null;
    const ownerDropped = !!input.ownerId && !ownerId;
    const followers = [...new Set((input.followerIds ?? []).filter((id) => members.has(id) && id !== ownerId))].slice(0, TASK_LIMITS.followers);

    // El contacto y la conversacion tienen que ser de este workspace.
    let contactId: string | null = null;
    if (input.contactId) {
      const { data } = await db.from("contacts").select("id").eq("id", input.contactId).eq("workspace_id", input.workspaceId).maybeSingle();
      contactId = data?.id ?? null;
    }
    let conversationId: string | null = null;
    if (input.conversationId) {
      const { data } = await db.from("conversations").select("id").eq("id", input.conversationId).eq("workspace_id", input.workspaceId).maybeSingle();
      conversationId = data?.id ?? null;
    }

    const { data, error } = await db
      .from("tasks")
      .insert({
        workspace_id: input.workspaceId,
        title,
        description,
        priority,
        due_date: dueDate,
        owner_id: ownerId,
        follower_ids: followers,
        project: project.ok ? project.project : null,
        project_key: project.ok ? project.key : null,
        contact_id: contactId,
        conversation_id: conversationId,
        source: input.source,
        source_ref: input.sourceRef,
        created_by: null,
      })
      .select(TASK_COLUMNS)
      .single();

    if (error || !data) {
      // El mismo origen ya creo su tarea abierta: es lo esperado cuando algo se reintenta.
      if (error?.code === "23505") {
        const { data: existing } = await db
          .from("tasks")
          .select("id")
          .eq("workspace_id", input.workspaceId)
          .eq("source", input.source)
          .eq("source_ref", input.sourceRef)
          .is("deleted_at", null)
          .neq("status", "completed")
          .maybeSingle();
        return { ok: true, duplicate: true, taskId: existing?.id ?? null };
      }
      console.error("[tareas] no pude crear la tarea automatica:", error?.message);
      return { ok: false, reason: "error", message: error?.message ?? "sin respuesta" };
    }
    const task = data as unknown as TaskRow;

    const changes = diffFields({}, { title: task.title, priority: task.priority, due_date: task.due_date, owner_id: task.owner_id, project: task.project, contact_id: task.contact_id, conversation_id: task.conversation_id });
    const metadata: Record<string, Json> = { origin: input.actor.kind === "agent" ? input.actor.origin : "flow", source: input.source, source_ref: input.sourceRef };
    if (input.reason) metadata.reason = clip(input.reason, 300);
    if (task.contact_id) metadata.contact_id = task.contact_id;
    if (task.conversation_id) metadata.conversation_id = task.conversation_id;
    if (input.actor.runId) metadata.run_id = input.actor.runId;
    if (input.actor.kind === "flow") {
      metadata.flow_id = input.actor.flowId;
      if (input.actor.nodeId) metadata.node_id = input.actor.nodeId;
    }

    if (input.actor.kind === "agent") {
      await logAudit({ supabase: db, workspaceId: task.workspace_id, entityType: "task", entityId: task.id, action: "task.created", changes, metadata, performedBy: null, performedByAgentId: input.actor.agentId, actorType: "agent", actorLabel: input.actor.label });
    } else {
      await auditAsSystem({ supabase: db, workspaceId: task.workspace_id, entityType: "task", entityId: task.id, action: "task.created", changes, metadata, label: input.actor.label });
    }

    // Los avisos nunca tumban lo que ya se hizo.
    try {
      await sendTaskNotifications(db, task.workspace_id, planCreated(task, { id: "", name: input.actor.label }));
      if (!task.owner_id && (ownerDropped || input.notifyIfUnassigned)) await notifyUnassigned(db, task, input.actor.label, ownerDropped ? "dropped" : "none");
    } catch (err) {
      console.error("[tareas] no pude avisar de la tarea automatica:", err instanceof Error ? err.message : String(err));
    }

    return { ok: true, duplicate: false, task, ownerDropped };
  } catch (err) {
    console.error("[tareas] error al crear la tarea automatica:", err instanceof Error ? err.message : String(err));
    return { ok: false, reason: "error", message: err instanceof Error ? err.message : String(err) };
  }
}

// ── A quien le toca una tarea que nace de una conversacion ───────────────────

/** El primer candidato que es del equipo, en el orden dado. Puro. */
export function firstMember(candidates: ReadonlyArray<string | null | undefined>, members: ReadonlySet<string>): string | null {
  for (const id of candidates) if (id && members.has(id)) return id;
  return null;
}

/**
 * Quien se hace cargo de una tarea del agente: la persona asignada a la conversacion, si no el setter del contacto,
 * si no su vendedor, si no nadie. Solo cuenta quien sigue siendo del equipo. Nunca lanza.
 */
export async function resolveConversationResponsible(
  db: Db,
  input: { workspaceId: string; conversationId: string | null; contactId: string | null },
): Promise<string | null> {
  try {
    let assignedTo: string | null = null;
    let contactId = input.contactId;
    if (input.conversationId) {
      const { data } = await db.from("conversations").select("assigned_to, contact_id").eq("id", input.conversationId).eq("workspace_id", input.workspaceId).maybeSingle();
      assignedTo = data?.assigned_to ?? null;
      contactId = contactId ?? data?.contact_id ?? null;
    }
    let setter: string | null = null;
    let seller: string | null = null;
    if (contactId) {
      const { data } = await db.from("contacts").select("setter_id, vendedor_id").eq("id", contactId).eq("workspace_id", input.workspaceId).maybeSingle();
      setter = data?.setter_id ?? null;
      seller = data?.vendedor_id ?? null;
    }
    const candidates = [assignedTo, setter, seller];
    const members = await memberIds(db, input.workspaceId, candidates.filter((id): id is string => !!id));
    return firstMember(candidates, members);
  } catch (err) {
    console.error("[tareas] no pude resolver el responsable de la conversacion:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

/**
 * El vendedor de una venta; si no hay, el setter; si no hay, nadie (R3: «Vendedor de la venta»). Solo cuenta quien sigue
 * siendo del equipo. Nunca lanza.
 */
export async function resolveSaleResponsible(db: Db, input: { workspaceId: string; saleId: string | null }): Promise<string | null> {
  try {
    if (!input.saleId) return null;
    const { data } = await db.from("sales").select("vendedor_id, setter_id").eq("id", input.saleId).eq("workspace_id", input.workspaceId).maybeSingle();
    const candidates = [data?.vendedor_id ?? null, data?.setter_id ?? null];
    const members = await memberIds(db, input.workspaceId, candidates.filter((id): id is string => !!id));
    return firstMember(candidates, members);
  } catch (err) {
    console.error("[tareas] no pude resolver el vendedor de la venta:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

/**
 * La persona asignada a un contacto (R3: «Persona asignada al contacto»): su vendedor; si no hay, su setter; si no hay,
 * quien tiene asignada su conversacion mas reciente; si no hay, nadie. Solo cuenta quien sigue siendo del equipo.
 * Nunca lanza.
 */
export async function resolveContactResponsible(db: Db, input: { workspaceId: string; contactId: string | null }): Promise<string | null> {
  try {
    if (!input.contactId) return null;
    const { data: contact } = await db.from("contacts").select("vendedor_id, setter_id").eq("id", input.contactId).eq("workspace_id", input.workspaceId).maybeSingle();
    const { data: conversation } = await db
      .from("conversations")
      .select("assigned_to")
      .eq("contact_id", input.contactId)
      .eq("workspace_id", input.workspaceId)
      .is("deleted_at", null)
      .not("assigned_to", "is", null)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    const candidates = [contact?.vendedor_id ?? null, contact?.setter_id ?? null, conversation?.assigned_to ?? null];
    const members = await memberIds(db, input.workspaceId, candidates.filter((id): id is string => !!id));
    return firstMember(candidates, members);
  } catch (err) {
    console.error("[tareas] no pude resolver la persona asignada al contacto:", err instanceof Error ? err.message : String(err));
    return null;
  }
}
