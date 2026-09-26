"use server";

import { revalidatePath } from "next/cache";
import { getAdminContext } from "@/lib/auth/guards";
import { logAudit } from "@/lib/audit";

/**
 * El efecto de una etiqueta sobre el agente (Bloque 2d-A, 00073).
 *
 * Solo Owner/Admin: lo decide la RLS de tags (policies por comando de la 00073)
 * y se repite aca para devolver un mensaje claro. Se escribe con el cliente
 * del usuario, asi la base sigue siendo la que decide.
 *
 * Prender "Apaga el agente" en una etiqueta que ya esta puesta la aplica en
 * sus contactos en ese momento, y apagarlo libera las conversaciones que
 * habia apagado (trigger tags_effect_changed). Cambiar a quien asigna NO
 * reasigna los contactos que ya la tienen: vale para las que se pongan despues.
 */

export type TagEffectResult = { ok: true } | { ok: false; error: string };

const UUID = /^[0-9a-f-]{36}$/i;

export async function setTagEffect(
  tagId: string,
  effect: { disablesAgent: boolean; assignsTo: string | null },
): Promise<TagEffectResult> {
  const ctx = await getAdminContext();
  if (!ctx) return { ok: false, error: "Solo Owner y Admin pueden cambiar el efecto de una etiqueta." };
  const { workspace, supabase, user } = ctx;

  if (typeof tagId !== "string" || !UUID.test(tagId) || typeof effect?.disablesAgent !== "boolean") {
    return { ok: false, error: "Pedido invalido." };
  }
  const assignsTo = effect.assignsTo ?? null;
  if (assignsTo !== null && (typeof assignsTo !== "string" || !UUID.test(assignsTo))) {
    return { ok: false, error: "Pedido invalido." };
  }

  const { data: tag } = await supabase
    .from("tags")
    .select("id, name, disables_agent, assigns_to")
    .eq("id", tagId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();
  if (!tag) return { ok: false, error: "No encontré esa etiqueta." };

  if (assignsTo) {
    const { data: member } = await supabase
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", workspace.id)
      .eq("user_id", assignsTo)
      .maybeSingle();
    if (!member) return { ok: false, error: "Esa persona no es parte del equipo." };
  }

  if (tag.disables_agent === effect.disablesAgent && (tag.assigns_to ?? null) === assignsTo) return { ok: true };

  const { error } = await supabase
    .from("tags")
    .update({ disables_agent: effect.disablesAgent, assigns_to: assignsTo })
    .eq("id", tag.id)
    .eq("workspace_id", workspace.id);
  if (error) {
    console.error("[tags] no pude cambiar el efecto de la etiqueta:", error.message);
    return { ok: false, error: "No pude guardar el cambio. Probá de nuevo." };
  }

  await logAudit({
    supabase,
    workspaceId: workspace.id,
    entityType: "tag",
    entityId: tag.id,
    action: "update",
    changes: {
      ...(tag.disables_agent !== effect.disablesAgent ? { disables_agent: { old: tag.disables_agent, new: effect.disablesAgent } } : {}),
      ...((tag.assigns_to ?? null) !== assignsTo ? { assigns_to: { old: tag.assigns_to, new: assignsTo } } : {}),
    },
    metadata: { tag_name: tag.name },
    performedBy: user.id,
  });

  revalidatePath("/dashboard/agents", "layout");
  revalidatePath("/dashboard/inbox");
  revalidatePath("/dashboard/contacts", "layout");
  return { ok: true };
}
