import { notFound, redirect } from "next/navigation";
import { getPermissionContext } from "@/lib/auth/guards";
import { formFlowGraph } from "@/lib/forms/data/form-flows";
import { flowToLinear } from "@/lib/scheduling/automation/linear-flow";
import { FormLinearFlowEditor } from "@/components/forms/editor/form-linear-flow-editor";
import type { FormField } from "@/lib/forms/fields";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * El editor de una automatización de un formulario (F21): Cuándo / Si / Entonces.
 * Un flujo con ramas se abre en solo lectura, con "Abrir en el canvas".
 */
export default async function AutomatizacionDeFormularioPage({ params }: { params: Promise<{ id: string; flowId: string }> }) {
  const ctx = await getPermissionContext();
  const { id, flowId } = await params;
  if (!ctx.can("forms.view")) redirect("/dashboard");
  if (!UUID.test(id) || !UUID.test(flowId)) notFound();

  const found = await formFlowGraph(ctx.supabase, flowId);
  if (!found || found.flow.workspace_id !== ctx.workspace.id || found.flow.form_id !== id) notFound();

  const { data: form } = await ctx.supabase.from("forms").select("id, name, draft_definition").eq("id", id).eq("workspace_id", ctx.workspace.id).maybeSingle();
  if (!form) notFound();

  const triggerRow = await ctx.supabase.from("triggers").select("is_active").eq("flow_id", flowId).limit(1).maybeSingle();
  const enabled = found.flow.status === "published" && Boolean(triggerRow.data?.is_active);
  const answerKeys = (((form.draft_definition as { fields?: FormField[] } | null)?.fields ?? []) as FormField[]).filter((f) => f.type !== "file").map((f) => f.key);

  return (
    <FormLinearFlowEditor
      formId={id}
      formName={form.name}
      answerKeys={answerKeys}
      flowId={flowId}
      flowName={found.flow.name}
      linear={flowToLinear(found.nodes, found.edges)}
      enabled={enabled}
    />
  );
}
