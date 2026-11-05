import { notFound, redirect } from "next/navigation";
import { getPermissionContext } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { flowGraph } from "@/lib/scheduling/data/event-flows";
import { flowToTree } from "@/lib/automations/step-tree";
import { isNoEventTemplateKey } from "@/lib/scheduling/automation/templates";
import { NO_EVENT_FLOWS_PATH } from "@/lib/scheduling/booking/guest-notice";
import { LinearFlowEditor } from "@/components/scheduling/event-editor/linear-flow-editor";

export const dynamic = "force-dynamic";

/** El editor de un flujo de "Reuniones sin evento". El mismo que el de un evento. */
export default async function FlujoSinEventoPage({ params }: { params: Promise<{ flowId: string }> }) {
  const ctx = await getPermissionContext();
  if (!ctx.can("settings.general")) redirect(NO_EVENT_FLOWS_PATH);

  const { flowId } = await params;
  // Con el servidor, despues del permiso: la RLS de `flows` pide otras claves.
  const found = await flowGraph(await createServiceClient(), flowId);
  if (!found || found.flow.workspace_id !== ctx.workspace.id || !isNoEventTemplateKey(found.flow.template_key)) notFound();

  const triggerNode = found.nodes.find((n) => n.type === "trigger");

  return (
    <LinearFlowEditor
      backPath={NO_EVENT_FLOWS_PATH}
      routeForHeader={`${NO_EVENT_FLOWS_PATH}/flujos/${flowId}`}
      flowId={flowId}
      flowName={found.flow.name}
      tree={flowToTree(found.nodes, found.edges)}
      trigger={{ type: String((triggerNode?.data ?? {}).triggerType ?? ""), config: (triggerNode?.data ?? {}) as Record<string, unknown> }}
      enabled={found.flow.status === "published"}
      reach={null}
    />
  );
}
