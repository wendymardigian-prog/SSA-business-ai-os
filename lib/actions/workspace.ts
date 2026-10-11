"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAdminContext } from "@/lib/auth/guards";
import { logAudit, diffFields } from "@/lib/audit";
import { WORKSPACE_COOKIE } from "@/lib/workspace";
import { isValidTimeZone } from "@/lib/timezone";
import type { Json } from "@/lib/types/database";

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

  const cookieStore = await cookies();
  cookieStore.set(WORKSPACE_COOKIE, workspaceId, {
    path: "/",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });

  return { ok: true };
}

// No hay `createWorkspace`: el modelo es una copia del sistema por cliente
// (white label), y el primer Owner de una copia nueva lo crea
// scripts/create-owner.mjs. La accion que habia fallaba igual: no existe una
// policy de INSERT sobre `workspaces`.

/**
 * La media del chat: si se guarda y cuanto se conserva (F2, F5).
 *
 * Son dos columnas y una sola pantalla, asi que van en una sola accion: si
 * fueran dos, cambiar las dos cosas seria dos escrituras y dos entradas en el
 * audit para una sola decision de la persona.
 *
 * Mismo criterio que el guardado de mensajes: es configuracion del workspace,
 * asi que es de Owner/Admin.
 */
export async function updateChatMediaSettings(input: {
  enabled: boolean;
  retentionDays: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await getAdminContext();
  if (!ctx) {
    return { ok: false, error: "Solo Owner y Admin pueden cambiar la configuración de la media del chat" };
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

  const { error } = await supabase
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
  const ctx = await getAdminContext();
  if (!ctx) {
    return { ok: false, error: "Solo Owner y Admin pueden cambiar la zona horaria" };
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

  const { error } = await supabase
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
  const ctx = await getAdminContext();
  if (!ctx) return { ok: false, error: "Solo Owner y Admin pueden cambiar la configuracion" };

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

  const { error } = await supabase.from("workspaces").update(patch).eq("id", workspace.id);

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
  const ctx = await getAdminContext();
  if (!ctx) return { ok: false, error: "Solo Owner y Admin pueden cambiar las tareas en segundo plano" };
  const { workspace, supabase, user } = ctx;

  const { validateBackgroundSettings, mergeBackgroundSettings } = await import("@/lib/background/settings");
  const validated = validateBackgroundSettings(raw);
  if (!validated.ok) return { ok: false, error: validated.error ?? "Configuración inválida" };

  const { data: prev } = await supabase.from("workspaces").select("ai_background_settings").eq("id", workspace.id).single();
  // Se conserva lo demas que hay en la columna (las tareas de Llamadas viven ahi).
  const merged = mergeBackgroundSettings((prev as { ai_background_settings?: unknown } | null)?.ai_background_settings, validated.settings!);
  const { error } = await supabase.from("workspaces").update({ ai_background_settings: merged as unknown as Json }).eq("id", workspace.id);
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
