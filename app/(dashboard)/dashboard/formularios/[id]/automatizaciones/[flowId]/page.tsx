import { notFound, redirect } from "next/navigation";
import { getPermissionContext } from "@/lib/auth/guards";
import { formFlowGraph } from "@/lib/forms/data/form-flows";
import { flowToTree } from "@/lib/automations/step-tree";
import { loadFormsWithFields } from "@/lib/flow-engine/registry/form-triggers";
import { conditionSources } from "@/lib/forms/builder";
import { commonFields } from "@/lib/forms/automation/trigger-config";
import type { VisibilityConfig } from "@/lib/forms/visibility-types";
import { FormLinearFlowEditor } from "@/components/forms/editor/form-linear-flow-editor";
import type { FormField } from "@/lib/forms/fields";
import { EodFlowEditor } from "@/components/eod/editor/eod-flow-editor";
import { EOD_TRIGGER } from "@/lib/eod/automation/trigger-name";
import { loadEodFormsForSchema } from "@/lib/flow-engine/registry/eod-triggers";
import { eodVariableSchema } from "@/lib/eod/automation/variables";
import { getWorkspaceMembers } from "@/lib/workspace-members";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * El editor de una automatización de un formulario (F21): Cuándo / Solo si… / pasos
 * (con Condiciones). Un flujo que no es un árbol de pasos se abre en solo lectura,
 * con "Abrir en el canvas".
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

  const triggerNode = found.nodes.find((n) => n.type === "trigger");
  const triggerData = (triggerNode?.data ?? {}) as Record<string, unknown>;
  const triggerType = String(triggerData.triggerType ?? "form_submitted");

  // Un reporte de fin de día: su propio editor (sin contacto, sin «Solo si…»).
  if (triggerType === EOD_TRIGGER) {
    const [forms, members] = await Promise.all([loadEodFormsForSchema(ctx.supabase, ctx.workspace.id, [id]), getWorkspaceMembers(ctx.workspace.id)]);
    const variableKeys = [
      "member.name",
      "member.email",
      "eod.date",
      "eod.role",
      "eod.channels",
      "eod.all_answers",
      "report.url",
      ...eodVariableSchema(forms).map((s) => s.path).filter((p) => p.startsWith("answer.") || p.startsWith("channel.") || p.startsWith("metrics.")),
    ];
    return (
      <EodFlowEditor
        formId={id}
        formName={form.name}
        flowId={flowId}
        flowName={found.flow.name}
        tree={flowToTree(found.nodes, found.edges)}
        trigger={{ type: triggerType, config: triggerData }}
        enabled={enabled}
        variableKeys={[...new Set(variableKeys)]}
        members={members.map((m) => ({ userId: m.userId, name: m.name }))}
      />
    );
  }

  // El «Solo si…»: las preguntas de los formularios del disparador (las de la versión publicada,
  // o el borrador si todavía no se publicó). Un contrato firmado no tiene respuestas que filtrar.
  let onlyIf: { sources: ReturnType<typeof conditionSources>; value: VisibilityConfig | undefined } | undefined;
  if (triggerType !== "contract_signed") {
    const formIds = (Array.isArray(triggerData.form_ids) ? triggerData.form_ids : []).filter((v): v is string => typeof v === "string");
    const forms = formIds.length > 0 ? await loadFormsWithFields(ctx.supabase, ctx.workspace.id, formIds) : [];
    const common = commonFields(forms);
    onlyIf = { sources: conditionSources(common, common.length), value: (triggerData.answer_conditions as VisibilityConfig | null | undefined) ?? undefined };
  }

  return (
    <FormLinearFlowEditor
      formId={id}
      formName={form.name}
      answerKeys={answerKeys}
      flowId={flowId}
      flowName={found.flow.name}
      tree={flowToTree(found.nodes, found.edges)}
      trigger={{ type: triggerType, config: triggerData }}
      enabled={enabled}
      onlyIf={onlyIf}
    />
  );
}
