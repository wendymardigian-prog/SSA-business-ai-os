"use server";

import { revalidatePath } from "next/cache";
import { getAuthUser } from "@/lib/supabase/auth-user";
import { getMemberAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { SESSION_CLIENT_ID } from "@/lib/mcp/auth";
import type { McpConnectionView } from "@/lib/mcp/connection-types";

/**
 * Las conexiones MCP de cada persona (docs/mcp.md): el consentimiento («Permitir» en /oauth/consent) y la tarjeta de
 * Mi cuenta → Conexiones. La persona sale SIEMPRE de la sesión; el negocio elegido se comprueba con su sesión
 * (`has_permission(..., 'mcp.usar')`, la misma regla de toda la app). Escribe el servidor (`mcp_connections` no tiene
 * políticas de escritura).
 */

type Fail = { ok: false; error: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function canUseMcpIn(workspaceId: string): Promise<boolean> {
  const { supabase } = await getAuthUser();
  const { data } = await supabase.rpc("has_permission" as never, { p_workspace_id: workspaceId, p_key: "mcp.usar" } as never);
  return data === true;
}

/** «Permitir» en el consentimiento: aprueba en Supabase y guarda el negocio de la conexión. */
export async function approveMcpAuthorization(input: { authorizationId: string; workspaceId: string }): Promise<{ ok: true; redirectUrl: string } | Fail> {
  const { supabase, user } = await getAuthUser();
  if (!user) return { ok: false, error: "Tu sesión terminó. Volvé a entrar." };
  if (typeof input?.authorizationId !== "string" || !input.authorizationId || input.authorizationId.length > 200) return { ok: false, error: "La autorización no es válida." };
  if (typeof input?.workspaceId !== "string" || !UUID.test(input.workspaceId)) return { ok: false, error: "Elegí un negocio." };
  if (!(await canUseMcpIn(input.workspaceId))) return { ok: false, error: "En ese negocio tu rol no tiene el permiso «Usar el MCP»." };

  const details = await supabase.auth.oauth.getAuthorizationDetails(input.authorizationId);
  if (details.error || !details.data) return { ok: false, error: "La autorización venció o no existe. Volvé a conectar desde la app." };
  const client = "authorization_id" in details.data ? details.data.client : null;

  const approved = await supabase.auth.oauth.approveAuthorization(input.authorizationId, { skipBrowserRedirect: true });
  if (approved.error || !approved.data?.redirect_url) return { ok: false, error: "No pude aprobar la conexión. Probá de nuevo." };

  if (client?.id) {
    const service = await createServiceClient();
    const { error } = await service
      .from("mcp_connections" as never)
      .upsert(
        { user_id: user.id, client_id: client.id, client_name: client.name?.slice(0, 200) || null, workspace_id: input.workspaceId, revoked_at: null, updated_at: new Date().toISOString() } as never,
        { onConflict: "user_id,client_id" },
      );
    if (error) console.error("[mcp] no pude guardar la conexión:", error.code ?? "?");
  }
  return { ok: true, redirectUrl: approved.data.redirect_url };
}

export async function denyMcpAuthorization(input: { authorizationId: string }): Promise<{ ok: true; redirectUrl: string } | Fail> {
  const { supabase, user } = await getAuthUser();
  if (!user) return { ok: false, error: "Tu sesión terminó. Volvé a entrar." };
  if (typeof input?.authorizationId !== "string" || !input.authorizationId) return { ok: false, error: "La autorización no es válida." };
  const denied = await supabase.auth.oauth.denyAuthorization(input.authorizationId, { skipBrowserRedirect: true });
  if (denied.error || !denied.data?.redirect_url) return { ok: false, error: "No pude rechazarla. Cerrá esta pestaña." };
  return { ok: true, redirectUrl: denied.data.redirect_url };
}

/** Las conexiones activas de la persona, con el nombre del negocio. */
export async function listMyMcpConnections(): Promise<{ ok: true; connections: McpConnectionView[]; workspaces: { id: string; name: string }[] } | Fail> {
  const ctx = await getMemberAction();
  if (!ctx) return { ok: false, error: "Tu sesión terminó. Volvé a entrar." };
  const [{ data: rows, error }, { data: memberships }] = await Promise.all([
    ctx.supabase
      .from("mcp_connections" as never)
      .select("id, client_id, client_name, workspace_id, created_at, last_used_at")
      .eq("user_id", ctx.user.id)
      .is("revoked_at", null)
      .order("created_at", { ascending: false }),
    ctx.supabase.from("workspace_members").select("workspace_id, workspaces(name)").eq("user_id", ctx.user.id),
  ]);
  if (error) return { ok: false, error: "No pude leer tus conexiones." };
  const names = new Map(((memberships ?? []) as { workspace_id: string; workspaces: { name: string } | null }[]).map((m) => [m.workspace_id, m.workspaces?.name ?? "—"]));
  const connections = ((rows ?? []) as { id: string; client_id: string; client_name: string | null; workspace_id: string; created_at: string; last_used_at: string | null }[]).map((r) => ({
    id: r.id,
    clientName: r.client_name || (r.client_id === SESSION_CLIENT_ID ? "Sesión de prueba" : "App conectada"),
    workspaceId: r.workspace_id,
    workspaceName: names.get(r.workspace_id) ?? "—",
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
  }));
  return { ok: true, connections, workspaces: [...names.entries()].map(([id, name]) => ({ id, name })) };
}

/** Desconectar: Supabase revoca el acceso de la app (y sus tokens) y la conexión queda marcada. */
export async function disconnectMcpConnection(input: { connectionId: string }): Promise<{ ok: true } | Fail> {
  const ctx = await getMemberAction();
  if (!ctx) return { ok: false, error: "Tu sesión terminó. Volvé a entrar." };
  if (typeof input?.connectionId !== "string" || !UUID.test(input.connectionId)) return { ok: false, error: "Conexión no válida." };
  const { data: row } = await ctx.supabase.from("mcp_connections" as never).select("id, client_id").eq("id", input.connectionId).eq("user_id", ctx.user.id).maybeSingle();
  const conn = row as { id: string; client_id: string } | null;
  if (!conn) return { ok: false, error: "No encontré esa conexión." };
  if (conn.client_id !== SESSION_CLIENT_ID) {
    const revoked = await ctx.supabase.auth.oauth.revokeGrant({ clientId: conn.client_id });
    if (revoked.error) console.error("[mcp] no pude revocar el acceso en Supabase:", revoked.error.code ?? revoked.error.name);
  }
  const service = await createServiceClient();
  const { error } = await service.from("mcp_connections" as never).update({ revoked_at: new Date().toISOString() } as never).eq("id", conn.id).eq("user_id", ctx.user.id);
  if (error) return { ok: false, error: "No pude desconectarla. Probá de nuevo." };
  revalidatePath("/dashboard/cuenta");
  return { ok: true };
}

export async function changeMcpConnectionWorkspace(input: { connectionId: string; workspaceId: string }): Promise<{ ok: true } | Fail> {
  const ctx = await getMemberAction();
  if (!ctx) return { ok: false, error: "Tu sesión terminó. Volvé a entrar." };
  if (typeof input?.connectionId !== "string" || !UUID.test(input.connectionId) || typeof input?.workspaceId !== "string" || !UUID.test(input.workspaceId)) {
    return { ok: false, error: "Datos no válidos." };
  }
  if (!(await canUseMcpIn(input.workspaceId))) return { ok: false, error: "En ese negocio tu rol no tiene el permiso «Usar el MCP»." };
  const service = await createServiceClient();
  const { data, error } = await service
    .from("mcp_connections" as never)
    .update({ workspace_id: input.workspaceId, updated_at: new Date().toISOString() } as never)
    .eq("id", input.connectionId)
    .eq("user_id", ctx.user.id)
    .is("revoked_at", null)
    .select("id");
  if (error || !data || (data as unknown[]).length === 0) return { ok: false, error: "No pude cambiar el negocio." };
  revalidatePath("/dashboard/cuenta");
  return { ok: true };
}
