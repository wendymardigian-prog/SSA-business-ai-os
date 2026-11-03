/**
 * La lista de contactos: respuestas de formularios.
 *
 * Cuentan las respuestas vinculadas al contacto que no son spam. Respeta la
 * RLS de `form_submissions` (`can_see_form_submission`).
 *
 * Es del módulo Formularios: la plantilla de estudiantes no lo lleva y borra
 * este archivo (`scripts/plantilla/perfiles/estudiantes.mjs`).
 */
import { relatedMultiFilter } from "../filters/catalog";
import { UUID_RE, byContact, fillCells, plural, type CellValue, type ContactListModule, type ListClause, type ListGroupDef } from "../filters/types";

export const FORMS_GROUP: ListGroupDef = { key: "formularios", label: "Formularios", order: 75 };

const NOT_SPAM: ListClause[] = [{ op: "neq", column: "status", value: "spam" }];
const isId = (v: string) => UUID_RE.test(v);

interface SubmissionRow {
  contact_id: string;
  form_id: string;
  created_at: string;
}

export const formsModule: ContactListModule = {
  key: "formularios",
  filters: [
    relatedMultiFilter({
      param: "formulario",
      label: "Respondió el formulario",
      group: FORMS_GROUP,
      relation: "form_submissions",
      column: "form_id",
      base: NOT_SPAM,
      baseColumns: ["status"],
      accepts: isId,
      options: { from: "forms" },
      keywords: "encuesta contrato respuesta",
      hint: "Respondió alguno de estos.",
    }),
    relatedMultiFilter({
      param: "sin_formulario",
      label: "No respondió el formulario",
      group: FORMS_GROUP,
      relation: "form_submissions",
      column: "form_id",
      base: NOT_SPAM,
      baseColumns: ["status"],
      accepts: isId,
      options: { from: "forms" },
      keywords: "encuesta contrato pendiente",
      hint: "No respondió ninguno de estos.",
      negate: true,
    }),
  ],
  columns: [
    { key: "last_form", label: "Último formulario", group: FORMS_GROUP, hideable: true, defaultVisible: false, source: "related", keywords: "respuesta encuesta" },
    { key: "forms_count", label: "Respuestas de formularios", group: FORMS_GROUP, hideable: true, defaultVisible: false, source: "related", keywords: "cantidad" },
  ],
  async loadOptions(supabase, workspaceId) {
    const { data, error } = await supabase
      .from("forms")
      .select("id, name, type")
      .eq("workspace_id", workspaceId)
      .neq("type", "eod")
      .is("archived_at", null)
      .order("name");
    if (error) throw new Error(error.message);
    return { forms: (data ?? []).map((f) => ({ value: f.id, label: f.name })) };
  },
  async loadCells(supabase, workspaceId, contactIds, keys) {
    const [subs, forms] = await Promise.all([
      supabase
        .from("form_submissions")
        .select("contact_id, form_id, created_at")
        .eq("workspace_id", workspaceId)
        .in("contact_id", [...contactIds])
        .neq("status", "spam")
        .order("created_at", { ascending: false })
        .limit(1000),
      supabase.from("forms").select("id, name").eq("workspace_id", workspaceId),
    ]);
    if (subs.error) throw new Error(subs.error.message);
    const names = new Map((forms.data ?? []).map((f) => [f.id, f.name]));
    return formCells(contactIds, keys, (subs.data ?? []) as SubmissionRow[], names);
  },
};

/** Puro: las celdas a partir de las respuestas de la página (la más reciente primero). */
export function formCells(contactIds: readonly string[], keys: readonly string[], rows: readonly SubmissionRow[], names: ReadonlyMap<string, string>) {
  const grouped = byContact(rows);
  return fillCells(contactIds, keys, (id) => {
    const list = grouped.get(id) ?? [];
    const last = list[0];
    const cells: Record<string, CellValue> = {
      last_form: last ? { t: "date", at: last.created_at, mode: "day", sub: names.get(last.form_id) ?? "Formulario" } : null,
      forms_count: list.length > 0 ? { t: "text", text: plural(list.length, "respuesta", "respuestas") } : null,
    };
    return cells;
  });
}
