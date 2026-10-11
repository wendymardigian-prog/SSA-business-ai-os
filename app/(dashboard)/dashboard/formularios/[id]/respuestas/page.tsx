import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/guards";
import { resolveViewerTimezone } from "@/lib/user-timezone";
import { ResponsesTable, type ResponseTableRow } from "@/components/forms/responses/responses-table";
import { fieldsOf } from "@/lib/forms/server-ports";
import { FORM_LIMITS } from "@/lib/forms/limits";
import { parseResponseFilters, responseColumns, type ResponseRow } from "@/lib/forms/responses";
import { applyResponseFilters } from "@/lib/forms/responses-query";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Las respuestas de un formulario (F13). Lee con el cliente de la persona: la
 * RLS decide cuáles ve (un Member, solo las de contactos que ve). Los filtros de
 * la URL se aplican EN LA CONSULTA.
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

  const timeZone = await resolveViewerTimezone(workspace.timezone);
  const filters = parseResponseFilters(sp);
  const pageSize = FORM_LIMITS.pageSize;
  const from = (filters.page - 1) * pageSize;

  let definition = form.draft_definition;
  if (form.current_version_id) {
    const { data: version } = await supabase.from("form_versions").select("definition").eq("id", form.current_version_id).maybeSingle();
    if (version) definition = version.definition;
  }

  const base = supabase
    .from("form_submissions")
    .select("id, created_at, status, contact_id, answers, score, nps_category, meta", { count: "exact" })
    .eq("form_id", id)
    .eq("workspace_id", workspace.id);
  const { data, count, error } = await applyResponseFilters(base, filters, timeZone)
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);

  const submissions = data ?? [];
  const contactIds = [...new Set(submissions.map((s) => s.contact_id).filter((c): c is string => !!c))];
  const { data: contacts } = contactIds.length
    ? await supabase.from("contacts").select("id, display_name, email").in("id", contactIds)
    : { data: [] as Array<{ id: string; display_name: string | null; email: string | null }> };
  const byId = new Map((contacts ?? []).map((c) => [c.id, c]));

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
  const columns = responseColumns(fieldsOf(definition), rows);

  const tableRows: ResponseTableRow[] = rows.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    status: r.status,
    contactId: r.contact_id,
    contactName: r.contact_name ?? null,
    answers: r.answers,
    score: r.score ?? null,
    npsCategory: r.nps_category ?? null,
  }));

  return (
    <ResponsesTable
      formId={form.id}
      formName={form.name}
      formType={form.type as "custom" | "survey" | "contract"}
      rows={tableRows}
      columns={columns}
      total={count ?? 0}
      page={filters.page}
      pageSize={pageSize}
      filters={{ from: filters.from ?? "", to: filters.to ?? "", status: filters.status ?? "all", contact: filters.contact ?? "all" }}
      loadError={!!error}
      canManage={ctx.can("forms.manage")}
      timeZone={timeZone}
    />
  );
}
