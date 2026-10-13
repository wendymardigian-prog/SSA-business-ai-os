"use server";

import { revalidatePath } from "next/cache";
import { getPermissionAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { sanitizeSearch } from "@/lib/url-params";
import { getWorkspaceMembers } from "@/lib/workspace-members";
import { validateContactConfig, type ContactConfig, type CustomFieldDef } from "@/lib/forms/contact-config";
import { TRIGGER_FOR_FORM_TYPE } from "@/lib/forms/automation/triggers";
import { isPublicFormType, type FormDefinition, type FormField, type FormType } from "@/lib/forms/fields";
import type { Json } from "@/lib/types/database";

/**
 * La pestaña Contacto de un formulario (F15, F18) y vincular una respuesta a mano
 * (F16). Con `forms.manage`; se escribe con el cliente de servicio acotado al
 * workspace de la sesión.
 *
 * El mapeo, las etiquetas y los avisos NO se versionan: valen para el formulario
 * entero desde que se guardan (a diferencia de los campos, que se publican).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_PERMISSION = "No tenés permiso para administrar formularios";

export type ContactActionResult<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };

export interface SaveContactSettingsInput {
  formId: string;
  contactConfig: ContactConfig;
  tagIds: string[];
  notifyEnabled: boolean;
  notifyUserIds: string[];
}

/** Guarda el mapeo (validado contra los campos del borrador), las etiquetas y los avisos. */
export async function saveContactSettings(input: SaveContactSettingsInput): Promise<ContactActionResult<{ updatedAt?: string }>> {
  const ctx = await getPermissionAction("forms.manage");
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  if (!UUID.test(input.formId)) return { ok: false, error: "Los datos no son válidos" };

  const service = await createServiceClient();
  const { data: form } = await service
    .from("forms")
    .select("id, status, draft_definition, contact_config, tags_on_submit, notify_enabled, notify_user_ids")
    .eq("id", input.formId)
    .eq("workspace_id", ctx.workspace.id)
    .maybeSingle();
  if (!form) return { ok: false, error: "No encontré ese formulario" };
  if (form.status === "archived") return { ok: false, error: "El formulario está archivado: restauralo para editarlo." };

  const fields = ((form.draft_definition as unknown as FormDefinition | null)?.fields ?? []) as FormField[];
  const { data: defs } = await service.from("custom_field_definitions").select("id, slug, name, type").eq("workspace_id", ctx.workspace.id);
  const customFields = (defs ?? []) as CustomFieldDef[];

  const checked = validateContactConfig(input.contactConfig, fields, customFields);
  if (!checked.ok) return { ok: false, error: checked.errors[0] ?? "El mapeo no es válido" };

  // Las etiquetas tienen que ser de ESTE workspace.
  const tagIds = [...new Set((input.tagIds ?? []).filter((id) => UUID.test(id)))].slice(0, 30);
  if (tagIds.length > 0) {
    const { data: tags } = await service.from("tags").select("id").eq("workspace_id", ctx.workspace.id).in("id", tagIds);
    if ((tags ?? []).length !== tagIds.length) return { ok: false, error: "Alguna de las etiquetas ya no existe" };
  }

  // Los avisos solo van a quienes siguen en el workspace.
  const members = await getWorkspaceMembers(ctx.workspace.id);
  const memberIds = new Set(members.map((m) => m.userId));
  const notifyUserIds = [...new Set((input.notifyUserIds ?? []).filter((id) => UUID.test(id)))].filter((id) => memberIds.has(id));

  const { data: updated, error } = await service
    .from("forms")
    .update({
      contact_config: checked.config as unknown as Json,
      tags_on_submit: tagIds,
      notify_enabled: input.notifyEnabled === true,
      notify_user_ids: notifyUserIds,
      updated_by: ctx.user.id,
    })
    .eq("id", input.formId)
    .eq("workspace_id", ctx.workspace.id)
    .select("updated_at")
    .maybeSingle();
  if (error) {
    console.error("[forms] saveContactSettings fallo, code=", error.code);
    return { ok: false, error: "No pudimos guardar. Probá de nuevo." };
  }

  await logAudit({
    supabase: service,
    workspaceId: ctx.workspace.id,
    entityType: "form",
    entityId: input.formId,
    action: "form.updated",
    changes: {
      contact_config: { old: form.contact_config as Json, new: checked.config as unknown as Json },
      tags_on_submit: { old: form.tags_on_submit as Json, new: tagIds as Json },
      notify_enabled: { old: form.notify_enabled, new: input.notifyEnabled === true },
    },
    performedBy: ctx.user.id,
  });
  revalidatePath(`/dashboard/formularios/${input.formId}`);
  // El editor necesita el `updated_at` nuevo: si no, el próximo guardado automático chocaría con este.
  return { ok: true, updatedAt: updated?.updated_at };
}

export interface ContactOption {
  id: string;
  name: string;
  email: string | null;
}

/** El buscador de contactos del vínculo manual. Con el cliente de la persona: la RLS acota lo que ve. */
export async function searchContactsForForm(query: string): Promise<ContactOption[]> {
  const ctx = await getPermissionAction("forms.manage");
  if (!ctx) return [];
  const q = sanitizeSearch(query, 60);
  if (q.length < 2) return [];
  const { data } = await ctx.supabase
    .from("contacts")
    .select("id, display_name, email")
    .eq("workspace_id", ctx.workspace.id)
    .is("deleted_at", null)
    .or(`display_name.ilike.%${q}%,email.ilike.%${q}%`)
    .order("display_name", { ascending: true })
    .limit(8);
  return (data ?? []).map((c) => ({ id: c.id, name: c.display_name || c.email || "Sin nombre", email: c.email ?? null }));
}

/**
 * Vincular a mano una respuesta `no_contact` a un contacto existente (F16).
 *
 * Con "Disparar ahora las automatizaciones" se emite el MISMO evento que habría
 * emitido el envío; su clave de idempotencia es `form:<tipo>:<respuesta>`, así que
 * tildarla dos veces dispara una sola vez.
 */
export async function linkSubmissionToContact(input: { submissionId: string; contactId: string; fireAutomations?: boolean }): Promise<ContactActionResult> {
  const ctx = await getPermissionAction("forms.manage");
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  if (!UUID.test(input.submissionId) || !UUID.test(input.contactId)) return { ok: false, error: "Los datos no son válidos" };

  // Con el cliente de la persona: si no ve la respuesta o el contacto, es como si no existieran.
  const { data: seen } = await ctx.supabase
    .from("form_submissions")
    .select("id, form_id, status, contact_id, score, nps_category")
    .eq("id", input.submissionId)
    .eq("workspace_id", ctx.workspace.id)
    .maybeSingle();
  if (!seen) return { ok: false, error: "No encontré esa respuesta" };
  if (seen.contact_id) return { ok: false, error: "Esa respuesta ya tiene un contacto" };
  if (seen.status === "spam") return { ok: false, error: "Es una respuesta marcada como spam: sacala de spam primero." };

  const { data: contact } = await ctx.supabase
    .from("contacts")
    .select("id")
    .eq("id", input.contactId)
    .eq("workspace_id", ctx.workspace.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!contact) return { ok: false, error: "No encontré ese contacto" };

  const service = await createServiceClient();
  const { data: form } = await service.from("forms").select("id, name, type").eq("id", seen.form_id).eq("workspace_id", ctx.workspace.id).maybeSingle();
  if (!form) return { ok: false, error: "No encontré el formulario de esa respuesta" };

  const { error } = await service
    .from("form_submissions")
    .update({ contact_id: input.contactId, contact_created: false, status: "received" })
    .eq("id", input.submissionId)
    .eq("workspace_id", ctx.workspace.id)
    .is("contact_id", null);
  if (error) {
    console.error("[forms] linkSubmissionToContact fallo, code=", error.code);
    return { ok: false, error: "No pudimos vincular la respuesta. Probá de nuevo." };
  }

  await logAudit({
    supabase: service,
    workspaceId: ctx.workspace.id,
    entityType: "contact",
    entityId: input.contactId,
    action: "contact.linked",
    metadata: { source: "form", form_id: form.id, submission_id: input.submissionId, matched_by: "manual" },
    performedBy: ctx.user.id,
  });

  if (input.fireAutomations === true && isPublicFormType(form.type)) {
    const { error: eventError } = await service.from("automation_events").insert({
      workspace_id: ctx.workspace.id,
      event_type: TRIGGER_FOR_FORM_TYPE[form.type],
      contact_id: input.contactId,
      // Solo escalares y sin booking_id: el cron trata como "reserva" cualquier payload con booking_id.
      payload: {
        submission_id: input.submissionId,
        form_id: form.id,
        form_type: form.type,
        ...(seen.score !== null ? { score: seen.score } : {}),
        ...(seen.nps_category ? { nps_category: seen.nps_category } : {}),
      } as unknown as Json,
    });
    if (eventError) console.error("[forms] no pude emitir el evento del vínculo manual, code=", eventError.code);
  }

  revalidatePath(`/dashboard/formularios/${form.id}/respuestas`);
  revalidatePath(`/dashboard/formularios/${form.id}/respuestas/${input.submissionId}`);
  return { ok: true };
}
