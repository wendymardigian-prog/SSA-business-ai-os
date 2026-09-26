import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getWorkspace } from "@/lib/workspace";
import { isAdminRole } from "@/lib/auth/roles";
import { getWorkspaceMembers } from "@/lib/workspace-members";
import { platformLabel } from "@/lib/platforms";
import { AGENT_PUBLIC_COLUMNS, publicChannelMode, type PublicAgent } from "@/lib/agent/public";
import { getAgentType } from "@/lib/agent/agent-types";
import { loadDraftQueue, parseDraftFilters } from "@/lib/agent/drafts/queue-query";
import { DraftsView } from "@/components/drafts/drafts-view";
import { MetricsStrip } from "@/components/drafts/metrics-strip";
import { PageHeader } from "@/components/page-header";

/**
 * Borradores (Bloque 2c): las respuestas que el agente dejo para aprobar.
 *
 * La ven todos: aprobar es operar, no configurar. Todo se lee con el cliente
 * del usuario, asi la RLS acota a un Member a los borradores de sus leads.
 */
export default async function DraftsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const { workspace, user, role, supabase } = await getWorkspace();
  const isAdmin = isAdminRole(role);

  const [members, channelsRes, agentsRes] = await Promise.all([
    getWorkspaceMembers(workspace.id),
    supabase.from("channels").select("id, platform, username").eq("workspace_id", workspace.id),
    // Columnas explicitas: los topes de gasto no son legibles para el usuario (00060).
    supabase.from("agents").select(AGENT_PUBLIC_COLUMNS).eq("workspace_id", workspace.id).is("deleted_at", null),
  ]);

  const channels = (channelsRes.data ?? []).map((c) => ({
    id: c.id,
    label: c.username ? `${platformLabel(c.platform)} · @${c.username}` : platformLabel(c.platform),
  }));
  const agents = ((agentsRes.data ?? []) as PublicAgent[]).filter((a) => getAgentType(a.type)?.conversational);
  const draftChannels = agents.reduce(
    (n, a) => n + a.enabled_channel_ids.filter((id) => publicChannelMode(a, id) === "draft").length,
    0,
  );

  const filters = parseDraftFilters(query, {
    memberIds: members.map((m) => m.userId),
    channelIds: channels.map((c) => c.id),
  });
  const queue = await loadDraftQueue(supabase, { workspaceId: workspace.id, userId: user.id, filters });

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        route="/dashboard/drafts"
        backHref={
          // Bloque 2d: la cola no tiene entrada en el menu; necesita una
          // salida evidente.
          <Link
            href="/dashboard/inbox"
            aria-label="Volver a Inbox"
            className="-ml-1 flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </Link>
        }
      />

      <div className="flex-1 overflow-auto px-4 py-4 queue:px-8 queue:py-6">
        <DraftsView
          workspaceId={workspace.id}
          queue={queue}
          filters={filters}
          members={members.map((m) => ({ userId: m.userId, label: m.userId === user.id ? `${m.name} (vos)` : m.name }))}
          channels={channels}
          isAdmin={isAdmin}
          draftChannels={draftChannels}
          agentId={agents[0]?.id ?? null}
          metrics={
            <MetricsStrip
              workspaceId={workspace.id}
              isAdmin={isAdmin}
              members={members.map((m) => ({ userId: m.userId, label: m.name }))}
              onlyMine={query.metricas === "mios"}
            />
          }
        />
      </div>
    </div>
  );
}
