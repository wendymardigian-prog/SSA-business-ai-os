import { redirect } from "next/navigation";
import { getPermissionContext } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { canOpenConfig } from "@/lib/scheduling/config-sections";
import { ensureNoEventFlows } from "@/lib/scheduling/automation/templates";
import { flowsWithoutEvent } from "@/lib/scheduling/data/event-flows";
import { NO_EVENT_FLOWS_PATH } from "@/lib/scheduling/booking/guest-notice";
import { ConfigShell } from "@/components/scheduling/config-shell";
import { FlowsSection } from "@/components/scheduling/event-editor/flows-section";

export const dynamic = "force-dynamic";

/**
 * Las confirmaciones de las reuniones con titulo libre: las que se agendan a mano
 * sin elegir un evento, y que por eso no tienen la pestaña Flujos de un evento.
 *
 * Son del negocio y no de una persona: las edita quien tiene `settings.general`.
 */
export default async function ReunionesSinEventoPage() {
  const ctx = await getPermissionContext();
  if (!canOpenConfig(ctx.can)) redirect("/dashboard/agenda");

  const canEdit = ctx.can("settings.general");
  const service = await createServiceClient();
  if (canEdit) await ensureNoEventFlows(service, ctx.workspace.id);
  const flows = await flowsWithoutEvent(service, ctx.workspace.id);

  return (
    <ConfigShell route={NO_EVENT_FLOWS_PATH}>
      <div>
        <h2 className="text-base font-semibold">Reuniones sin evento</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Los mensajes de las reuniones que se agendan a mano con un título libre. Si elegís un evento al agendar, valen los flujos de ese evento. La hora siempre sale en la zona del invitado.
        </p>
        {!canEdit && <p className="mt-2 text-sm text-muted-foreground">Solo los puede cambiar quien administra los ajustes del negocio.</p>}
      </div>
      <FlowsSection flowsPath={NO_EVENT_FLOWS_PATH} flows={flows} canEdit={canEdit} />
    </ConfigShell>
  );
}
