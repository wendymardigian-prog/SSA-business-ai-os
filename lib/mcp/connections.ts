import "server-only";
import { createServiceClient } from "@/lib/supabase/server";
import type { McpEnv } from "./server";

/**
 * Cambiar el negocio de una conexión MCP (`cambiar_negocio`, docs/mcp.md). Solo servidor.
 *
 * Solo a un negocio donde la persona es miembro y tiene «Usar el MCP»: se pregunta a la base con SU sesión
 * (`has_permission`, la misma regla de toda la app). Escribe el servidor, filtrando por la conexión de la persona.
 */

export async function switchConnectionWorkspace(
  env: McpEnv,
  targetId: string | null,
): Promise<{ ok: true; message: string; data: unknown } | { ok: false; message: string }> {
  const session = env.ctx.supabase;
  const { data: memberships, error } = await session
    .from("workspace_members")
    .select("workspace_id, role, workspaces(name)")
    .eq("user_id", env.ctx.user.id);
  if (error) return { ok: false, message: "No pude leer tus negocios. Probá de nuevo." };

  const options: { id: string; nombre: string; rol: string; puede_usar_mcp: boolean; actual: boolean }[] = [];
  for (const m of (memberships ?? []) as { workspace_id: string; role: string; workspaces: { name: string } | null }[]) {
    const { data: allowed } = await session.rpc("has_permission" as never, { p_workspace_id: m.workspace_id, p_key: "mcp.usar" } as never);
    options.push({ id: m.workspace_id, nombre: m.workspaces?.name ?? "—", rol: m.role, puede_usar_mcp: allowed === true, actual: m.workspace_id === env.ctx.workspace.id });
  }

  if (!targetId) return { ok: true, message: "Tus negocios. Para cambiar, llama con negocio_id.", data: options };

  const target = options.find((o) => o.id === targetId);
  if (!target) return { ok: false, message: "No sos miembro de ese negocio." };
  if (!target.puede_usar_mcp) return { ok: false, message: "En ese negocio tu rol no tiene «Usar el MCP»." };
  if (target.actual) return { ok: true, message: "Ya estás en ese negocio.", data: target };

  const service = await createServiceClient();
  const { error: updateError } = await service
    .from("mcp_connections" as never)
    .update({ workspace_id: targetId, updated_at: new Date().toISOString() } as never)
    .eq("id", env.connectionId)
    .eq("user_id", env.ctx.user.id);
  if (updateError) {
    console.error("[mcp] no pude cambiar el negocio de la conexión:", updateError.code ?? "?");
    return { ok: false, message: "No pude cambiar el negocio. Probá de nuevo." };
  }
  return { ok: true, message: `Listo: desde el próximo pedido trabajás en «${target.nombre}».`, data: target };
}
