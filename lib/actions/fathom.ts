"use server";

import { revalidatePath } from "next/cache";
import { getMemberAction, getPermissionAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { storeSecret, SECRET_NAMES } from "@/lib/vault";
import { revokeFathomConnection } from "@/lib/fathom/revoke";
import { queueFathomSyncNow } from "@/lib/fathom/queue";

/**
 * Server Actions de Fathom (F5, F6, F10).
 *
 * Reglas: el permiso se revalida ACA; el valor de un secreto jamas vuelve al
 * navegador ni se loguea; conectar o desconectar el propio Fathom lo hace
 * cualquier miembro, pero solo sobre SU conexion.
 */

export type FathomActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const INTEGRATIONS_PATH = "/dashboard/settings/integrations";
const MI_FATHOM_PATH = "/dashboard/llamadas/mi-fathom";

/** Largos razonables, para atajar un pegado equivocado (la validez la decide Fathom). */
export function validateFathomApp(input: { clientId: string; clientSecret: string }): string | null {
  const id = input.clientId.trim();
  const secret = input.clientSecret.trim();
  if (id.length < 8 || id.length > 200 || /\s/.test(id)) return "El Client ID no parece válido";
  if (secret.length < 8 || secret.length > 400 || /\s/.test(secret)) return "El Client Secret no parece válido";
  return null;
}

/** Guarda (o reemplaza) la app OAuth de Fathom en Vault. Con `integrations.manage`. */
export async function saveFathomApp(input: { clientId: string; clientSecret: string }): Promise<FathomActionResult> {
  const ctx = await getPermissionAction("integrations.manage");
  if (!ctx) return { ok: false, error: "No tenés permiso para administrar integraciones" };

  const problem = validateFathomApp(input);
  if (problem) return { ok: false, error: problem };

  // El permiso ya se verifico arriba: el guardado va con el cliente de servicio.
  const service = await createServiceClient();
  const id = await storeSecret(service, ctx.workspace.id, SECRET_NAMES.fathomClientId, input.clientId.trim());
  if (!id.ok) return { ok: false, error: "No pude guardar el Client ID" };
  const secret = await storeSecret(service, ctx.workspace.id, SECRET_NAMES.fathomClientSecret, input.clientSecret.trim());
  if (!secret.ok) return { ok: false, error: "No pude guardar el Client Secret" };

  await logAudit({
    supabase: ctx.supabase,
    workspaceId: ctx.workspace.id,
    entityType: "workspace",
    entityId: ctx.workspace.id,
    action: "update",
    // Solo que se guardo: nunca el valor.
    metadata: { kind: "fathom_app_saved" },
    performedBy: ctx.user.id,
  });

  revalidatePath(INTEGRATIONS_PATH);
  revalidatePath(MI_FATHOM_PATH);
  return { ok: true };
}

/** Desconecta la cuenta de Fathom DE LA PERSONA. Las llamadas que ya entraron no cambian. */
export async function disconnectFathom(connectionId: string): Promise<FathomActionResult> {
  const ctx = await getMemberAction();
  if (!ctx) return { ok: false, error: "Tenés que iniciar sesión" };

  const service = await createServiceClient();
  const { data: connection } = await service
    .from("oauth_connections")
    .select("id, workspace_id, user_id, vault_secret_prefix, account_label")
    .eq("id", connectionId)
    .eq("provider", "fathom")
    .eq("workspace_id", ctx.workspace.id)
    .maybeSingle();
  // Solo la propia: otra persona no puede desconectar la tuya.
  if (!connection || connection.user_id !== ctx.user.id) return { ok: false, error: "No encontré esa conexión" };

  const result = await revokeFathomConnection(service, connection);
  if (!result.ok) return result;

  await logAudit({
    supabase: ctx.supabase,
    workspaceId: ctx.workspace.id,
    entityType: "oauth_connection",
    entityId: connection.id,
    action: "delete",
    metadata: { provider: "fathom", kind: "disconnected" },
    performedBy: ctx.user.id,
  });

  revalidatePath(MI_FATHOM_PATH);
  return { ok: true };
}

/** Una vez por minuto por persona. */
const SYNC_NOW_LIMIT_PER_MINUTE = 1;

/** "Sincronizar ahora": encola el mismo job de su conexion, sin esperar a los 10 minutos. */
export async function syncFathomNow(): Promise<FathomActionResult<{ message: string }>> {
  const ctx = await getMemberAction();
  if (!ctx) return { ok: false, error: "Tenés que iniciar sesión" };

  const service = await createServiceClient();
  const { data: connection } = await service
    .from("oauth_connections")
    .select("id, status")
    .eq("workspace_id", ctx.workspace.id)
    .eq("provider", "fathom")
    .eq("user_id", ctx.user.id)
    .in("status", ["active", "attention"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!connection) return { ok: false, error: "Todavía no conectaste tu Fathom" };

  const now = new Date();
  const windowStart = new Date(Math.floor(now.getTime() / 60_000) * 60_000).toISOString();
  const { data: count } = await service.rpc("bump_rate_limit", { p_key: `fathom-sync-now:${ctx.user.id}`, p_window_start: windowStart });
  if (typeof count === "number" && count > SYNC_NOW_LIMIT_PER_MINUTE) {
    return { ok: false, error: "Ya pediste sincronizar hace un momento. Esperá un minuto." };
  }

  const queued = await queueFathomSyncNow(service, connection.id, now);
  if (!queued.queued && queued.reason === "already") return { ok: true, message: "Ya se está sincronizando" };
  if (!queued.queued) return { ok: false, error: "No pude pedir la sincronización. Probá de nuevo en un rato." };
  return { ok: true, message: "Listo: en un par de minutos entran las llamadas nuevas" };
}
