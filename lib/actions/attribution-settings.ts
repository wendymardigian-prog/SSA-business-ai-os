"use server";

import { revalidatePath } from "next/cache";
import { getPermissionAction } from "@/lib/auth/guards";
import { logAudit } from "@/lib/audit";
import { createServiceClient } from "@/lib/supabase/server";
import {
  attributionSettingsSchema,
  MAX_INHERIT_DAYS,
  MIN_INHERIT_DAYS,
  parseAttributionSettings,
  type AttributionSettings,
} from "@/lib/attribution/settings";
import type { Json } from "@/lib/types/database";

/**
 * La configuración de atribución (Extra I, F31): `workspaces.attribution_settings`. Se escribe SOLO acá, con el
 * cliente de servicio, DESPUÉS de `settings.general`, tocando únicamente esa columna y en el workspace de la sesión
 * (la RLS de `workspaces` es de Admin y esta clave puede darse a un rol que no lo es).
 */

const NO_PERMISSION = "No tenés permiso para cambiar la atribución";

export type AttributionSettingsResult = { ok: true; settings: AttributionSettings } | { ok: false; error: string };

/** Un mensaje claro para lo primero que no cierra; el esquema estricto es la última palabra. */
function validationError(input: unknown): string {
  const raw = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  const days = raw.content_inherit_days;
  if (typeof days !== "number" || !Number.isInteger(days) || days < MIN_INHERIT_DAYS || days > MAX_INHERIT_DAYS) {
    return `Los días de herencia van de ${MIN_INHERIT_DAYS} a ${MAX_INHERIT_DAYS}`;
  }
  return "La configuración de atribución no es válida";
}

export async function updateAttributionSettings(input: unknown): Promise<AttributionSettingsResult> {
  const ctx = await getPermissionAction("settings.general");
  if (!ctx) return { ok: false, error: NO_PERMISSION };

  const parsed = attributionSettingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: validationError(input) };
  const next = parsed.data;

  const service = await createServiceClient();
  const { data: row, error: readError } = await service.from("workspaces").select("attribution_settings").eq("id", ctx.workspace.id).maybeSingle();
  if (readError) {
    console.error("[attribution] no pude leer la configuración:", readError.message);
    return { ok: false, error: "No pude guardar el cambio" };
  }
  const before = parseAttributionSettings((row as { attribution_settings?: unknown } | null)?.attribution_settings);

  const { error } = await service
    .from("workspaces")
    .update({ attribution_settings: next as unknown as Json } as never)
    .eq("id", ctx.workspace.id);
  if (error) {
    console.error("[attribution] no pude guardar la configuración:", error.message);
    return { ok: false, error: "No pude guardar el cambio" };
  }

  await logAudit({
    supabase: ctx.supabase,
    workspaceId: ctx.workspace.id,
    entityType: "workspace",
    entityId: ctx.workspace.id,
    action: "attribution.settings_updated",
    changes: { attribution_settings: { old: before as unknown as Json, new: next as unknown as Json } },
    performedBy: ctx.user.id,
  });
  revalidatePath("/dashboard/settings");
  return { ok: true, settings: next };
}
