"use server";

import { revalidatePath } from "next/cache";
import { getPermissionAction } from "@/lib/auth/guards";
import { logAudit } from "@/lib/audit";
import { createServiceClient } from "@/lib/supabase/server";
import { applyContactQualification } from "@/lib/contacts/qualification-core";
import {
  parseQualificationSettings,
  qualificationSettingsInputSchema,
  validateQualificationSettings,
  type QualificationLevel,
  type QualificationSettings,
} from "@/lib/contacts/qualification";
import type { Json } from "@/lib/types/database";

/**
 * Nivel de calificación del lead (00329).
 *
 * - `setContactQualification`: fija (o quita) el nivel de UN contacto. Pide
 *   `contacts.edit` y que la persona VEA el contacto (se lee con su cliente, la
 *   RLS decide). Recién ahí llama a `set_contact_qualification` con el cliente
 *   de servicio. El historial lo escribe la base.
 * - `saveQualificationSettings`: guarda los nombres y la rúbrica de los 5
 *   niveles en `workspaces.qualification_settings`. Pide
 *   `contact_statuses.manage` (la misma pantalla que los estados) y escribe con
 *   el cliente de servicio en el workspace de la sesión.
 */

export type ContactQualificationActionResult =
  | { ok: true; changed: boolean; level: QualificationLevel | null }
  | { ok: false; error: string };

export async function setContactQualification(contactId: string, level: number | null): Promise<ContactQualificationActionResult> {
  const ctx = await getPermissionAction("contacts.edit");
  if (!ctx) return { ok: false, error: "No tenés permiso para editar contactos" };
  if (typeof contactId !== "string" || !contactId) return { ok: false, error: "Falta el contacto" };
  if (level !== null && !(Number.isInteger(level) && level >= 1 && level <= 5)) {
    return { ok: false, error: "El nivel va de 1 a 5" };
  }

  // Que lo vea: con la sesión, la RLS de contactos decide (un Member ve solo lo suyo).
  const { data: visible } = await ctx.supabase
    .from("contacts")
    .select("id")
    .eq("id", contactId)
    .eq("workspace_id", ctx.workspace.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!visible) return { ok: false, error: "No encontré ese contacto" };

  const result = await applyContactQualification(await createServiceClient(), {
    workspaceId: ctx.workspace.id,
    contactId,
    mode: level === null ? "clear" : "set",
    value: level,
    source: "person",
    actorUserId: ctx.user.id,
  });
  if ("message" in result) return { ok: false, error: result.message };

  revalidatePath("/dashboard/contacts");
  revalidatePath(`/dashboard/contacts/${contactId}`);
  return { ok: true, changed: result.kind === "changed", level: result.newLevel };
}

export type QualificationSettingsResult = { ok: true; settings: QualificationSettings } | { ok: false; error: string };

export async function saveQualificationSettings(input: unknown): Promise<QualificationSettingsResult> {
  const ctx = await getPermissionAction("contact_statuses.manage");
  if (!ctx) return { ok: false, error: "No tenés permiso para cambiar la calificación" };
  const parsed = qualificationSettingsInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Los niveles no son válidos" };
  const valid = validateQualificationSettings(parsed.data);
  if (!valid.ok) return valid;

  const service = await createServiceClient();
  const { data: row, error: readError } = await service
    .from("workspaces")
    .select("qualification_settings")
    .eq("id", ctx.workspace.id)
    .maybeSingle();
  if (readError) {
    console.error("[qualification] no pude leer los niveles:", readError.message);
    return { ok: false, error: "No pude guardar el cambio" };
  }
  const before = parseQualificationSettings((row as { qualification_settings?: unknown } | null)?.qualification_settings);

  const { error } = await service
    .from("workspaces")
    .update({ qualification_settings: valid.settings as unknown as Json } as never)
    .eq("id", ctx.workspace.id);
  if (error) {
    console.error("[qualification] no pude guardar los niveles:", error.message);
    return { ok: false, error: "No pude guardar el cambio" };
  }

  await logAudit({
    supabase: ctx.supabase,
    workspaceId: ctx.workspace.id,
    entityType: "workspace",
    entityId: ctx.workspace.id,
    action: "qualification_settings.updated",
    changes: { qualification_settings: { old: before as unknown as Json, new: valid.settings as unknown as Json } },
    performedBy: ctx.user.id,
  });

  revalidatePath("/dashboard/settings/estados");
  revalidatePath("/dashboard/contacts");
  return { ok: true, settings: valid.settings };
}
