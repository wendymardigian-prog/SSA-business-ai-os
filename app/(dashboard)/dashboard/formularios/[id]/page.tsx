import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { resolveViewerTimezone } from "@/lib/user-timezone";
import { getWorkspaceMembers } from "@/lib/workspace-members";
import { FormEditor } from "@/components/forms/editor/form-editor";
import type { EditorExtras, EditorForm, EditorVersion } from "@/components/forms/editor/types";
import { flowsForForm } from "@/lib/forms/data/form-flows";
import { parseStoredContactConfig, type CustomFieldDef } from "@/lib/forms/contact-config";
import { parseStoredSurveyConfig } from "@/lib/forms/survey";
import { parseStoredContractConfig } from "@/lib/forms/contract/config";
import { defaultDesign, type FormDesign } from "@/lib/forms/defaults";
import type { FormDefinition, FormStatus, FormType } from "@/lib/forms/fields";
import { DEFAULT_SUCCESS, validateSuccess } from "@/lib/forms/success";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * El editor de un formulario (F4). Se lee con el cliente de la persona: la RLS
 * (`can_view_forms`) decide si lo ve. Editar exige `forms.manage`; sin eso la
 * pantalla se muestra en solo lectura.
 */
export default async function FormularioEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePermission("forms.view");
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const { supabase, workspace } = ctx;
  const { data: form } = await supabase.from("forms").select("*").eq("id", id).eq("workspace_id", workspace.id).maybeSingle();
  if (!form) notFound();

  const [{ data: versionRows }, members, timeZone] = await Promise.all([
    supabase.from("form_versions").select("id, version_number, definition, contract_text, contract_text_sha256, published_by, published_at").eq("form_id", id).order("version_number", { ascending: false }),
    getWorkspaceMembers(workspace.id),
    resolveViewerTimezone(workspace.timezone),
  ]);

  const service = await createServiceClient();
  const [{ data: customRows }, { data: tagRows }, flows] = await Promise.all([
    supabase.from("custom_field_definitions").select("id, slug, name, type").eq("workspace_id", workspace.id).order("name", { ascending: true }),
    supabase.from("tags").select("id, name").eq("workspace_id", workspace.id).order("name", { ascending: true }),
    flowsForForm(supabase, id, { [id]: form.name }),
  ]);

  const names = new Map(members.map((m) => [m.userId, m.name]));
  const versions: EditorVersion[] = (versionRows ?? []).map((v) => ({
    number: v.version_number,
    publishedAt: v.published_at,
    publishedByName: v.published_by ? names.get(v.published_by) ?? null : null,
    shaPrefix: v.contract_text_sha256 ? v.contract_text_sha256.slice(0, 12) : null,
  }));

  const current = (versionRows ?? []).find((v) => v.id === form.current_version_id);
  const published: FormDefinition | null = current
    ? { ...(current.definition as unknown as FormDefinition), ...(current.contract_text !== null ? { contractText: current.contract_text } : {}) }
    : null;

  const success = validateSuccess(form.success);
  const design = { ...defaultDesign(form.name), ...((form.design ?? {}) as Partial<FormDesign>) };

  const editorForm: EditorForm = {
    id: form.id,
    name: form.name,
    type: form.type as FormType,
    status: form.status as FormStatus,
    slug: form.slug,
    updatedAt: form.updated_at,
    draftDefinition: (form.draft_definition as unknown as FormDefinition) ?? { fields: [] },
    design,
    success: success.ok ? success.success : DEFAULT_SUCCESS,
    publishedSnapshot: published,
    contactConfig: parseStoredContactConfig(form.contact_config),
    tagsOnSubmit: form.tags_on_submit ?? [],
    notifyEnabled: form.notify_enabled,
    notifyUserIds: form.notify_user_ids ?? [],
    surveyConfig: form.type === "survey" ? parseStoredSurveyConfig(form.survey_config) : null,
    contractConfig: form.type === "contract" ? parseStoredContractConfig(form.contract_config, form.name) : null,
  };

  const extras: EditorExtras = {
    customFields: (customRows ?? []) as CustomFieldDef[],
    tags: tagRows ?? [],
    members: members.map((m) => ({ userId: m.userId, name: m.name })),
    flows,
    canFlows: ctx.can("flows.edit"),
  };

  return (
    <FormEditor
      form={editorForm}
      versions={versions}
      canManage={ctx.can("forms.manage")}
      appUrl={process.env.NEXT_PUBLIC_APP_URL ?? ""}
      timeZone={timeZone}
      extras={extras}
    />
  );
}
