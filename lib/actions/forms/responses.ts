"use server";

import { canExport, NO_EXPORT_MESSAGE } from "@/lib/auth/export";
import { getPermissionAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { resolveViewerTimezone } from "@/lib/user-timezone";
import { fieldsOf } from "@/lib/forms/server-ports";
import { buildExportFilename, buildResponsesCsv } from "@/lib/forms/export";
import { isFileOfSubmission, SIGNED_URL_SECONDS } from "@/lib/forms/files";
import { metaLinkFromAttribution, metaLinkFromTouch, touchMetaIds } from "@/lib/attribution/meta-link";
import { EMPTY_META_NAMES, loadMetaNamesByIds, metaIdsFrom } from "@/lib/attribution/meta-names";
import { formTouchKey, loadTouchesByKey } from "@/lib/attribution/source-touches";
import { phoneFieldKey } from "@/lib/forms/response-index";
import { parseResponseFilters, responseColumns, type ResponseRow } from "@/lib/forms/responses";
import { loadFormResponses } from "@/lib/forms/responses-load";
import { formatInZone } from "@/lib/forms/responses-query";
import { UPLOADS_BUCKET } from "@/lib/forms/server-ports";

/**
 * Exportar respuestas y pedir un archivo (F13). Con `forms.view`.
 *
 * Las dos leen con el cliente de QUIEN PIDE: la RLS (`can_see_form_submission`)
 * decide qué ve. Un Member exporta solo las respuestas de sus contactos, y nunca
 * obtiene el link de un archivo de una respuesta que no ve.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ExportResult =
  | { ok: true; filename: string; csv: string; rows: number; truncated: boolean }
  | { ok: false; error: string };

export async function exportResponsesCsv(input: { formId: string; params: Record<string, string> }): Promise<ExportResult> {
  const ctx = await getPermissionAction("forms.view");
  if (!ctx) return { ok: false, error: "No tenés permiso para ver formularios" };
  // Exportar pide `data.export` ademas de ver las respuestas (Equipo y roles, F24).
  if (!canExport(ctx.can)) return { ok: false, error: NO_EXPORT_MESSAGE };
  if (!UUID.test(input.formId)) return { ok: false, error: "Los datos no son válidos" };

  const { supabase, workspace } = ctx;
  const timeZone = await resolveViewerTimezone(workspace.timezone);

  const { data: form } = await supabase
    .from("forms")
    .select("id, name, type, current_version_id, draft_definition")
    .eq("id", input.formId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();
  if (!form) return { ok: false, error: "No encontré ese formulario" };

  let definition = form.draft_definition;
  if (form.current_version_id) {
    const { data: version } = await supabase.from("form_versions").select("definition").eq("id", form.current_version_id).maybeSingle();
    if (version) definition = version.definition;
  }

  // El mismo camino que la tabla: el CSV respeta el período, la búsqueda, el país y las UTM que se ven.
  const filters = parseResponseFilters(input.params);
  const fields = fieldsOf(definition);
  const loaded = await loadFormResponses(supabase, {
    workspaceId: workspace.id,
    formId: input.formId,
    filters,
    timeZone,
    phoneKey: phoneFieldKey(fields),
  });
  if (loaded.error) return { ok: false, error: "No pudimos armar el archivo. Probá de nuevo." };

  const submissions = loaded.matching;
  const contactIds = [...new Set(submissions.map((s) => s.contact_id).filter((id): id is string => !!id))];
  const { data: contacts } = contactIds.length
    ? await supabase.from("contacts").select("id, display_name, email").in("id", contactIds)
    : { data: [] as Array<{ id: string; display_name: string | null; email: string | null }> };
  const byId = new Map((contacts ?? []).map((c) => [c.id, c]));

  // El vinculo con Meta es el del toque de cada respuesta; sin toque (sin contacto), los ids que trajo su URL.
  const attributionOf = (s: { rawAttribution: Record<string, unknown> }) => s.rawAttribution;
  const touches = await loadTouchesByKey(await createServiceClient(), workspace.id, submissions.map((s) => formTouchKey(s.id)));
  const metaIds = submissions.map((s) => {
    const touch = touches.get(formTouchKey(s.id));
    return touch ? touchMetaIds(touch) : metaIdsFrom(attributionOf(s));
  });
  const metaNames = ctx.can("dashboards.ads.view") ? await loadMetaNamesByIds(supabase, workspace.id, metaIds) : EMPTY_META_NAMES;

  const rows: ResponseRow[] = submissions.map((s) => ({
    id: s.id,
    created_at: s.created_at,
    status: s.status,
    contact_id: s.contact_id,
    contact_name: s.contact_id ? byId.get(s.contact_id)?.display_name ?? null : null,
    contact_email: s.contact_id ? byId.get(s.contact_id)?.email ?? null : null,
    answers: (s.answers ?? {}) as unknown as ResponseRow["answers"],
    score: s.score,
    nps_category: s.nps_category,
    attribution: s.rawAttribution,
    meta_names: (() => {
      const touch = touches.get(formTouchKey(s.id));
      return (touch ? metaLinkFromTouch(touch, metaNames) : metaLinkFromAttribution(attributionOf(s), metaNames)).names;
    })(),
  }));

  const columns = responseColumns(fields, rows);
  const result = buildResponsesCsv(rows, columns, {
    formatDate: (iso) => formatInZone(iso, timeZone),
    includeScore: form.type === "survey",
  });
  const today = new Date().toLocaleDateString("en-CA", { timeZone });
  return {
    ok: true,
    filename: buildExportFilename(form.name, "todos", today),
    csv: result.csv,
    rows: result.rows,
    truncated: result.truncated || loaded.truncated,
  };
}

export type FileUrlResult = { ok: true; url: string; expiresInSeconds: number } | { ok: false; error: string };

/** Un link de 60 segundos a un archivo de una respuesta, solo si quien lo pide la ve. */
export async function getSubmissionFileUrl(input: { submissionId: string; path: string }): Promise<FileUrlResult> {
  const ctx = await getPermissionAction("forms.view");
  if (!ctx) return { ok: false, error: "No tenés permiso para ver formularios" };
  if (!UUID.test(input.submissionId) || typeof input.path !== "string") return { ok: false, error: "Los datos no son válidos" };

  // La RLS decide si esta persona ve la respuesta; si no, es como si no existiera.
  const { data: submission } = await ctx.supabase
    .from("form_submissions")
    .select("id, answers, upload_prefix")
    .eq("id", input.submissionId)
    .eq("workspace_id", ctx.workspace.id)
    .maybeSingle();
  if (!submission) return { ok: false, error: "No encontré esa respuesta" };

  if (!isFileOfSubmission(submission.answers as Record<string, { value?: unknown }>, submission.upload_prefix, input.path)) {
    return { ok: false, error: "Ese archivo no es de esta respuesta" };
  }

  const service = await createServiceClient();
  const { data, error } = await service.storage.from(UPLOADS_BUCKET).createSignedUrl(input.path, SIGNED_URL_SECONDS);
  if (error || !data?.signedUrl) return { ok: false, error: "No pudimos abrir el archivo. Probá de nuevo." };
  return { ok: true, url: data.signedUrl, expiresInSeconds: SIGNED_URL_SECONDS };
}
