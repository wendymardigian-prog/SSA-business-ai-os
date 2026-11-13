// @plantilla-quitar(servicios)
"use server";

/**
 * «Reparto de clientes» (Servicios A4, F151): leer y guardar el tope de cartera de cada persona. Pide
 * `services.configure`. `workspaces` es de Admin en la base: se escribe con el cliente de servicio DESPUÉS del
 * permiso, filtrando por el negocio de la sesión, y con `rev` para no pisar un cambio de otra persona.
 */
import { revalidatePath } from "next/cache";
import { getPermissionAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { svcRpc, type SvcResult } from "@/lib/services/db";
import { getWorkspaceMembers } from "@/lib/workspace-members";
import { capacityRows, parseCapacityInput, readCapacity, type CapacityRow } from "@/lib/services/screens/capacity";

const NOT_ALLOWED: SvcResult<never> = { ok: false, error: { code: "SV004", message: "No tenés permiso para hacer esto.", detail: null } };

export interface CapacityView {
  rows: CapacityRow[];
  rev: number;
}

export async function loadServiceCapacity(): Promise<SvcResult<CapacityView>> {
  const ctx = await getPermissionAction("services.configure");
  if (!ctx) return NOT_ALLOWED;
  const svc = await createServiceClient();
  const [ws, loads, team] = await Promise.all([
    svc.from("workspaces").select("service_team_settings, service_team_settings_rev" as never).eq("id", ctx.workspace.id).maybeSingle(),
    svcRpc<Record<string, number>>(svc, "svc_owner_loads", { p_workspace_id: ctx.workspace.id }),
    getWorkspaceMembers(ctx.workspace.id),
  ]);
  const row = ws.data as { service_team_settings?: unknown; service_team_settings_rev?: number } | null;
  return {
    ok: true,
    data: {
      rows: capacityRows(team.map((m) => ({ id: m.userId, name: m.name })), readCapacity(row?.service_team_settings), loads.ok ? loads.data ?? {} : {}),
      rev: Number(row?.service_team_settings_rev) || 0,
    },
  };
}

export async function saveServiceCapacity(entries: Record<string, string>, rev: number): Promise<SvcResult<{ status: "ok" | "conflict" }>> {
  const ctx = await getPermissionAction("services.configure");
  if (!ctx) return NOT_ALLOWED;
  const team = await getWorkspaceMembers(ctx.workspace.id);
  const parsed = parseCapacityInput(entries, team.map((m) => m.userId));
  if (!parsed.ok) return { ok: false, error: { code: null, message: parsed.error, detail: null } };
  const svc = await createServiceClient();
  const { data: before } = await svc.from("workspaces").select("service_team_settings" as never).eq("id", ctx.workspace.id).maybeSingle();
  const old = readCapacity((before as { service_team_settings?: unknown } | null)?.service_team_settings);
  const { data, error } = await svc
    .from("workspaces")
    .update({ service_team_settings: { capacity: parsed.capacity }, service_team_settings_rev: rev + 1 } as never)
    .eq("id", ctx.workspace.id)
    .eq("service_team_settings_rev" as never, rev as never)
    .select("id");
  if (error) {
    console.error("[servicios] no pude guardar los topes de cartera:", error.message);
    return { ok: false, error: { code: null, message: "No se pudieron guardar los topes.", detail: null } };
  }
  if (!data || data.length === 0) return { ok: true, data: { status: "conflict" } };
  await logAudit({
    supabase: svc as never,
    workspaceId: ctx.workspace.id,
    entityType: "workspace",
    entityId: ctx.workspace.id,
    action: "svc.capacity_changed",
    changes: { capacity: { old, new: parsed.capacity } } as never,
    performedBy: ctx.user.id,
  }).catch(() => undefined);
  revalidatePath("/dashboard/settings/productos");
  return { ok: true, data: { status: "ok" } };
}
