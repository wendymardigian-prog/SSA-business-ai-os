"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getPermissionAction } from "@/lib/auth/guards";
import { logAudit } from "@/lib/audit";
import { createServiceClient } from "@/lib/supabase/server";
import { applyContactStatus } from "@/lib/contacts/status-core";
import {
  STATUS_COLORS,
  STATUS_NAME_MAX,
  isStatusRole,
  newStatusKey,
  parseStatusSettings,
  validateStatusesUpdate,
  type ContactStatus,
  type ContactStatusSettings,
  type StatusRole,
} from "@/lib/contacts/statuses";
import type { Json } from "@/lib/types/database";

/**
 * Pipeline de contactos (00245).
 *
 * - `setContactStatus`: cambia el estado de setter o de vendedor de UN contacto.
 *   Pide `contacts.edit` y que la persona VEA el contacto (se lee con su
 *   cliente, la RLS decide). Recién ahí llama a `set_contact_status` con el
 *   cliente de servicio. El historial lo escribe la base.
 * - `saveContactStatusSettings`: guarda una de las dos listas en
 *   `workspaces.contact_status_settings`. Pide `contact_statuses.manage` y
 *   escribe con el cliente de servicio (la RLS de `workspaces` es de Admin),
 *   tocando solo esa clave del jsonb y en el workspace de la sesión.
 */

export type ContactStatusActionResult =
  | { ok: true; changed: boolean; lastStatus: { role: StatusRole; status: string; at: string } | null }
  | { ok: false; error: string };

export async function setContactStatus(contactId: string, role: string, status: string | null): Promise<ContactStatusActionResult> {
  const ctx = await getPermissionAction("contacts.edit");
  if (!ctx) return { ok: false, error: "No tenés permiso para editar contactos" };
  if (!isStatusRole(role)) return { ok: false, error: "Ese tipo de estado no existe" };
  if (typeof contactId !== "string" || !contactId) return { ok: false, error: "Falta el contacto" };

  // Que lo vea: con la sesión, la RLS de contactos decide (un Member ve solo lo suyo).
  const { data: visible } = await ctx.supabase
    .from("contacts")
    .select("id")
    .eq("id", contactId)
    .eq("workspace_id", ctx.workspace.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!visible) return { ok: false, error: "No encontré ese contacto" };

  const result = await applyContactStatus(await createServiceClient(), {
    workspaceId: ctx.workspace.id,
    contactId,
    role,
    status: status && status.trim() ? status.trim() : null,
    actorUserId: ctx.user.id,
  });
  if ("message" in result) return { ok: false, error: result.message };

  revalidatePath("/dashboard/contacts");
  revalidatePath(`/dashboard/contacts/${contactId}`);
  return { ok: true, changed: result.kind === "changed", lastStatus: result.lastStatus };
}

export type StatusSettingsResult = { ok: true; settings: ContactStatusSettings } | { ok: false; error: string };

/** Lo que manda la pantalla: sin `archived_at` (lo decide el servidor) y con `key` solo si ya existe. */
const itemSchema = z.object({
  key: z.string().optional(),
  name: z.string().max(400),
  color: z.enum(STATUS_COLORS),
  archived: z.boolean(),
});

export async function saveContactStatusSettings(role: string, input: unknown): Promise<StatusSettingsResult> {
  const ctx = await getPermissionAction("contact_statuses.manage");
  if (!ctx) return { ok: false, error: "No tenés permiso para cambiar los estados" };
  if (!isStatusRole(role)) return { ok: false, error: "Ese tipo de estado no existe" };
  const parsed = z.array(itemSchema).max(100).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Los estados no son válidos" };

  const service = await createServiceClient();
  const { data: row, error: readError } = await service
    .from("workspaces")
    .select("contact_status_settings")
    .eq("id", ctx.workspace.id)
    .maybeSingle();
  if (readError) {
    console.error("[contact-status] no pude leer los estados:", readError.message);
    return { ok: false, error: "No pude guardar el cambio" };
  }
  const current = (row as { contact_status_settings?: unknown } | null)?.contact_status_settings;
  const settings = parseStatusSettings(current);
  const before = settings[role];
  const byKey = new Map(before.map((s) => [s.key, s]));

  const taken = before.map((s) => s.key);
  const now = new Date().toISOString();
  const after: ContactStatus[] = [];
  for (const item of parsed.data) {
    const existing = item.key ? byKey.get(item.key) : undefined;
    if (item.key && !existing) return { ok: false, error: "Hay un estado que no existe" };
    const name = item.name.trim().replace(/\s+/g, " ");
    if (!name) return { ok: false, error: "Poné un nombre a cada estado" };
    if (name.length > STATUS_NAME_MAX) return { ok: false, error: `El nombre puede tener hasta ${STATUS_NAME_MAX} caracteres` };
    const key = existing?.key ?? newStatusKey(name, taken);
    if (!existing) taken.push(key);
    after.push({
      key,
      name,
      color: item.color,
      // Archivar conserva la fecha original; restaurar la limpia.
      archived_at: item.archived ? (existing?.archived_at ?? now) : null,
    });
  }

  const valid = validateStatusesUpdate(before, after);
  if (!valid.ok) return valid;

  const base = current && typeof current === "object" && !Array.isArray(current) ? (current as Record<string, unknown>) : {};
  // Se guardan las DOS listas: si una no estaba guardada todavía (usaba los
  // estados por defecto), queda escrita tal cual se veía.
  const next = { ...base, setter: settings.setter, closer: settings.closer, [role]: after };
  const { error } = await service
    .from("workspaces")
    .update({ contact_status_settings: next as unknown as Json } as never)
    .eq("id", ctx.workspace.id);
  if (error) {
    console.error("[contact-status] no pude guardar los estados:", error.message);
    return { ok: false, error: "No pude guardar el cambio" };
  }

  await logAudit({
    supabase: ctx.supabase,
    workspaceId: ctx.workspace.id,
    entityType: "workspace",
    entityId: ctx.workspace.id,
    action: "contact_statuses.updated",
    changes: { [`contact_statuses.${role}`]: { old: before as unknown as Json, new: after as unknown as Json } },
    performedBy: ctx.user.id,
  });

  revalidatePath("/dashboard/settings/estados");
  revalidatePath("/dashboard/contacts");
  return { ok: true, settings: parseStatusSettings(next) };
}
