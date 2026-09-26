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
      <div className="border-b border-border px-4 py-4 queue:px-8 queue:py-6">
        {/* Bloque 2d: la cola no tiene entrada en el menu; necesita una salida evidente. */}
        <Link
          href="/dashboard/inbox"
          className="-ml-1 inline-flex min-h-11 items-center gap-1 rounded-lg px-1 text-sm text-muted-foreground hover:text-foreground queue:min-h-0 queue:text-xs"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Volver a Inbox
        </Link>
        <h1 className="mt-1 text-xl font-bold queue:mt-2 queue:text-2xl">Borradores</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Las respuestas que el agente redactó y esperan que alguien las apruebe. Lo que vence antes aparece primero.
        </p>
      </div>

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
