import Link from "next/link";
import { MessageSquareText } from "lucide-react";
import { requireAnyPermission } from "@/lib/auth/guards";
import { getWorkspace } from "@/lib/workspace";
import { createServiceClient } from "@/lib/supabase/server";
import { getWorkspaceMembers } from "@/lib/workspace-members";
import { resolveViewerTimezone } from "@/lib/user-timezone";
import { loadApprovalsScreen } from "@/lib/ai-proposals/screen";
import { PageHeader } from "@/components/page-header";
import { BackLink } from "@/components/ui/back-link";
import { ApprovalsView } from "@/components/agents/approvals/approvals-view";

/**
 * Bandeja de aprobación: las acciones que proponen los agentes, una por una. Aprobar (tal cual o editada) o
 * rechazar con un motivo de la lista cerrada. La ve quien ve los agentes (`agents.view`) o quien usa el asistente
 * (`assistant.use`, sus propias propuestas); la RLS de `ai_proposals` decide qué filas. Los mensajes propuestos siguen en
 * Borradores.
 */
export default async function ApprovalsPage() {
  const permissions = await requireAnyPermission(["agents.view", "assistant.use"]);
  const [{ workspace, user, supabase }, service] = await Promise.all([getWorkspace(), createServiceClient()]);
  const [members, timeZone] = await Promise.all([getWorkspaceMembers(workspace.id), resolveViewerTimezone(workspace.timezone)]);
  const screen = await loadApprovalsScreen({
    session: supabase,
    service,
    workspaceId: workspace.id,
    viewerId: user.id,
    can: permissions.can,
    memberNames: new Map(members.map((m) => [m.userId, m.name])),
  });

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        route="/dashboard/agents/aprobaciones"
        backHref={<BackLink href="/dashboard/agents" label="Volver a Agentes IA" />}
        right={
          <Link
            href="/dashboard/drafts?quien=todos"
            aria-label={`Mensajes propuestos${screen.pendingDrafts > 0 ? ` (${screen.pendingDrafts})` : ""}`}
            className="inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border border-border px-3 text-sm font-medium transition-colors hover:bg-accent"
          >
            <MessageSquareText className="h-4 w-4" aria-hidden />
            <span className="hidden sm:inline">Mensajes propuestos</span>
            {screen.pendingDrafts > 0 && <span className="tabular-nums">{screen.pendingDrafts}</span>}
          </Link>
        }
      />
      <div className="flex-1 overflow-auto px-4 py-6 md:px-8">
        <ApprovalsView pending={screen.pending} decided={screen.decided} timeZone={timeZone} />
      </div>
    </div>
  );
}
