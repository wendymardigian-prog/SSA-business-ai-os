/**
 * El núcleo del alta rápida de un contacto (asistente de venta y «Nuevo servicio»). Quien llama
 * ya chequeó SU permiso (`sales.manage`, `services.create`) y pasa su contexto: el workspace sale
 * siempre de la sesión. Escribe con el cliente de servicio por la regla única
 * (`find_or_create_contact`): teléfono primero, después email; con un contacto existente se usa
 * ese. Nunca `find_or_link_contact` ni deduplicar por nombre.
 *
 * Quien solo ve lo suyo queda como setter del contacto nuevo: si no, no podría verlo después de
 * crearlo (la RLS de contactos lo esconde).
 */
import type { PermissionContext } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { findOrCreateContact } from "@/lib/contacts/find-or-create";
import { logAudit } from "@/lib/audit";
import { manualContactSchema, resolveFoundContact, type ManualContactInput, type QuickContactResult } from "@/lib/contacts/manual-contact";

export async function quickCreateContact(ctx: PermissionContext, input: ManualContactInput, source: string): Promise<QuickContactResult> {
  const { workspace, user } = ctx;

  const parsed = manualContactSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Los datos del contacto no son válidos" };
  const { name } = parsed.data;
  const email = parsed.data.email?.trim() || null;
  const phone = parsed.data.phone?.trim() || null;

  const service = await createServiceClient();
  const ownsOnly = !(ctx.role === "owner" || ctx.role === "admin" || ctx.scope("leads") === "all");

  // La regla unica (00200): teléfono primero, después email, con el teléfono normalizado; busca y, si no
  // está, crea el contacto (con bloqueo por dato). Un error de la base ya NO se toma como "no está".
  let result;
  try {
    result = await findOrCreateContact(service, {
      workspaceId: workspace.id,
      identity: { phone, email },
      defaults: { display_name: name, ...(ownsOnly ? { setter_id: user.id } : {}) },
      mode: "create",
    });
  } catch (err) {
    console.error(`[contactos] no pude buscar o crear el contacto (${source}):`, err instanceof Error ? err.message : "error desconocido");
    return { ok: false, error: "No pude crear el contacto" };
  }
  if (result.status === "no_identity" || !result.contactId) {
    return { ok: false, error: "Poné un email o un teléfono válido (con código de país)" };
  }
  if (!result.created) {
    const resolution = resolveFoundContact({ contact_id: result.contactId, matched_by: result.matchedBy, conflict_contact_id: result.conflictContactId });
    if (resolution.kind === "existing") {
      return { ok: true, contactId: resolution.contactId, created: false, notice: resolution.notice };
    }
  }

  await logAudit({
    supabase: ctx.supabase,
    workspaceId: workspace.id,
    entityType: "contact",
    entityId: result.contactId,
    action: "create",
    metadata: { source },
    performedBy: user.id,
  });
  return { ok: true, contactId: result.contactId, created: true, notice: null };
}
