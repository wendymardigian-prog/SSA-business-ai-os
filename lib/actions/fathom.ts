"use server";

import { revalidatePath } from "next/cache";
import { getMemberAction, getPermissionAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { storeSecret, SECRET_NAMES } from "@/lib/vault";
import { revokeFathomConnection } from "@/lib/fathom/revoke";
import { queueFathomSyncNow } from "@/lib/fathom/queue";
import { validateFathomApp } from "@/lib/fathom/app-validation";
import { loadRecorderCandidates } from "@/lib/fathom/ingest";
import { resumeHistoryImport, startHistoryImport, stopHistoryImport } from "@/lib/fathom/history-import";
import { validateRecorderEmails } from "@/lib/fathom/recorder-emails";
import { nextFathomSettings, parseFathomSettings, type FathomSettingsInput } from "@/lib/fathom/settings";
import { categoryGroups } from "@/lib/calls/catalog";
import { listCategories, toCategoryRow } from "@/lib/scheduling/data/event-types";
import type { Json } from "@/lib/types/database";

/**
 * Server Actions de Fathom (F5, F6, F10).
 *
 * Reglas: el permiso se revalida ACA; el valor de un secreto jamas vuelve al
 * navegador ni se loguea; usar el propio Fathom pide `calls.view` y siempre es
 * sobre SU conexion, que sale de la sesion. Desconectarse lo puede cualquier
 * miembro: quien perdio el permiso igual tiene que poder cortar su conexion.
 */

export type FathomActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const INTEGRATIONS_PATH = "/dashboard/settings/integrations";
const MI_FATHOM_PATH = "/dashboard/llamadas/mi-fathom";

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
  const ctx = await getPermissionAction("calls.view");
  if (!ctx) return { ok: false, error: NO_CALLS_PERMISSION };

  const service = await createServiceClient();
  const connection = await myLiveConnection(service, ctx.workspace.id, ctx.user.id);
  if (!connection) return { ok: false, error: "Todavía no conectaste tu Fathom" };

  const now = new Date();
  const windowStart = new Date(Math.floor(now.getTime() / 60_000) * 60_000).toISOString();
  const { data: count } = await service.rpc("bump_rate_limit", { p_key: `fathom-sync-now:${ctx.user.id}`, p_window_start: windowStart });
  if (typeof count === "number" && count > SYNC_NOW_LIMIT_PER_MINUTE) {
    return { ok: false, error: "Ya pediste sincronizar hace un momento. Esperá un minuto." };
  }

  if (parseFathomSettings(connection.fathom_settings).mode === "manual") {
    return { ok: false, error: "Tu Fathom está en manual: traé las llamadas con Importar historial, en Mi Fathom." };
  }

  const queued = await queueFathomSyncNow(service, connection.id, now);
  if (!queued.queued && queued.reason === "already") return { ok: true, message: "Ya se está sincronizando" };
  if (!queued.queued) return { ok: false, error: "No pude pedir la sincronización. Probá de nuevo en un rato." };
  return { ok: true, message: "Listo: en un par de minutos entran las llamadas nuevas" };
}

const NO_CALLS_PERMISSION = "Tu rol no tiene permiso para ver grabaciones";

type Service = Awaited<ReturnType<typeof createServiceClient>>;

/** La conexion que sirve de esta persona: siempre la propia, por la sesion. */
async function myLiveConnection(service: Service, workspaceId: string, userId: string) {
  const { data } = await service
    .from("oauth_connections")
    .select("id, status, fathom_settings")
    .eq("workspace_id", workspaceId)
    .eq("provider", "fathom")
    .eq("user_id", userId)
    .in("status", ["active", "attention"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

/**
 * Los otros correos con los que esta persona graba en Fathom. Al sumar uno, la
 * proxima consulta vuelve a mirar los ultimos 14 dias: si no, las llamadas que ya
 * paso con ese correo no entrarian nunca.
 */
export async function saveMyFathomEmails(emails: string[]): Promise<FathomActionResult<{ emails: string[] }>> {
  const ctx = await getPermissionAction("calls.view");
  if (!ctx) return { ok: false, error: NO_CALLS_PERMISSION };

  const service = await createServiceClient();
  const candidates = await loadRecorderCandidates(service, ctx.workspace.id);
  const me = candidates.find((c) => c.userId === ctx.user.id);
  if (!me) return { ok: false, error: "No encontré tu lugar en el equipo" };

  const checked = validateRecorderEmails(ctx.user.id, emails, candidates);
  if (!checked.ok) return checked;

  const { error } = await service
    .from("workspace_members")
    .update({ closer_emails: checked.emails })
    .eq("workspace_id", ctx.workspace.id)
    .eq("user_id", ctx.user.id);
  if (error) return { ok: false, error: "No pude guardar los correos. Probá de nuevo." };

  const before = me.extraEmails;
  await logAudit({
    supabase: ctx.supabase,
    workspaceId: ctx.workspace.id,
    entityType: "workspace_member",
    entityId: ctx.user.id,
    action: "update",
    changes: { closer_emails: { old: before, new: checked.emails } },
    performedBy: ctx.user.id,
  });

  const added = checked.emails.some((e) => !before.includes(e));
  if (added) {
    const connection = await myLiveConnection(service, ctx.workspace.id, ctx.user.id);
    if (connection) {
      await service.from("oauth_connections").update({ sync_watermark: null, sync_cursor: null }).eq("id", connection.id);
      await queueFathomSyncNow(service, connection.id);
    }
  }

  revalidatePath(MI_FATHOM_PATH);
  return { ok: true, emails: checked.emails };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Que importa una conexion: la propia, con `calls.view`, o la de otra persona, con
 * `calls.configure` (si no, alguien podria dejar sus llamadas afuera sin que nadie lo vea).
 */
export async function saveFathomSettings(input: { connectionId?: string | null; settings: FathomSettingsInput }): Promise<FathomActionResult<{ message: string }>> {
  const ctx = await getMemberAction();
  if (!ctx) return { ok: false, error: "Tenés que iniciar sesión" };
  const otherId = input.connectionId ?? null;
  if (otherId !== null && !UUID.test(otherId)) return { ok: false, error: "Los datos no son válidos" };

  const service = await createServiceClient();
  let query = service
    .from("oauth_connections")
    .select("id, user_id, fathom_settings")
    .eq("workspace_id", ctx.workspace.id)
    .eq("provider", "fathom")
    .in("status", ["active", "attention", "error"]);
  query = otherId ? query.eq("id", otherId) : query.eq("user_id", ctx.user.id);
  const { data: connection } = await query.order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!connection) return { ok: false, error: "No encontré esa conexión" };

  const own = connection.user_id === ctx.user.id;
  if (!ctx.can(own ? "calls.view" : "calls.configure")) return { ok: false, error: own ? NO_CALLS_PERMISSION : "No tenés permiso para cambiar la conexión de otra persona" };

  const before = parseFathomSettings(connection.fathom_settings);
  const areas = categoryGroups((await listCategories(service, ctx.workspace.id)).map(toCategoryRow)).map((g) => g.areaId);
  const next = nextFathomSettings(before, input.settings, areas, new Date());
  if (!next.ok) return next;

  const { error } = await service.from("oauth_connections").update({ fathom_settings: next.settings as unknown as Json }).eq("id", connection.id).eq("workspace_id", ctx.workspace.id);
  if (error) return { ok: false, error: "No pude guardar el cambio. Probá de nuevo." };

  await logAudit({
    supabase: ctx.supabase,
    workspaceId: ctx.workspace.id,
    entityType: "oauth_connection",
    entityId: connection.id,
    action: "update",
    changes: { fathom_settings: { old: before as unknown as Json, new: next.settings as unknown as Json } },
    metadata: { provider: "fathom", kind: "settings_changed", ...(own ? {} : { on_behalf_of: connection.user_id }) },
    performedBy: ctx.user.id,
  });
  revalidatePath(MI_FATHOM_PATH);

  if (next.settings.mode === "manual") return { ok: true, message: "Guardado. Traé las llamadas con Importar historial." };
  // Sale de manual: la consulta arranca ahora. Lo anterior se trae con Importar, para no disparar flujos de golpe.
  if (before.mode === "manual") return { ok: true, message: "Guardado. Lo que grabes desde ahora entra solo; lo anterior traelo con Importar historial." };
  return { ok: true, message: "Guardado." };
}

const DAY_ISO = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/;

/** Arranca una importacion del historial: todo (`from` null) o desde esa fecha. */
export async function startFathomHistoryImport(input: { from: string | null; classifyAi?: boolean }): Promise<FathomActionResult> {
  const ctx = await getPermissionAction("calls.view");
  if (!ctx) return { ok: false, error: NO_CALLS_PERMISSION };
  if (input.from !== null && !DAY_ISO.test(input.from)) return { ok: false, error: "La fecha no es válida" };

  const service = await createServiceClient();
  const connection = await myLiveConnection(service, ctx.workspace.id, ctx.user.id);
  if (!connection) return { ok: false, error: "Todavía no conectaste tu Fathom" };

  const classifyAi = input.classifyAi === true;
  const result = await startHistoryImport({ supabase: service }, connection.id, input.from, { classifyAi });
  if (!result.ok) return result;

  await logAudit({
    supabase: ctx.supabase,
    workspaceId: ctx.workspace.id,
    entityType: "oauth_connection",
    entityId: connection.id,
    action: "update",
    metadata: { provider: "fathom", kind: "history_import_started", from: input.from, classify_ai: classifyAi },
    performedBy: ctx.user.id,
  });
  revalidatePath(MI_FATHOM_PATH);
  return { ok: true };
}

/** Sigue una importacion incompleta o frenada desde donde quedo. */
export async function resumeFathomHistoryImport(): Promise<FathomActionResult> {
  const ctx = await getPermissionAction("calls.view");
  if (!ctx) return { ok: false, error: NO_CALLS_PERMISSION };

  const service = await createServiceClient();
  const connection = await myLiveConnection(service, ctx.workspace.id, ctx.user.id);
  if (!connection) return { ok: false, error: "Reconectá tu Fathom para seguir con la importación" };

  const result = await resumeHistoryImport({ supabase: service }, connection.id);
  revalidatePath(MI_FATHOM_PATH);
  return result;
}

/** Frena la importacion en curso. Lo que ya entro queda. */
export async function stopFathomHistoryImport(): Promise<FathomActionResult> {
  const ctx = await getPermissionAction("calls.view");
  if (!ctx) return { ok: false, error: NO_CALLS_PERMISSION };

  const service = await createServiceClient();
  const connection = await myLiveConnection(service, ctx.workspace.id, ctx.user.id);
  if (!connection) return { ok: false, error: "No hay ninguna importación en curso" };

  const result = await stopHistoryImport({ supabase: service }, connection.id);
  revalidatePath(MI_FATHOM_PATH);
  return result;
}
