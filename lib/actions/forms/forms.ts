"use server";

import { revalidatePath } from "next/cache";
import { getPermissionAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { newFormParts } from "@/lib/forms/defaults";
import { validateDraftShape } from "@/lib/forms/definition-schema";
import { normalizeContractText } from "@/lib/forms/contract-text";
import { FORM_TYPES, type FormStatus, type FormType } from "@/lib/forms/fields";
import { canTransition, duplicateName, nextSlug, slugFromName, SLUG_PATTERN } from "@/lib/forms/list";
import { checkPublishable } from "@/lib/forms/publish";
import { validateSuccess } from "@/lib/forms/success";
import { isTurnstileConfigured } from "@/lib/forms/server-ports";
import { typeChecks } from "@/lib/forms/type-checks";
import type { Json } from "@/lib/types/database";

/**
 * Crear, editar, publicar y archivar formularios (F3, F4, F8). Con `forms.manage`.
 *
 * Reglas comunes:
 *  - El permiso se verifica ANTES de tocar nada; sin él, "No tenés permiso".
 *  - Se escribe con el cliente de servicio (la tabla no tiene policies de
 *    escritura), siempre acotado al workspace de la sesión.
 *  - Nada se borra: se archiva.
 *  - Todo queda en el historial de la entidad `form`.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_PERMISSION = "No tenés permiso para administrar formularios";

export type FormActionResult<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string; conflict?: boolean };

async function context() {
  return getPermissionAction("forms.manage");
}

function refresh(formId?: string) {
  revalidatePath("/dashboard/formularios");
  if (formId) revalidatePath(`/dashboard/formularios/${formId}`);
}

async function slugsLike(service: Awaited<ReturnType<typeof createServiceClient>>, base: string): Promise<string[]> {
  const { data } = await service.from("forms").select("slug").ilike("slug", `${base}%`).limit(200);
  return (data ?? []).map((r) => r.slug);
}

export async function createForm(input: { name: string; type: FormType }): Promise<FormActionResult<{ id: string }>> {
  const ctx = await context();
  if (!ctx) return { ok: false, error: NO_PERMISSION };

  const name = (input.name ?? "").trim();
  if (name.length < 1 || name.length > 120) return { ok: false, error: "Poné un nombre de hasta 120 caracteres" };
  if (!FORM_TYPES.includes(input.type)) return { ok: false, error: "Elegí el tipo de formulario" };

  const service = await createServiceClient();
  const parts = newFormParts(input.type, name);
  const base = slugFromName(name);

  // Dos personas pueden crear el mismo nombre a la vez: si el único salta, se prueba el siguiente.
  for (let attempt = 0; attempt < 4; attempt++) {
    const slug = nextSlug(base, await slugsLike(service, base));
    const { data, error } = await service
      .from("forms")
      .insert({
        workspace_id: ctx.workspace.id,
        name,
        type: input.type,
        slug,
        draft_definition: parts.definition as unknown as Json,
        design: parts.design as unknown as Json,
        survey_config: parts.surveyConfig as unknown as Json,
        contract_config: parts.contractConfig as unknown as Json,
        notify_user_ids: [ctx.user.id],
        created_by: ctx.user.id,
        updated_by: ctx.user.id,
      })
      .select("id")
      .single();

    if (!error && data) {
      await logAudit({
        supabase: service,
        workspaceId: ctx.workspace.id,
        entityType: "form",
        entityId: data.id,
        action: "form.created",
        metadata: { type: input.type, slug },
        performedBy: ctx.user.id,
      });
      refresh();
      return { ok: true, id: data.id };
    }
    if (error?.code !== "23505") {
      console.error("[forms] createForm fallo, code=", error?.code);
      return { ok: false, error: "No pudimos crear el formulario. Probá de nuevo." };
    }
  }
  return { ok: false, error: "No pudimos elegir un link libre para el formulario. Probá con otro nombre." };
}

async function loadOwned(service: Awaited<ReturnType<typeof createServiceClient>>, workspaceId: string, formId: string) {
  if (!UUID.test(formId)) return null;
  const { data } = await service.from("forms").select("*").eq("id", formId).eq("workspace_id", workspaceId).maybeSingle();
  return data;
}

export async function duplicateForm(formId: string): Promise<FormActionResult<{ id: string }>> {
  const ctx = await context();
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  const service = await createServiceClient();
  const form = await loadOwned(service, ctx.workspace.id, formId);
  if (!form) return { ok: false, error: "No encontré ese formulario" };

  const name = duplicateName(form.name);
  const base = slugFromName(name);

  for (let attempt = 0; attempt < 4; attempt++) {
    const slug = nextSlug(base, await slugsLike(service, base));
    // Copia la definición de trabajo y la configuración; NO copia respuestas, versiones ni flujos.
    const { data, error } = await service
      .from("forms")
      .insert({
        workspace_id: ctx.workspace.id,
        name,
        type: form.type,
        status: "draft",
        slug,
        draft_definition: form.draft_definition,
        design: form.design,
        success: form.success,
        contact_config: form.contact_config,
        survey_config: form.survey_config,
        contract_config: form.contract_config,
        tags_on_submit: form.tags_on_submit,
        notify_enabled: form.notify_enabled,
        notify_user_ids: [ctx.user.id],
        created_by: ctx.user.id,
        updated_by: ctx.user.id,
      })
      .select("id")
      .single();
    if (!error && data) {
      await logAudit({
        supabase: service,
        workspaceId: ctx.workspace.id,
        entityType: "form",
        entityId: data.id,
        action: "form.duplicated",
        metadata: { from: formId, slug },
        performedBy: ctx.user.id,
      });
      refresh();
      return { ok: true, id: data.id };
    }
    if (error?.code !== "23505") {
      console.error("[forms] duplicateForm fallo, code=", error?.code);
      return { ok: false, error: "No pudimos duplicar el formulario. Probá de nuevo." };
    }
  }
  return { ok: false, error: "No pudimos elegir un link libre para la copia." };
}

const ACTION_BY_TRANSITION: Record<string, "form.paused" | "form.resumed" | "form.archived" | "form.restored"> = {
  "published>paused": "form.paused",
  "paused>published": "form.resumed",
  "draft>archived": "form.archived",
  "published>archived": "form.archived",
  "paused>archived": "form.archived",
  "archived>draft": "form.restored",
};

/** Pausar, reanudar, archivar y restaurar. Publicar es otra acción (`publishForm`). */
export async function setFormStatus(formId: string, to: FormStatus): Promise<FormActionResult> {
  const ctx = await context();
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  const service = await createServiceClient();
  const form = await loadOwned(service, ctx.workspace.id, formId);
  if (!form) return { ok: false, error: "No encontré ese formulario" };

  const from = form.status as FormStatus;
  if (!canTransition(from, to)) return { ok: false, error: "Ese cambio de estado no está permitido" };
  // Publicar desde un borrador es del botón Publicar (crea la versión). Reanudar sí vale, si ya hubo una.
  if (to === "published" && !form.current_version_id) return { ok: false, error: "Publicalo primero para crear la versión" };

  const patch: { status: FormStatus; archived_at: string | null; updated_by: string } = {
    status: to,
    archived_at: to === "archived" ? new Date().toISOString() : null,
    updated_by: ctx.user.id,
  };
  const { error } = await service.from("forms").update(patch).eq("id", formId).eq("workspace_id", ctx.workspace.id);
  if (error) {
    console.error("[forms] setFormStatus fallo, code=", error.code);
    return { ok: false, error: "No pudimos cambiar el estado. Probá de nuevo." };
  }

  await logAudit({
    supabase: service,
    workspaceId: ctx.workspace.id,
    entityType: "form",
    entityId: formId,
    action: ACTION_BY_TRANSITION[`${from}>${to}`] ?? "form.updated",
    changes: { status: { old: from, new: to } },
    performedBy: ctx.user.id,
  });
  refresh(formId);
  return { ok: true };
}

export interface SaveDraftInput {
  formId: string;
  name?: string;
  definition: unknown;
  design?: unknown;
  success?: unknown;
  /** El `updated_at` que tenía el editor al abrir/guardar: si cambió, alguien más editó. */
  expectedUpdatedAt?: string;
}

/**
 * Guarda la copia de trabajo (la usa el guardado automático). Se puede guardar
 * incompleto: las reglas completas se exigen al publicar.
 */
export async function saveFormDraft(input: SaveDraftInput): Promise<FormActionResult<{ updatedAt: string }>> {
  const ctx = await context();
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  const service = await createServiceClient();
  const form = await loadOwned(service, ctx.workspace.id, input.formId);
  if (!form) return { ok: false, error: "No encontré ese formulario" };
  if (form.status === "archived") return { ok: false, error: "Restauralo para poder editarlo" };

  if (input.expectedUpdatedAt && new Date(input.expectedUpdatedAt).getTime() !== new Date(form.updated_at).getTime()) {
    return { ok: false, conflict: true, error: "Alguien más cambió este formulario: recargá la página para ver sus cambios." };
  }

  const shape = validateDraftShape(input.definition);
  if (!shape.ok) return { ok: false, error: "El formulario no tiene una forma válida" };
  const definition = { ...shape.definition } as Record<string, unknown>;
  if (form.type === "contract" && typeof definition.contractText === "string") {
    // Lo que se guarda es exactamente lo que se hashea al publicar.
    definition.contractText = normalizeContractText(definition.contractText);
  } else if (form.type !== "contract") {
    delete definition.contractText;
  }

  const patch: Record<string, unknown> = { draft_definition: definition, updated_by: ctx.user.id };

  if (input.name !== undefined) {
    const name = input.name.trim();
    if (name.length < 1 || name.length > 120) return { ok: false, error: "Poné un nombre de hasta 120 caracteres" };
    patch.name = name;
  }
  if (input.design !== undefined) {
    const d = (input.design ?? {}) as Record<string, unknown>;
    patch.design = {
      title: String(d.title ?? "").slice(0, 200),
      intro: String(d.intro ?? "").slice(0, 2000),
      submitLabel: String(d.submitLabel ?? "").slice(0, 60),
      showLogo: d.showLogo !== false,
    };
  }
  if (input.success !== undefined) {
    const success = validateSuccess(input.success);
    if (!success.ok) return { ok: false, error: success.error };
    patch.success = success.success;
  }

  const { data, error } = await service
    .from("forms")
    .update(patch as never)
    .eq("id", input.formId)
    .eq("workspace_id", ctx.workspace.id)
    .select("updated_at")
    .single();
  if (error || !data) {
    console.error("[forms] saveFormDraft fallo, code=", error?.code);
    return { ok: false, error: "No se pudo guardar. Reintentá." };
  }
  // Sin entrada en el historial por cada guardado automático: se audita al publicar y en lo estructural.
  revalidatePath(`/dashboard/formularios/${input.formId}`);
  return { ok: true, updatedAt: data.updated_at };
}

/** Cambiar el link de un formulario. Si está publicado, los links viejos dejan de andar: hay que confirmar. */
export async function changeFormSlug(input: { formId: string; slug: string; confirm?: boolean }): Promise<FormActionResult<{ slug: string }>> {
  const ctx = await context();
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  const service = await createServiceClient();
  const form = await loadOwned(service, ctx.workspace.id, input.formId);
  if (!form) return { ok: false, error: "No encontré ese formulario" };

  const slug = (input.slug ?? "").trim().toLowerCase();
  if (!SLUG_PATTERN.test(slug)) return { ok: false, error: "El link tiene que tener de 3 a 60 caracteres: minúsculas, números y guiones" };
  if (slug === form.slug) return { ok: true, slug };
  if (form.status === "published" && !input.confirm) {
    return { ok: false, error: "Este formulario está publicado: los links que ya compartiste dejan de funcionar. Confirmá el cambio." };
  }

  const { error } = await service.from("forms").update({ slug, updated_by: ctx.user.id }).eq("id", input.formId).eq("workspace_id", ctx.workspace.id);
  if (error) {
    if (error.code === "23505") return { ok: false, error: "Ese link ya lo usa otro formulario. Elegí otro." };
    console.error("[forms] changeFormSlug fallo, code=", error.code);
    return { ok: false, error: "No pudimos cambiar el link. Probá de nuevo." };
  }

  await logAudit({
    supabase: service,
    workspaceId: ctx.workspace.id,
    entityType: "form",
    entityId: input.formId,
    action: "form.slug_changed",
    changes: { slug: { old: form.slug, new: slug } },
    performedBy: ctx.user.id,
  });
  refresh(input.formId);
  return { ok: true, slug };
}

/**
 * Publicar. Antes de llamar a la función SQL (que arma la versión en una
 * transacción) se chequea todo lo que se pueda: el link, Turnstile y la
 * definición. Si falta algo, vuelve el motivo.
 */
export async function publishForm(formId: string): Promise<FormActionResult<{ versionNumber: number; changed: boolean }> & { reasons?: string[] }> {
  const ctx = await context();
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  const service = await createServiceClient();
  const form = await loadOwned(service, ctx.workspace.id, formId);
  if (!form) return { ok: false, error: "No encontré ese formulario" };
  if (form.status === "archived") return { ok: false, error: "Restauralo para poder publicarlo" };

  const turnstileConfigured = await isTurnstileConfigured(service, ctx.workspace.id);
  const check = checkPublishable({
    type: form.type as FormType,
    slug: form.slug,
    definition: form.draft_definition,
    turnstileConfigured,
    extraChecks: typeChecks(form.type as FormType, { surveyConfig: form.survey_config, contractConfig: form.contract_config }),
  });
  if (!check.ok) return { ok: false, error: check.reasons[0], reasons: check.reasons };

  const { data, error } = await service.rpc("publish_form_version", { p_form_id: formId, p_actor: ctx.user.id });
  if (error || !data) {
    console.error("[forms] publishForm fallo, code=", error?.code);
    return { ok: false, error: "No pudimos publicar el formulario. Probá de nuevo." };
  }

  refresh(formId);
  return { ok: true, versionNumber: data.version_number, changed: data.changed };
}

/** Marcar una respuesta como spam (sale de las métricas) o sacarla de spam. Reversible. */
export async function setSubmissionSpam(input: { submissionId: string; spam: boolean }): Promise<FormActionResult> {
  const ctx = await context();
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  if (!UUID.test(input.submissionId)) return { ok: false, error: "Los datos no son válidos" };

  // Con el cliente de la persona: si no ve la respuesta, es como si no existiera.
  const { data: seen } = await ctx.supabase
    .from("form_submissions")
    .select("id, form_id, status, contact_id")
    .eq("id", input.submissionId)
    .eq("workspace_id", ctx.workspace.id)
    .maybeSingle();
  if (!seen) return { ok: false, error: "No encontré esa respuesta" };

  const next = input.spam ? "spam" : seen.contact_id ? "received" : "no_contact";
  if (seen.status === next) return { ok: true };

  const service = await createServiceClient();
  const { error } = await service
    .from("form_submissions")
    .update(
      input.spam
        ? { status: "spam", marked_spam_by: ctx.user.id, marked_spam_at: new Date().toISOString() }
        : { status: next, marked_spam_by: null, marked_spam_at: null },
    )
    .eq("id", input.submissionId)
    .eq("workspace_id", ctx.workspace.id);
  if (error) {
    if (error.code === "23505") return { ok: false, error: "Esa persona ya respondió de nuevo: no se puede sacar de spam." };
    console.error("[forms] setSubmissionSpam fallo, code=", error.code);
    return { ok: false, error: "No pudimos cambiar la respuesta. Probá de nuevo." };
  }

  await logAudit({
    supabase: service,
    workspaceId: ctx.workspace.id,
    entityType: "form_submission",
    entityId: input.submissionId,
    action: input.spam ? "submission.spam" : "submission.unspam",
    changes: { status: { old: seen.status, new: next } },
    performedBy: ctx.user.id,
  });
  revalidatePath(`/dashboard/formularios/${seen.form_id}/respuestas`);
  return { ok: true };
}
