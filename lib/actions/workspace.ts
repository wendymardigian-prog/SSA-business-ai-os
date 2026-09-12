"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAdminContext } from "@/lib/auth/guards";
import { logAudit, diffFields } from "@/lib/audit";
import { WORKSPACE_COOKIE } from "@/lib/workspace";
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

export async function createWorkspace(name: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  const trimmed = name.trim();
  if (!trimmed) return { error: "Name is required" };

  const slug = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  const { data: workspace, error } = await supabase
    .from("workspaces")
    .insert({ name: trimmed, slug })
    .select("id")
    .single();

  if (error || !workspace) {
    return { error: error?.message || "Failed to create workspace" };
  }

  // Add user as owner
  await supabase.from("workspace_members").insert({
    workspace_id: workspace.id,
    user_id: user.id,
    role: "owner",
  });

  // Switch to new workspace
  const cookieStore = await cookies();
  cookieStore.set(WORKSPACE_COOKIE, workspace.id, {
    path: "/",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });

  return { ok: true, workspaceId: workspace.id };
}

/**
 * Prende y apaga el scope de leads (F3 / seccion 3 del requerimiento).
 *
 * Con el scope prendido, un Member solo ve los contactos y las conversaciones
 * donde es setter, vendedor o agente asignado. Lo aplica la RLS
 * (can_see_contact, migracion 00024), no la UI: apagarlo desde aca cambia lo
 * que devuelve la base, no lo que dibuja la pantalla.
 *
 * Es de Owner/Admin. La policy workspaces_update ya lo exige — sin eso un
 * Member podria apagarse el scope a si mismo y ver todo.
 */
export async function updateLeadScope(settings: {
  leadScopeEnabled?: boolean;
  unassignedVisibleToMembers?: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await getAdminContext();
  if (!ctx) return { ok: false, error: "Solo Owner y Admin pueden cambiar el scope de leads" };

  const { workspace, supabase, user } = ctx;

  const patch: Record<string, boolean> = {};
  if (settings.leadScopeEnabled !== undefined) {
    patch.lead_scope_enabled = settings.leadScopeEnabled;
  }
  if (settings.unassignedVisibleToMembers !== undefined) {
    patch.unassigned_leads_visible_to_members = settings.unassignedVisibleToMembers;
  }
  if (Object.keys(patch).length === 0) return { ok: true };

  const { error } = await supabase.from("workspaces").update(patch).eq("id", workspace.id);

  if (error) {
    console.error("[workspace] no pude cambiar el scope de leads:", error.message);
    return { ok: false, error: `No pude guardar el cambio: ${error.message}` };
  }

  await logAudit({
    supabase,
    workspaceId: workspace.id,
    entityType: "workspace",
    entityId: workspace.id,
    action: "update",
    changes: Object.fromEntries(
      Object.entries(patch).map(([key, value]) => [key, { old: !value, new: value }]),
    ),
    performedBy: user.id,
  });

  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard/contacts");
  return { ok: true };
}

/**
 * Prende y apaga el guardado local de los mensajes entrantes de Instagram (F19).
 *
 * Por que existe este interruptor: persistir el contenido de los DMs es lo que
 * necesitan el agente de IA (lee el historial de la base) y los dashboards
 * (los arma con un GROUP BY sobre la tabla local), pero queda por confirmar si
 * entra dentro de los terminos de Zernio y de Meta para este tipo de cuenta.
 * Hasta tener esa respuesta, tiene que poder apagarse en el momento, sin un
 * deploy: por eso es una fila en la base y no una variable de entorno.
 *
 * Apagarlo frena el guardado hacia adelante y nada mas. Lo ya guardado se borra
 * con scripts/purge-zernio-inbound.mjs, que es la otra mitad del interruptor.
 *
 * Solo afecta a los canales de Zernio. WhatsApp sigue guardando siempre: ahi la
 * tabla es la unica fuente del hilo y apagarla vaciaria la bandeja.
 *
 * Es de Owner/Admin, como todo lo que toca la configuracion del workspace.
 */
export async function updateMessagePersistence(
  enabled: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await getAdminContext();
  if (!ctx) {
    return { ok: false, error: "Solo Owner y Admin pueden cambiar el guardado de mensajes" };
  }

  const { workspace, supabase, user } = ctx;

  const { error } = await supabase
    .from("workspaces")
    .update({ persist_zernio_inbound: enabled })
    .eq("id", workspace.id);

  if (error) {
    console.error("[workspace] no pude cambiar el guardado de mensajes:", error.message);
    return { ok: false, error: `No pude guardar el cambio: ${error.message}` };
  }

  await logAudit({
    supabase,
    workspaceId: workspace.id,
    entityType: "workspace",
    entityId: workspace.id,
    action: "update",
    changes: { persist_zernio_inbound: { old: !enabled, new: enabled } },
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
