"use server";

import { getAnyPermissionAction } from "@/lib/auth/guards";
import { getWorkspace } from "@/lib/workspace";
import { getWorkspaceMembers } from "@/lib/workspace-members";

/**
 * Lo que el editor de automatizaciones necesita para ofrecer un paso que manda por un canal (Tirón 2, D3).
 *
 * Los canales de WhatsApp CONECTADOS del workspace de la sesión, para elegir cuál manda «Enviar WhatsApp a un número».
 * Lo abre quien arma flujos (`flows.edit`) o quien administra integraciones; lee con su sesión, así que la RLS decide qué
 * canales ve. Solo se ofrecen los que pueden mandar de verdad: WhatsApp por Evolution, activo y con su instancia.
 *
 * En un archivo `"use server"` todo lo exportado es una función asincrónica.
 */
export async function loadWhatsAppChannelOptions(): Promise<{ ok: true; channels: Array<{ id: string; name: string }> } | { ok: false; error: string }> {
  const ctx = await getAnyPermissionAction(["flows.edit", "integrations.manage"]);
  if (!ctx) return { ok: false, error: "No tenés permiso para ver los canales." };

  const { data, error } = await ctx.supabase
    .from("channels")
    .select("id, display_name, username, evolution_instance")
    .eq("workspace_id", ctx.workspace.id)
    .eq("platform", "whatsapp")
    .eq("provider", "evolution")
    .eq("is_active", true)
    .order("created_at");
  if (error) {
    console.error("[flows] no pude listar los canales de WhatsApp:", error.message);
    return { ok: false, error: "No pude cargar los canales de WhatsApp." };
  }

  return {
    ok: true,
    channels: (data ?? [])
      .filter((c) => !!c.evolution_instance)
      .map((c) => ({ id: c.id, name: c.display_name?.trim() || c.username?.trim() || "WhatsApp" })),
  };
}

/**
 * Las personas del equipo que ofrecen los pasos del lienzo que eligen gente (como «Avisar en la campana»).
 * Lo abre quien arma el flujo; es el mismo dato que ya ven los demas selectores de personas (id y nombre de gente del
 * mismo workspace).
 */
export async function loadTeamMemberOptions(): Promise<{ members: Array<{ id: string; name: string }> }> {
  const { workspace } = await getWorkspace();
  const members = await getWorkspaceMembers(workspace.id);
  return { members: members.map((m) => ({ id: m.userId, name: m.name })) };
}
