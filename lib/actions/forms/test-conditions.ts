"use server";

import { getPermissionAction, type PermissionContext } from "@/lib/auth/guards";
import { resolveViewerTimezone } from "@/lib/user-timezone";
import { formatInZone } from "@/lib/forms/responses-query";
import { testResponseLabel, testValuesFromSubmission } from "@/lib/automations/test-values";
import type { TestValues } from "@/lib/automations/explain-paths";
import type { FormField } from "@/lib/forms/fields";

/**
 * "Probar condiciones": de DONDE salen los valores de prueba. SOLO LECTURA.
 *
 * Nunca escribe nada: ni sesiones, ni eventos, ni emails, ni mensajes (hay un
 * test con espias que lo comprueba). La cuenta de por donde iria cada camino la
 * hace el navegador con `explainPaths`, sobre el arbol que esta en pantalla (que
 * puede tener cambios sin guardar).
 *
 * Todo con el cliente de QUIEN PIDE: la RLS (`can_see_form_submission`) decide
 * que respuestas ve; un Member solo ve las de sus contactos. El workspace sale
 * de la sesion, nunca del pedido. Con `forms.view`.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_PERMISSION = "No tenés permiso para ver las respuestas de los formularios.";
const NOT_FOUND = "No encontré esa automatización.";
/** Cuantas respuestas se ofrecen para probar. */
const TEST_RESPONSES_LIMIT = 20;

export type TestResponsesResult =
  | { ok: true; formName: string; responses: Array<{ id: string; label: string }> }
  | { ok: false; error: string };

export type TestResponseValuesResult = { ok: true; values: TestValues } | { ok: false; error: string };

async function formOfFlow(flowId: string): Promise<{ error: string } | { error?: undefined; ctx: PermissionContext; form: { id: string; name: string } }> {
  const ctx = await getPermissionAction("forms.view");
  if (!ctx) return { error: NO_PERMISSION };
  if (!UUID.test(flowId)) return { error: NOT_FOUND };

  const { supabase, workspace } = ctx;
  const { data: flow } = await supabase.from("flows").select("form_id").eq("id", flowId).eq("workspace_id", workspace.id).maybeSingle();
  if (!flow?.form_id) return { error: NOT_FOUND };

  const { data: form } = await supabase.from("forms").select("id, name").eq("id", flow.form_id).eq("workspace_id", workspace.id).maybeSingle();
  if (!form) return { error: NOT_FOUND };
  return { ctx, form };
}

/** Las ultimas respuestas del formulario de la automatizacion que esta persona puede ver, con una etiqueta legible. */
export async function listTestResponses(input: { flowId: string }): Promise<TestResponsesResult> {
  const found = await formOfFlow(input.flowId);
  if (!("ctx" in found)) return { ok: false, error: found.error };
  const { ctx, form } = found;
  const { supabase, workspace } = ctx;

  const { data, error } = await supabase
    .from("form_submissions")
    .select("id, created_at, contact_id")
    .eq("form_id", form.id)
    .eq("workspace_id", workspace.id)
    .order("created_at", { ascending: false })
    .limit(TEST_RESPONSES_LIMIT);
  if (error) {
    console.error("[forms] listTestResponses fallo, code=", error.code);
    return { ok: false, error: "No pude cargar las respuestas. Probá de nuevo." };
  }

  const submissions = data ?? [];
  const contactIds = [...new Set(submissions.map((s) => s.contact_id).filter((id): id is string => !!id))];
  const { data: contacts } = contactIds.length
    ? await supabase.from("contacts").select("id, display_name, email").in("id", contactIds)
    : { data: [] as Array<{ id: string; display_name: string | null; email: string | null }> };
  const byId = new Map((contacts ?? []).map((c) => [c.id, c]));

  const timeZone = await resolveViewerTimezone(workspace.timezone);
  return {
    ok: true,
    formName: form.name,
    responses: submissions.map((s) => {
      const contact = s.contact_id ? byId.get(s.contact_id) : undefined;
      return { id: s.id, label: testResponseLabel({ whenText: formatInZone(s.created_at, timeZone), name: contact?.display_name, email: contact?.email }) };
    }),
  };
}

/** Los valores de una respuesta real, leidos con la definicion de LA VERSION con la que se respondio. */
export async function getTestResponseValues(input: { flowId: string; submissionId: string }): Promise<TestResponseValuesResult> {
  if (!UUID.test(input.submissionId)) return { ok: false, error: "No encontré esa respuesta." };
  const found = await formOfFlow(input.flowId);
  if (!("ctx" in found)) return { ok: false, error: found.error };
  const { ctx, form } = found;
  const { supabase, workspace } = ctx;

  const { data: submission } = await supabase
    .from("form_submissions")
    .select("form_version_id, answers, score, nps_category")
    .eq("id", input.submissionId)
    .eq("form_id", form.id)
    .eq("workspace_id", workspace.id)
    .maybeSingle();
  if (!submission) return { ok: false, error: "No encontré esa respuesta." };

  const { data: version } = await supabase.from("form_versions").select("definition").eq("id", submission.form_version_id).maybeSingle();
  if (!version) return { ok: false, error: "No encontré la versión del formulario con la que se respondió." };

  const rawFields = (version.definition as { fields?: unknown } | null)?.fields;
  const fields = (Array.isArray(rawFields) ? rawFields : []) as Array<Pick<FormField, "key">>;
  return {
    ok: true,
    values: testValuesFromSubmission({
      fields,
      answers: (submission.answers ?? {}) as Parameters<typeof testValuesFromSubmission>[0]["answers"],
      formName: form.name,
      score: submission.score,
      npsCategory: submission.nps_category,
    }),
  };
}
