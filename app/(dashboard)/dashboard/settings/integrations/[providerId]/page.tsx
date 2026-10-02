import { notFound } from "next/navigation";
import { requireWorkspaceAdmin } from "@/lib/auth/guards";
import { getVisibleProvider } from "@/lib/integrations/providers";
import { loadIntegrations } from "@/lib/integrations/load";
import { publisherIdFor } from "@/lib/integrations/provider-publisher";
import { parsePublishers } from "@/lib/social/accounts-schema";
import { activityActionLabel } from "@/lib/integrations/activity";
import { getWorkspaceMembers, memberLabels } from "@/lib/workspace-members";
import { IntegrationDetail } from "@/components/settings/integrations/integration-detail";
import type { EvolutionChannelInfo } from "@/components/settings/integrations/accounts-tab";
import type { SocialAccountRow } from "@/components/settings/integrations/publisher-defaults";
import type { AuditAction } from "@/lib/types/database";

/**
 * El detalle de una integracion (G5): credenciales, cuentas y actividad, en
 * una sola pantalla con pestañas. Reemplaza al modal generico.
 *
 * Reusa `loadIntegrations` (G3): la misma funcion que arma el listado arma el
 * estado de esta card, asi que la salud de la credencial es identica en los
 * dos lados.
 */
export default async function IntegrationDetailPage({
  params,
}: {
  params: Promise<{ providerId: string }>;
}) {
  const { providerId } = await params;
  const provider = getVisibleProvider(providerId);
  if (!provider) notFound();

  const { workspace, supabase } = await requireWorkspaceAdmin();

  const [loaded, auditResult, members] = await Promise.all([
    loadIntegrations(supabase, workspace.id),
    supabase
      .from("audit_log")
      .select("id, action, metadata, performed_at, performed_by")
      .eq("workspace_id", workspace.id)
      .eq("entity_type", "channel")
      .eq("entity_id", workspace.id)
      .contains("metadata", { provider: provider.id })
      .order("performed_at", { ascending: false })
      .limit(50),
    getWorkspaceMembers(workspace.id),
  ]);

  const data = loaded.integrations[provider.id];
  const labels = memberLabels(members);
  const activityEntries = (auditResult.data ?? []).map((row) => ({
    id: row.id,
    label: activityActionLabel(row.action as AuditAction),
    performedAt: row.performed_at,
    actorLabel: row.performed_by ? (labels.get(row.performed_by) ?? "Alguien del equipo") : "El sistema",
  }));

  // Cuentas (G6): el canal de Evolution, con el mismo connection_status y
  // last_error que muestra /dashboard/channels.
  let evolutionChannel: EvolutionChannelInfo | null = null;
  if (provider.id === "evolution") {
    const { data: channel } = await supabase
      .from("channels")
      .select("connection_status, last_error, display_name, username")
      .eq("workspace_id", workspace.id)
      .eq("provider", "evolution")
      .maybeSingle();
    evolutionChannel = channel
      ? {
          connectionStatus: channel.connection_status,
          lastError: channel.last_error,
          label: channel.display_name || channel.username,
        }
      : null;
  }

  // Cuentas (G7): las cuentas sociales que tienen ESTE publicador entre sus
  // entradas, sin importar la plataforma (Zernio aparece en instagram Y
  // tiktok; Google y Postproxy, solo en youtube).
  const publisherId = publisherIdFor(provider.id);
  let socialAccounts: SocialAccountRow[] = [];
  if (publisherId) {
    const { data: accounts } = await supabase
      .from("social_accounts")
      .select("id, platform, default_publisher, publishers")
      .eq("workspace_id", workspace.id);

    socialAccounts = (accounts ?? [])
      .map((account): SocialAccountRow | null => {
        const parsed = parsePublishers(account.publishers);
        if (!parsed.ok) return null;
        return {
          id: account.id,
          platform: account.platform as string,
          defaultPublisher: account.default_publisher,
          publishers: parsed.publishers,
        };
      })
      .filter((account): account is SocialAccountRow => account !== null)
      .filter((account) => account.publishers.some((p) => p.publisher === publisherId));
  }

  return (
    <IntegrationDetail
      provider={provider}
      data={data}
      webhookUrl={loaded.webhookUrls[provider.id] ?? null}
      channelsSummary={loaded.channelsSummary}
      metaAccounts={loaded.metaAccounts}
      metaIgUsername={loaded.metaIgUsername}
      youtubeVerifiedAt={loaded.youtubeVerifiedAt}
      evolutionChannel={evolutionChannel}
      socialAccounts={socialAccounts}
      activityEntries={activityEntries}
    />
  );
}
