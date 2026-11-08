import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/guards";
import { resolveViewerTimezone } from "@/lib/user-timezone";
import { EditorBar } from "@/components/forms/editor/editor-bar";
import { loadEditorBar } from "@/lib/forms/editor-bar-load";
import { ResponsesTable, type ResponseTableRow } from "@/components/forms/responses/responses-table";
import { fieldsOf } from "@/lib/forms/server-ports";
import { FORM_LIMITS } from "@/lib/forms/limits";
import { createServiceClient } from "@/lib/supabase/server";
import { metaLinkFromAttribution, metaLinkFromTouch, touchMetaIds } from "@/lib/attribution/meta-link";
import { EMPTY_META_NAMES, loadMetaNamesByIds, metaIdsFrom } from "@/lib/attribution/meta-names";
import { formTouchKey, loadTouchesByKey } from "@/lib/attribution/source-touches";
import { availableDimensions, facetOptions, groupCounts, phoneFieldKey, RESPONSE_DIMENSIONS, type ResponseDimension } from "@/lib/forms/response-index";
import { parseResponseFilters, responseColumns, type ResponseRow } from "@/lib/forms/responses";
import { loadFormResponses } from "@/lib/forms/responses-load";
import type { MultiFilterOption } from "@/lib/ui/multi-filter";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Las respuestas de un formulario (F13). Lee con el cliente de la persona: la
 * RLS decide cuáles ve (un Member, solo las de contactos que ve). Estado, contacto
 * y fecha van en la consulta; búsqueda, país y UTM los aplica `filterIndex`, y la
 * página se corta en memoria (`loadFormResponses`, el mismo camino del CSV). Solo
 * las filas de la página se completan con el contacto y el vínculo con Meta.
 */
export default async function RespuestasPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requirePermission("forms.view");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { supabase, workspace } = ctx;
  const sp = await searchParams;

  const { data: form } = await supabase.from("forms").select("id, name, type, current_version_id, draft_definition").eq("id", id).eq("workspace_id", workspace.id).maybeSingle();
  if (!form) notFound();

  const [timeZone, barData] = await Promise.all([resolveViewerTimezone(workspace.timezone), loadEditorBar(supabase, workspace.id, id)]);
  const filters = parseResponseFilters(sp);
  const pageSize = FORM_LIMITS.pageSize;

  let definition = form.draft_definition;
  if (form.current_version_id) {
    const { data: version } = await supabase.from("form_versions").select("definition").eq("id", form.current_version_id).maybeSingle();
    if (version) definition = version.definition;
  }
  const fields = fieldsOf(definition);
  const phoneKey = phoneFieldKey(fields);
  const dimensions = availableDimensions(phoneKey);
  const groupBy = filters.groupBy && dimensions.includes(filters.groupBy) ? filters.groupBy : null;

  const loaded = await loadFormResponses(supabase, { workspaceId: workspace.id, formId: id, filters, timeZone, phoneKey });
  const total = loaded.matching.length;
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(filters.page, lastPage);
  const submissions = groupBy ? [] : loaded.matching.slice((page - 1) * pageSize, page * pageSize);
  const facets = Object.fromEntries(
    RESPONSE_DIMENSIONS.map((d) => [d, dimensions.includes(d) ? facetOptions(loaded.base, d, phoneKey) : []]),
  ) as Record<ResponseDimension, MultiFilterOption[]>;
  const groups = groupBy ? groupCounts(loaded.matching, groupBy, phoneKey) : null;

  const contactIds = [...new Set(submissions.map((s) => s.contact_id).filter((c): c is string => !!c))];
  const { data: contacts } = contactIds.length
    ? await supabase.from("contacts").select("id, display_name, email").in("id", contactIds)
    : { data: [] as Array<{ id: string; display_name: string | null; email: string | null }> };
  const byId = new Map((contacts ?? []).map((c) => [c.id, c]));

  const attributions = new Map(submissions.map((s) => [s.id, s.attribution]));
  // El vinculo con Meta es el del toque de cada respuesta; sin toque (sin contacto), los ids que trajo su URL.
  const touches = await loadTouchesByKey(await createServiceClient(), workspace.id, submissions.map((s) => formTouchKey(s.id)));
  const metaIds = submissions.map((s) => {
    const touch = touches.get(formTouchKey(s.id));
    return touch ? touchMetaIds(touch) : metaIdsFrom(attributions.get(s.id));
  });
  const metaNames = ctx.can("dashboards.ads.view") ? await loadMetaNamesByIds(supabase, workspace.id, metaIds) : EMPTY_META_NAMES;
  const metaLinkOf = (id: string) => {
    const touch = touches.get(formTouchKey(id));
    return touch ? metaLinkFromTouch(touch, metaNames) : metaLinkFromAttribution(attributions.get(id), metaNames);
  };

  const rows: ResponseRow[] = submissions.map((s) => ({
    id: s.id,
    created_at: s.created_at,
    status: s.status,
    contact_id: s.contact_id,
    contact_name: s.contact_id ? byId.get(s.contact_id)?.display_name ?? byId.get(s.contact_id)?.email ?? "Sin nombre" : null,
    contact_email: s.contact_id ? byId.get(s.contact_id)?.email ?? null : null,
    answers: (s.answers ?? {}) as unknown as ResponseRow["answers"],
    score: s.score,
    nps_category: s.nps_category,
  }));
  // Las columnas salen de todas las respuestas del período, no solo de la página: una pregunta que ya no está
  // aparece igual aunque esta página no la tenga, y filtrar no hace aparecer ni desaparecer columnas.
  const columns = responseColumns(fields, loaded.base);

  const tableRows: ResponseTableRow[] = rows.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    status: r.status,
    contactId: r.contact_id,
    contactName: r.contact_name ?? null,
    answers: r.answers,
    score: r.score ?? null,
    npsCategory: r.nps_category ?? null,
    attribution: attributions.get(r.id) ?? {},
    metaNames: metaLinkOf(r.id).names,
    metaStatus: metaLinkOf(r.id).statusLabel,
  }));

  return (
    <ResponsesTable
      header={
        barData ? (
          <EditorBar form={barData.form} route="respuestas" canManage={ctx.can("forms.manage")} noContactsWarning={barData.noContactsWarning} />
        ) : null
      }
      formId={form.id}
      formType={form.type as "custom" | "survey" | "contract"}
      rows={tableRows}
      columns={columns}
      total={total}
      baseTotal={loaded.base.length}
      truncated={loaded.truncated}
      page={page}
      pageSize={pageSize}
      filters={{
        period: filters.period ?? { period: "historico", from: null, to: null },
        legacyRange: !!(filters.from || filters.to),
        status: filters.status ?? "all",
        contact: filters.contact ?? "all",
        q: filters.q ?? "",
        dims: filters.dims ?? {},
        groupBy,
      }}
      dimensions={dimensions}
      facets={facets}
      groups={groups}
      loadError={loaded.error}
      canManage={ctx.can("forms.manage")}
      canExport={ctx.can("data.export")}
      timeZone={timeZone}
    />
  );
}
