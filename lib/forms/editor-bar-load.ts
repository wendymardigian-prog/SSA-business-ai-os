/**
 * Lo que la barra del editor necesita de un formulario en las pantallas que NO cargan el borrador entero
 * (respuestas, metricas, encuesta, reportes): tipo, estado, si hay cambios sin publicar y cuantas respuestas hay.
 * Se lee con el cliente de la persona: la RLS decide que cuenta (un Member cuenta las de sus contactos).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { parseStoredEodConfig } from "@/lib/eod/config";
import { contactWarning, hasUnpublishedChanges } from "./publish";
import { parseStoredContactConfig } from "./contact-config";
import type { FormDefinition, FormStatus, FormType } from "./fields";
import type { BarForm } from "./editor-bar";

type Db = SupabaseClient<Database>;

export interface EditorBarData {
  form: BarForm & { name: string; slug: string };
  /** El aviso de "Publicar sin contactos", o null si no corresponde. */
  noContactsWarning: string | null;
}

/** Cuantas respuestas (o reportes enviados, en un fin de dia) ve esta persona: para el numerito de la pestaña. */
export async function countResponses(supabase: Db, workspaceId: string, formId: string, type: FormType): Promise<number | null> {
  const result =
    type === "eod"
      ? await supabase.from("eod_reports").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("form_id", formId).eq("status", "submitted")
      : await supabase.from("form_submissions").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("form_id", formId).neq("status", "spam");
  return result.error ? null : (result.count ?? 0);
}

export async function loadEditorBar(supabase: Db, workspaceId: string, formId: string): Promise<EditorBarData | null> {
  const { data: form } = await supabase
    .from("forms")
    .select("id, name, type, status, slug, draft_definition, current_version_id, contact_config, eod_config")
    .eq("id", formId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!form) return null;

  const isEod = form.type === "eod";
  const [version, count] = await Promise.all([
    form.current_version_id
      ? supabase.from("form_versions").select("definition, contract_text").eq("id", form.current_version_id).maybeSingle()
      : Promise.resolve({ data: null }),
    countResponses(supabase, workspaceId, formId, form.type as FormType),
  ]);

  const draft = (form.draft_definition as unknown as FormDefinition) ?? { fields: [] };
  const current = version.data;
  const published: FormDefinition | null = current
    ? { ...(current.definition as unknown as FormDefinition), ...(current.contract_text !== null && current.contract_text !== undefined ? { contractText: current.contract_text } : {}) }
    : null;

  return {
    form: {
      id: form.id,
      name: form.name,
      slug: form.slug,
      type: form.type as FormType,
      status: form.status as FormStatus,
      eodVariant: isEod ? (parseStoredEodConfig(form.eod_config)?.variant ?? null) : null,
      hasUnpublishedChanges: hasUnpublishedChanges(draft, published),
      responseCount: count,
    },
    noContactsWarning: isEod ? null : contactWarning(parseStoredContactConfig(form.contact_config), draft.fields),
  };
}
