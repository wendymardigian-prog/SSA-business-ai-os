"use server";

import { revalidatePath } from "next/cache";
import { getPermissionAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { parseWebsiteSettings, serializeWebsiteSettings, validateOriginsInput, type OriginsInput } from "@/lib/settings/website";

/**
 * Ajustes → Integraciones → Tu sitio web: los orígenes desde los que la web del negocio
 * puede mandar formularios y pedir un link de baja (`workspaces.website_settings`, 00277).
 *
 * Pide `integrations.manage`. Como el resto de Ajustes, escribe con el cliente de servicio
 * DESPUÉS del guard, filtrando por el workspace de la sesión (la política de `workspaces`
 * no se toca). La lista se vuelve a validar entera acá: el navegador no es de fiar.
 */
export async function saveWebsiteOrigins(
  input: OriginsInput,
): Promise<{ ok: true; origins: Array<{ origin: string; dev: boolean }> } | { ok: false; error: string; errors?: Record<number, string> }> {
  const ctx = await getPermissionAction("integrations.manage");
  if (!ctx) return { ok: false, error: "No tenés permiso para cambiar esto." };
  const { workspace, user, supabase } = ctx;

  const checked = validateOriginsInput(input);
  if (!checked.ok) return { ok: false, error: checked.message, errors: checked.errors };

  const service = await createServiceClient();
  const { data: before } = await service.from("workspaces").select("website_settings").eq("id", workspace.id).maybeSingle();
  const { error } = await service
    .from("workspaces")
    .update({ website_settings: serializeWebsiteSettings(checked.settings) })
    .eq("id", workspace.id);
  if (error) {
    console.error("[ajustes] no pude guardar los orígenes del sitio:", error.message);
    return { ok: false, error: "No pude guardar el cambio. Probá de nuevo." };
  }

  const previous = parseWebsiteSettings(before?.website_settings).allowedOrigins;
  const next = checked.settings.allowedOrigins;
  const key = (list: typeof next) => list.map((o) => `${o.origin}|${o.dev}`).join(",");
  if (key(previous) !== key(next)) {
    await logAudit({
      supabase,
      workspaceId: workspace.id,
      entityType: "workspace",
      entityId: workspace.id,
      action: "update",
      changes: { website_allowed_origins: { old: serializeWebsiteSettings({ allowedOrigins: previous }).allowed_origins, new: serializeWebsiteSettings(checked.settings).allowed_origins } },
      metadata: { kind: "website_settings" },
      performedBy: user.id,
    });
  }

  revalidatePath("/dashboard/settings/integrations/sitio-web");
  revalidatePath("/dashboard/settings/integrations");
  return { ok: true, origins: next.map((o) => ({ origin: o.origin, dev: o.dev })) };
}
