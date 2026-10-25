"use server";

import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getPermissionAction } from "@/lib/auth/guards";
import { logAudit, diffFields } from "@/lib/audit";
import { setActiveWorkspaceCookie } from "@/lib/workspace";
import { isValidTimeZone } from "@/lib/timezone";
import type { Json } from "@/lib/types/database";
import { randomUUID } from "node:crypto";
import { BRAND_ASSETS_BUCKET, brandLogoPublicUrl } from "@/lib/brand";
import { brandLogoPath, isOwnLogoPath, parseBrandLogo, parseBrandSettings } from "@/lib/brand-settings";

export async function switchWorkspace(workspaceId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  // Validate user has access to this workspace
  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .eq("workspace_id", workspaceId)
    .single();

  if (!membership) return { error: "No access to this workspace" };

  await setActiveWorkspaceCookie(workspaceId);

  return { ok: true };
}

// No hay `createWorkspace` en la app: el primer Owner de una copia nueva lo
// crea scripts/create-owner.mjs, y un segundo negocio del mismo dueño en la
// misma instalacion, scripts/create-workspace.mjs. La accion que habia fallaba igual: no existe una
// policy de INSERT sobre `workspaces`.

/**
 * La media del chat: si se guarda y cuanto se conserva (F2, F5).
 *
 * Son dos columnas y una sola pantalla, asi que van en una sola accion: si
 * fueran dos, cambiar las dos cosas seria dos escrituras y dos entradas en el
 * audit para una sola decision de la persona.
 *
 * Mismo criterio que el guardado de mensajes: es configuracion del workspace,
 * asi que pide `settings.general`.
 */
export async function updateChatMediaSettings(input: {
  enabled: boolean;
  retentionDays: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await getPermissionAction("settings.general");
  if (!ctx) {
    return { ok: false, error: "No tenés permiso para cambiar la configuración de la media del chat" };
  }

  // Se valida en el servidor y no solo en el select: la accion es una puerta
  // publica, y el CHECK de la base devolveria un error crudo de Postgres.
  if (!Number.isInteger(input.retentionDays) || input.retentionDays < 0 || input.retentionDays > 3650) {
    return { ok: false, error: "La retención tiene que ser un número de días entre 0 y 3650" };
  }

  const { workspace, supabase, user } = ctx;

  const { data: before } = await supabase
    .from("workspaces")
    .select("persist_chat_media, chat_media_retention_days")
    .eq("id", workspace.id)
    .maybeSingle();

  // `workspaces` solo lo escribe un Admin por RLS: aca se escribe con el cliente de servicio, DESPUES del guard
  // y siempre sobre el workspace de la sesion (nunca uno que venga del navegador).
  const { error } = await (await createServiceClient())
    .from("workspaces")
    .update({ persist_chat_media: input.enabled, chat_media_retention_days: input.retentionDays })
    .eq("id", workspace.id);

  if (error) {
    console.error("[workspace] no pude cambiar la media del chat:", error.message);
    return { ok: false, error: `No pude guardar el cambio: ${error.message}` };
  }

  await logAudit({
    supabase,
    workspaceId: workspace.id,
    entityType: "workspace",
    entityId: workspace.id,
    action: "update",
    changes: {
      persist_chat_media: { old: before?.persist_chat_media ?? null, new: input.enabled },
      chat_media_retention_days: {
        old: before?.chat_media_retention_days ?? null,
        new: input.retentionDays,
      },
    },
    performedBy: user.id,
  });

  revalidatePath("/dashboard/settings");
  return { ok: true };
}

/**
 * Zona horaria del workspace (F3). Los dashboards del Bloque 3 cortan los días
 * en esta zona. Se valida en el servidor: una zona inválida se rechaza con un
 * mensaje claro, nunca se guarda.
 */
export async function updateWorkspaceTimezone(
  timezone: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await getPermissionAction("settings.general");
  if (!ctx) {
    return { ok: false, error: "No tenés permiso para cambiar la zona horaria" };
  }
  if (!isValidTimeZone(timezone)) {
    return { ok: false, error: "Esa zona horaria no es válida" };
  }

  const { workspace, supabase, user } = ctx;

  const { data: prev } = await supabase
    .from("workspaces")
    .select("timezone")
    .eq("id", workspace.id)
    .single();

  const { error } = await (await createServiceClient())
    .from("workspaces")
    .update({ timezone })
    .eq("id", workspace.id);

  if (error) {
    console.error("[workspace] no pude cambiar la zona horaria:", error.message);
    return { ok: false, error: `No pude guardar el cambio: ${error.message}` };
  }

  await logAudit({
    supabase,
    workspaceId: workspace.id,
    entityType: "workspace",
    entityId: workspace.id,
    action: "update",
    changes: { timezone: { old: (prev as { timezone?: string } | null)?.timezone ?? null, new: timezone } },
    performedBy: user.id,
  });

  revalidatePath("/dashboard/settings");
  return { ok: true };
}

/**
 * Nombre del workspace y palabras clave globales (F20).
 *
 * Antes esto se guardaba con un update directo desde el navegador. Funcionaba,
 * pero no habia donde registrar quien cambio que: el audit log necesita correr
 * del lado del servidor, con el usuario ya resuelto. Es la razon por la que
 * existe esta accion.
 *
 * Las palabras clave no son decoracion: disparan flows y dan de baja
 * contactos. Que se cambien sin dejar rastro es exactamente el caso que F20
 * viene a cubrir.
 */
export async function updateWorkspaceSettings(settings: {
  name?: string;
  globalKeywords?: unknown[];
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await getPermissionAction("settings.general");
  if (!ctx) return { ok: false, error: "No tenés permiso para cambiar la configuración" };

  const { workspace, supabase, user } = ctx;

  const patch: Record<string, unknown> = {};

  if (settings.name !== undefined) {
    const name = settings.name.trim();
    if (!name) return { ok: false, error: "El workspace necesita un nombre" };
    if (name.length > 100) return { ok: false, error: "El nombre es muy largo (maximo 100 caracteres)" };
    patch.name = name;
  }

  if (settings.globalKeywords !== undefined) {
    if (!Array.isArray(settings.globalKeywords)) {
      return { ok: false, error: "Formato invalido en las palabras clave" };
    }
    if (settings.globalKeywords.length > 100) {
      return { ok: false, error: "Son demasiadas palabras clave (maximo 100)" };
    }
    patch.global_keywords = settings.globalKeywords as Json;
  }

  if (Object.keys(patch).length === 0) return { ok: true };

  const { data: before } = await supabase
    .from("workspaces")
    .select("name, global_keywords")
    .eq("id", workspace.id)
    .single();

  const { error } = await (await createServiceClient()).from("workspaces").update(patch).eq("id", workspace.id);

  if (error) {
    console.error("[workspace] no pude guardar la configuracion:", error.message);
    return { ok: false, error: `No pude guardar los cambios: ${error.message}` };
  }

  // Las keywords se comparan como texto: diffFields no entra en un array, y
  // para el historial alcanza con ver que lista habia y cual quedo.
  const changes = diffFields(
    {
      name: before?.name ?? "",
      global_keywords: JSON.stringify(before?.global_keywords ?? []),
    },
    {
      name: (patch.name as string) ?? before?.name ?? "",
      global_keywords: JSON.stringify(patch.global_keywords ?? before?.global_keywords ?? []),
    },
  );

  if (changes) {
    await logAudit({
      supabase, workspaceId: workspace.id, entityType: "workspace", entityId: workspace.id,
      action: "update", changes, performedBy: user.id,
    });
  }

  revalidatePath("/dashboard/settings");
  return { ok: true };
}

/**
 * Configuración de tareas de IA en segundo plano (F23). Owner/Admin. La
 * validación (indexación no apagable, frecuencias) vive en lib/background/settings.ts.
 */
export async function updateBackgroundSettings(
  raw: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await getPermissionAction("ai_tasks.manage");
  if (!ctx) return { ok: false, error: "No tenés permiso para cambiar las tareas en segundo plano" };
  const { workspace, supabase, user } = ctx;

  const { validateBackgroundSettings, mergeBackgroundSettings } = await import("@/lib/background/settings");
  const validated = validateBackgroundSettings(raw);
  if (!validated.ok) return { ok: false, error: validated.error ?? "Configuración inválida" };

  const { data: prev } = await supabase.from("workspaces").select("ai_background_settings").eq("id", workspace.id).single();
  // Se conserva lo demas que hay en la columna (las tareas de Llamadas viven ahi).
  const merged = mergeBackgroundSettings((prev as { ai_background_settings?: unknown } | null)?.ai_background_settings, validated.settings!);
  const { error } = await (await createServiceClient()).from("workspaces").update({ ai_background_settings: merged as unknown as Json }).eq("id", workspace.id);
  if (error) {
    console.error("[workspace] no pude guardar las tareas en segundo plano:", error.message);
    return { ok: false, error: "No pude guardar el cambio." };
  }
  await logAudit({
    supabase, workspaceId: workspace.id, entityType: "workspace", entityId: workspace.id, action: "update",
    changes: { ai_background_settings: { old: ((prev as { ai_background_settings?: unknown } | null)?.ai_background_settings ?? {}) as Json, new: merged as unknown as Json } },
    performedBy: user.id,
  });
  revalidatePath("/dashboard/settings/background");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Marca del negocio (00266): nombre, color y tono de la IA, y el logo aparte.
//
// `settings.general`, como el resto de General. Se escribe con el cliente de
// servicio DESPUES del guard y siempre sobre el workspace de la sesion. Un
// campo vacio = NULL = el de la instalacion.
// ---------------------------------------------------------------------------

const NO_BRAND_PERMISSION = "No tenés permiso para cambiar la marca del negocio";

export async function updateWorkspaceBrand(input: {
  name: string;
  color: string;
  languageStyle: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await getPermissionAction("settings.general");
  if (!ctx) return { ok: false, error: NO_BRAND_PERMISSION };

  const parsed = parseBrandSettings(input);
  if (!parsed.ok) return parsed;

  const { workspace, supabase, user } = ctx;
  const service = await createServiceClient();
  const { data: before } = await service
    .from("workspaces")
    .select("brand_name, brand_color, ai_language_style")
    .eq("id", workspace.id)
    .maybeSingle();

  const { error } = await service.from("workspaces").update(parsed.values).eq("id", workspace.id);
  if (error) {
    console.error("[workspace] no pude guardar la marca:", error.message);
    return { ok: false, error: "No pude guardar la marca. Probá de nuevo." };
  }

  const changes = diffFields((before ?? {}) as Record<string, unknown>, parsed.values as unknown as Record<string, unknown>);
  if (changes) {
    await logAudit({
      supabase,
      workspaceId: workspace.id,
      entityType: "workspace",
      entityId: workspace.id,
      action: "update",
      changes,
      metadata: { kind: "brand" },
      performedBy: user.id,
    });
  }

  // El nombre, el color y el logo se ven en todo el panel (menu, selector, color).
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

/** Sube un logo nuevo (data URL, validado por sus bytes) y lo deja como el del negocio. */
export async function uploadWorkspaceLogo(input: { dataUrl: string }): Promise<{ ok: true; path: string; url: string | null } | { ok: false; error: string }> {
  const ctx = await getPermissionAction("settings.general");
  if (!ctx) return { ok: false, error: NO_BRAND_PERMISSION };

  const parsed = parseBrandLogo(input.dataUrl);
  if (!parsed.ok) return parsed;

  const { workspace, supabase, user } = ctx;
  const service = await createServiceClient();
  const { data: before } = await service.from("workspaces").select("brand_logo_path").eq("id", workspace.id).maybeSingle();

  const path = brandLogoPath(workspace.id, randomUUID(), parsed.ext);
  const { error: uploadError } = await service.storage.from(BRAND_ASSETS_BUCKET).upload(path, parsed.bytes, { contentType: parsed.mime, upsert: false });
  if (uploadError) {
    console.error("[workspace] no pude subir el logo:", uploadError.message);
    return { ok: false, error: "No pude subir el logo. Probá de nuevo." };
  }

  const { error } = await service.from("workspaces").update({ brand_logo_path: path }).eq("id", workspace.id);
  if (error) {
    console.error("[workspace] no pude guardar el logo:", error.message);
    await removeLogoFile(service, workspace.id, path);
    return { ok: false, error: "No pude guardar el logo. Probá de nuevo." };
  }

  // El anterior ya no lo usa nadie: se borra (si falla, queda un archivo suelto, nada se rompe).
  await removeLogoFile(service, workspace.id, before?.brand_logo_path);
  await logAudit({
    supabase,
    workspaceId: workspace.id,
    entityType: "workspace",
    entityId: workspace.id,
    action: "update",
    changes: { brand_logo_path: { old: before?.brand_logo_path ?? null, new: path } },
    metadata: { kind: "brand" },
    performedBy: user.id,
  });

  revalidatePath("/dashboard", "layout");
  return { ok: true, path, url: brandLogoPublicUrl(path) };
}

/** Saca el logo propio: el negocio vuelve a su inicial (o al logo de la instalacion si tampoco tiene nombre propio). */
export async function removeWorkspaceLogo(): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await getPermissionAction("settings.general");
  if (!ctx) return { ok: false, error: NO_BRAND_PERMISSION };

  const { workspace, supabase, user } = ctx;
  const service = await createServiceClient();
  const { data: before } = await service.from("workspaces").select("brand_logo_path").eq("id", workspace.id).maybeSingle();
  if (!before?.brand_logo_path) return { ok: true };

  const { error } = await service.from("workspaces").update({ brand_logo_path: null }).eq("id", workspace.id);
  if (error) {
    console.error("[workspace] no pude sacar el logo:", error.message);
    return { ok: false, error: "No pude sacar el logo. Probá de nuevo." };
  }
  await removeLogoFile(service, workspace.id, before.brand_logo_path);
  await logAudit({
    supabase,
    workspaceId: workspace.id,
    entityType: "workspace",
    entityId: workspace.id,
    action: "update",
    changes: { brand_logo_path: { old: before.brand_logo_path, new: null } },
    metadata: { kind: "brand" },
    performedBy: user.id,
  });

  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

/** Borra un logo del bucket, solo si es de ESE workspace. Nunca lanza. */
async function removeLogoFile(service: Awaited<ReturnType<typeof createServiceClient>>, workspaceId: string, path: string | null | undefined) {
  if (!isOwnLogoPath(workspaceId, path)) return;
  try {
    const { error } = await service.storage.from(BRAND_ASSETS_BUCKET).remove([path]);
    if (error) console.error("[workspace] no pude borrar el logo anterior:", error.message);
  } catch (err) {
    console.error("[workspace] no pude borrar el logo anterior:", err instanceof Error ? err.message : "error");
  }
}
