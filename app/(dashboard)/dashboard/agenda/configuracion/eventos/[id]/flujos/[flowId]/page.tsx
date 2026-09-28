import { notFound, redirect } from "next/navigation";
import { getPermissionContext } from "@/lib/auth/guards";
import { flowGraph } from "@/lib/scheduling/data/event-flows";
import { flowToLinear } from "@/lib/scheduling/automation/linear-flow";
import { planRelativeJobs, type BookingTriggerConfig, type TriggerForPlanning } from "@/lib/scheduling/automation/triggers";
import { LinearFlowEditor } from "@/components/scheduling/event-editor/linear-flow-editor";

export const dynamic = "force-dynamic";

/**
 * El editor de un flujo del evento (F57).
 *
 * "Hoy alcanzaría a N" se calcula con la MISMA función que agenda los avisos
 * (`planRelativeJobs`): si dijera otro número, uno de los dos estaría mintiendo.
 */
export default async function FlujoDelEventoPage({ params }: { params: Promise<{ id: string; flowId: string }> }) {
  const ctx = await getPermissionContext();
  if (!ctx.can("scheduling.use")) redirect("/dashboard/agenda");

  const { id, flowId } = await params;
  const found = await flowGraph(ctx.supabase, flowId);
  if (!found || found.flow.workspace_id !== ctx.workspace.id || found.flow.event_type_id !== id) notFound();

  const linear = flowToLinear(found.nodes, found.edges);

  // A cuántas reuniones futuras alcanzaría hoy.
  let reach: number | null = null;
  const triggerNode = found.nodes.find((n) => n.type === "trigger");
  const triggerType = String((triggerNode?.data ?? {}).triggerType ?? "");
  if (triggerType.startsWith("booking_")) {
    const { data: bookings } = await ctx.supabase
      .from("bookings")
      .select("id, event_type_id, host_user_id, origin, status, category_snapshot, start_at, end_at, created_at, reschedule_count")
      .eq("workspace_id", ctx.workspace.id)
      .eq("status_group", "active")
      .gt("end_at", new Date().toISOString())
      .limit(500);

    const trigger: TriggerForPlanning = {
      id: flowId,
      type: triggerType,
      is_active: true,
      config: (triggerNode?.data ?? {}) as BookingTriggerConfig,
    };
    reach = (bookings ?? []).filter((b) => planRelativeJobs(b as never, [trigger]).length > 0).length;
  }

  return (
    <LinearFlowEditor
      eventId={id}
      flowId={flowId}
      flowName={found.flow.name}
      linear={linear}
      enabled={found.flow.status === "published"}
      reach={reach}
    />
  );
}
