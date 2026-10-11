import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { resolveViewerTimezone } from "@/lib/user-timezone";
import { getWorkspaceMembers } from "@/lib/workspace-members";
import { FormEditor } from "@/components/forms/editor/form-editor";
import type { EditorForm, EditorVersion } from "@/components/forms/editor/types";
import { defaultDesign, type FormDesign } from "@/lib/forms/defaults";
import type { FormDefinition, FormStatus, FormType } from "@/lib/forms/fields";
import { DEFAULT_SUCCESS, validateSuccess } from "@/lib/forms/success";
import { isTurnstileConfigured } from "@/lib/forms/server-ports";

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
  const turnstileConfigured = await isTurnstileConfigured(service, workspace.id);

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
  };

  return (
    <FormEditor
      form={editorForm}
      versions={versions}
      canManage={ctx.can("forms.manage")}
      turnstileConfigured={turnstileConfigured}
      appUrl={process.env.NEXT_PUBLIC_APP_URL ?? ""}
      timeZone={timeZone}
    />
  );
}
