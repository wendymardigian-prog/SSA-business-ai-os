import { cache } from "react";
import { getWorkspace } from "@/lib/workspace";
import { isAdminRole } from "@/lib/auth/roles";
import { draftOwner } from "./queue-query";
import { LIVE_DRAFT_STATUSES } from "./types";

/**
 * El contador del menu. Coincide con la vista por defecto de la cola ("mios"):
 * los borradores vivos cuyo contacto es del usuario (setter; sin setter,
 * vendedor). Para Owner/Admin suma los sin asignar y el total del workspace,
 * asi un Owner sin contactos propios no ve "0" con doce esperando.
 */
export interface PendingDraftCounts {
  mine: number;
  /** Solo Owner/Admin. */
  unassigned: number | null;
  /** Solo Owner/Admin: todo el workspace. */
  total: number | null;
}

/**
 * `cache()`: el layout y varias pantallas lo piden en el mismo render; se consulta
 * una vez por request. Vive aca y no en `lib/actions/agent-drafts.ts` porque en un
 * archivo `"use server"` todo lo exportado es una funcion asincronica propia.
 */
export const loadPendingDraftCounts = cache(async (): Promise<PendingDraftCounts> => {
  const { workspace, role, supabase, user } = await getWorkspace();
  const { data, error } = await supabase
    .from("agent_drafts")
    .select("id, contacts(setter_id, vendedor_id)")
    .eq("workspace_id", workspace.id)
    .in("status", LIVE_DRAFT_STATUSES)
    .limit(1000);
  if (error) {
    console.error("[drafts] no pude contar los borradores:", error.message);
    return { mine: 0, unassigned: null, total: null };
  }
  const rows = (data ?? []) as unknown as Array<{ contacts: { setter_id: string | null; vendedor_id: string | null } | null }>;
  const owners = rows.map((r) => draftOwner(r.contacts));
  const admin = isAdminRole(role);
  return {
    mine: owners.filter((o) => o === user.id).length,
    unassigned: admin ? owners.filter((o) => o === null).length : null,
    total: admin ? rows.length : null,
  };
});
