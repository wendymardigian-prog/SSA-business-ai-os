/**
 * El núcleo que cambia un estado del pipeline: llama a `set_contact_status`
 * (00245) y traduce su respuesta. Lo usan la acción de la ficha y la bandeja
 * (`lib/actions/contact-status.ts`) y el agente de IA (`setSetterStatus`,
 * lib/agent/tools/effects.ts).
 *
 * Recibe SIEMPRE el cliente de servicio: la función solo la ejecuta
 * `service_role`. Quien llama ya chequeó el permiso y que el contacto es del
 * workspace de la sesión (o del agente) y que se puede ver.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { StatusRole } from "./statuses";

type Db = SupabaseClient<Database>;

export interface ApplyStatusInput {
  workspaceId: string;
  contactId: string;
  role: StatusRole;
  /** null quita el estado de ese rol. */
  status: string | null;
  actorUserId?: string | null;
  actorAgentId?: string | null;
  reason?: string | null;
  /** El agente: no pisa un estado de setter que puso una persona. */
  respectHuman?: boolean;
}

export type ApplyStatusResult =
  | {
      kind: "changed" | "unchanged";
      oldStatus: string | null;
      newStatus: string | null;
      lastStatus: { role: StatusRole; status: string; at: string } | null;
      changeId: string | null;
    }
  | { kind: "not_found" | "invalid_status" | "protected" | "error"; oldStatus: string | null; message: string };

function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

export async function applyContactStatus(service: Db, input: ApplyStatusInput): Promise<ApplyStatusResult> {
  const { data, error } = await service.rpc("set_contact_status", {
    p_workspace_id: input.workspaceId,
    p_contact_id: input.contactId,
    p_role: input.role,
    p_status: input.status,
    p_actor_user: input.actorUserId ?? null,
    p_actor_agent: input.actorAgentId ?? null,
    p_reason: input.reason ?? null,
    p_respect_human: input.respectHuman ?? false,
  });
  if (error) {
    console.error("[contact-status] set_contact_status falló:", error.message);
    return { kind: "error", oldStatus: null, message: "No pude guardar el estado" };
  }
  const r = (data ?? {}) as Record<string, unknown>;
  const result = str(r.result);
  const oldStatus = str(r.old_status);
  if (result === "changed" || result === "unchanged") {
    const role = r.last_status_role === "setter" || r.last_status_role === "closer" ? r.last_status_role : null;
    const status = str(r.last_status);
    const at = str(r.last_status_at);
    return {
      kind: result,
      oldStatus,
      newStatus: str(r.new_status),
      lastStatus: role && status && at ? { role, status, at } : null,
      changeId: str(r.change_id),
    };
  }
  if (result === "not_found") return { kind: "not_found", oldStatus, message: "No encontré ese contacto" };
  if (result === "invalid_status") return { kind: "invalid_status", oldStatus, message: "Ese estado no existe o está archivado" };
  if (result === "protected") {
    return { kind: "protected", oldStatus, message: "El estado lo puso una persona: no se cambia sin permiso para pisarlo" };
  }
  return { kind: "error", oldStatus, message: "No pude guardar el estado" };
}
