"use server";

import { revalidatePath } from "next/cache";
import { getPermissionAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { businessDomain, normalizeDomainInput } from "@/lib/public-url";
import { checkDomainPointsHere } from "@/lib/settings/domain-check";

/**
 * Ajustes → General → «Dominio de tus links»: el dominio propio de los links públicos del negocio
 * (`workspaces.scheduling_public_base_url`, ver `lib/public-url.ts`).
 *
 * Pide `settings.general`. Como el resto de Ajustes, escribe con el cliente de servicio DESPUÉS del guard, filtrando
 * por el workspace de la sesión. Antes de guardar un dominio se comprueba que llegue a ESTE sistema: uno mal apuntado
 * rompería la agenda, los formularios y las bajas. Vacío = volver al dominio principal (no hace falta comprobar nada).
 */
export async function saveBusinessDomain(raw: string): Promise<{ ok: true; domain: string | null } | { ok: false; error: string }> {
  const ctx = await getPermissionAction("settings.general");
  if (!ctx) return { ok: false, error: "No tenés permiso para cambiar esto." };
  const { workspace, user, supabase } = ctx;

  const parsed = normalizeDomainInput(typeof raw === "string" ? raw : "");
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const previous = businessDomain(workspace);
  if (parsed.origin === previous) return { ok: true, domain: previous };

  if (parsed.origin) {
    const check = await checkDomainPointsHere(parsed.origin);
    if (!check.ok) return { ok: false, error: check.error };
  }

  const service = await createServiceClient();
  const { error } = await service.from("workspaces").update({ scheduling_public_base_url: parsed.origin }).eq("id", workspace.id);
  if (error) {
    console.error("[ajustes] no pude guardar el dominio del negocio:", error.message);
    return { ok: false, error: "No pude guardar el cambio. Probá de nuevo." };
  }

  await logAudit({
    supabase,
    workspaceId: workspace.id,
    entityType: "workspace",
    entityId: workspace.id,
    action: "update",
    changes: { public_domain: { old: previous, new: parsed.origin } },
    metadata: { kind: "business_domain" },
    performedBy: user.id,
  });

  // Los links aparecen en muchas pantallas (agenda, formularios, webhooks, tu sitio web): se refresca todo el panel.
  revalidatePath("/dashboard", "layout");
  return { ok: true, domain: parsed.origin };
}
