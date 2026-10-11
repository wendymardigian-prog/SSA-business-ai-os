/**
 * Avisos del modulo Llamadas que van a un grupo de personas (no a "los
 * administradores" en general). Nunca lanzan: un aviso que falla no puede
 * tumbar el job que lo genero.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { can, parsePermissions, scopeFor, systemRolePermissions } from "@/lib/auth/permissions";
import { createNotificationOnce } from "@/lib/notifications/create";

type Db = SupabaseClient<Database>;

/**
 * Quienes del workspace tienen un permiso. Los de Owner y Admin salen de la
 * tabla de TypeScript (la fuente); un `member` con rol personalizado, de su
 * fila. Necesita el cliente de servicio.
 */
export async function membersWithPermission(
  db: Db,
  workspaceId: string,
  key: string,
  /** `scope: "all"`: solo quienes ven TODAS las llamadas (el alcance del modulo `calls`). */
  opts: { scope?: "all" } = {},
): Promise<string[]> {
  try {
    const [{ data: members }, { data: roles }] = await Promise.all([
      db.from("workspace_members").select("user_id, role, role_id").eq("workspace_id", workspaceId),
      db.from("workspace_roles").select("id, system_role, permissions").eq("workspace_id", workspaceId),
    ]);
    const rolesById = new Map((roles ?? []).map((r) => [r.id, r]));
    return (members ?? [])
      .filter((m) => {
        let permissions = systemRolePermissions(m.role);
        if (m.role === "member" && m.role_id) {
          const row = rolesById.get(m.role_id);
          if (row && !row.system_role) permissions = parsePermissions(row.permissions);
        }
        const resolved = permissions ?? systemRolePermissions("member");
        if (!can(resolved, key)) return false;
        return opts.scope === "all" ? scopeFor(resolved, "calls") === "all" : true;
      })
      .map((m) => m.user_id);
  } catch (err) {
    console.error("[llamadas] no pude resolver quién tiene el permiso:", err instanceof Error ? err.message : err);
    return [];
  }
}

/** El tope de gasto de IA dejo llamadas sin analizar: avisa a quienes configuran el analisis. Una vez por dia y persona. */
export async function notifyBudgetBlocked(db: Db, workspaceId: string, callId: string): Promise<number> {
  const recipients = await membersWithPermission(db, workspaceId, "calls.configure");
  let sent = 0;
  for (const recipientId of recipients) {
    const created = await createNotificationOnce({
      supabase: db,
      workspaceId,
      type: "call_analysis_budget",
      title: "Hay llamadas sin analizar por el tope de gasto de IA",
      body: "Se alcanzó el tope de gasto de IA y las llamadas nuevas quedaron pendientes. Subí el tope en Agentes IA o esperá a que se renueve.",
      recipientId,
      metadata: { callId },
      withinMinutes: 24 * 60,
      perRecipient: true,
    });
    if (created) sent += 1;
  }
  return sent;
}

/** El closer objeto un analisis: avisa a quienes editan TODAS las llamadas (nunca al propio closer). */
export async function notifyObjection(db: Db, args: { workspaceId: string; callId: string; closerId: string; callTitle: string }): Promise<number> {
  const editors = (await membersWithPermission(db, args.workspaceId, "calls.edit", { scope: "all" })).filter((id) => id !== args.closerId);
  let sent = 0;
  for (const recipientId of editors) {
    const created = await createNotificationOnce({
      supabase: db,
      workspaceId: args.workspaceId,
      type: "call_objection",
      title: "El closer no está de acuerdo con un análisis",
      body: `Objetó el análisis de “${args.callTitle.slice(0, 80)}”. Revisalo y marcá la objeción como resuelta.`,
      entityType: "call",
      entityId: args.callId,
      recipientId,
      metadata: { callId: args.callId },
      withinMinutes: 60,
      perRecipient: true,
    });
    if (created) sent += 1;
  }
  return sent;
}
