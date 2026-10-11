"use server";

import { revalidatePath } from "next/cache";
import { getPermissionAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { appUrl } from "@/lib/app-url";
import { validateSurveyConfig } from "@/lib/forms/survey";
import { validateContractConfig } from "@/lib/forms/contract/config";
import { signFormLink } from "@/lib/forms/signed-link";
import type { FormDefinition, FormField } from "@/lib/forms/fields";
import type { Json } from "@/lib/types/database";

/**
 * La configuración propia de cada tipo (F22, F24) y el link firmado para un contacto
 * (F20). Con `forms.manage`; se escribe con el cliente de servicio acotado al workspace
 * de la sesión.
 *
 * Como el mapeo de contacto, esta configuración NO se versiona: vale desde que se
 * guarda. Lo que se versiona es la definición (los campos y el texto del contrato).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_PERMISSION = "No tenés permiso para administrar formularios";

export type ConfigActionResult<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };

async function loadForm(formId: string, workspaceId: string) {
  if (!UUID.test(formId)) return null;
  const service = await createServiceClient();
  const { data } = await service
    .from("forms")
    .select("id, name, type, status, slug, draft_definition, survey_config, contract_config")
    .eq("id", formId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  return data ? { service, form: data } : null;
}

export async function saveSurveyConfig(input: { formId: string; config: unknown }): Promise<ConfigActionResult> {
  const ctx = await getPermissionAction("forms.manage");
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  const loaded = await loadForm(input.formId, ctx.workspace.id);
  if (!loaded) return { ok: false, error: "No encontré ese formulario" };
  const { service, form } = loaded;
  if (form.type !== "survey") return { ok: false, error: "Este formulario no es una encuesta" };
  if (form.status === "archived") return { ok: false, error: "El formulario está archivado: restauralo para editarlo." };

  const fields = ((form.draft_definition as unknown as FormDefinition | null)?.fields ?? []) as FormField[];
  const checked = validateSurveyConfig(input.config, fields);
  if (!checked.ok) return { ok: false, error: checked.errors[0] ?? "La configuración no es válida" };

  const { error } = await service
    .from("forms")
    .update({ survey_config: checked.config as unknown as Json, updated_by: ctx.user.id })
    .eq("id", form.id)
    .eq("workspace_id", ctx.workspace.id);
  if (error) {
    console.error("[forms] saveSurveyConfig fallo, code=", error.code);
    return { ok: false, error: "No pudimos guardar. Probá de nuevo." };
  }
  await logAudit({
    supabase: service,
    workspaceId: ctx.workspace.id,
    entityType: "form",
    entityId: form.id,
    action: "form.updated",
    changes: { survey_config: { old: form.survey_config as Json, new: checked.config as unknown as Json } },
    performedBy: ctx.user.id,
  });
  revalidatePath(`/dashboard/formularios/${form.id}`);
  return { ok: true };
}

export async function saveContractConfig(input: { formId: string; config: unknown }): Promise<ConfigActionResult> {
  const ctx = await getPermissionAction("forms.manage");
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  const loaded = await loadForm(input.formId, ctx.workspace.id);
  if (!loaded) return { ok: false, error: "No encontré ese formulario" };
  const { service, form } = loaded;
  if (form.type !== "contract") return { ok: false, error: "Este formulario no es un contrato" };
  if (form.status === "archived") return { ok: false, error: "El formulario está archivado: restauralo para editarlo." };

  const checked = validateContractConfig(input.config);
  if (!checked.ok) return { ok: false, error: checked.errors[0] ?? "La configuración no es válida" };

  const { error } = await service
    .from("forms")
    .update({ contract_config: checked.config as unknown as Json, updated_by: ctx.user.id })
    .eq("id", form.id)
    .eq("workspace_id", ctx.workspace.id);
  if (error) {
    console.error("[forms] saveContractConfig fallo, code=", error.code);
    return { ok: false, error: "No pudimos guardar. Probá de nuevo." };
  }
  await logAudit({
    supabase: service,
    workspaceId: ctx.workspace.id,
    entityType: "form",
    entityId: form.id,
    action: "form.updated",
    changes: { contract_config: { old: form.contract_config as Json, new: checked.config as unknown as Json } },
    performedBy: ctx.user.id,
  });
  revalidatePath(`/dashboard/formularios/${form.id}`);
  return { ok: true };
}

/**
 * Arma el link firmado de un formulario para UN contacto (`/f/<slug>?c=<token>`): el
 * que se manda por mensaje o email para que responda sin que el sistema tenga que
 * adivinar quién es. Solo para formularios PUBLICADOS; vence a los 60 días.
 */
export async function createSignedFormLink(input: { formId: string; contactId: string }): Promise<ConfigActionResult<{ url: string }>> {
  const ctx = await getPermissionAction("forms.manage");
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  if (!UUID.test(input.contactId)) return { ok: false, error: "Los datos no son válidos" };
  const loaded = await loadForm(input.formId, ctx.workspace.id);
  if (!loaded) return { ok: false, error: "No encontré ese formulario" };
  const { service, form } = loaded;
  if (form.status !== "published") return { ok: false, error: "Publicá el formulario antes de armar links para un contacto" };

  // Con el cliente de la persona: si no ve al contacto, no le arma el link.
  const { data: contact } = await ctx.supabase
    .from("contacts")
    .select("id")
    .eq("id", input.contactId)
    .eq("workspace_id", ctx.workspace.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!contact) return { ok: false, error: "No encontré ese contacto" };

  try {
    const url = await signFormLink(service, { workspaceId: ctx.workspace.id, formId: form.id, slug: form.slug, contactId: contact.id, baseUrl: appUrl() });
    return { ok: true, url };
  } catch (error) {
    console.error("[forms] createSignedFormLink fallo:", error instanceof Error ? error.message : "error");
    return { ok: false, error: "No pudimos armar el link. Probá de nuevo." };
  }
}
