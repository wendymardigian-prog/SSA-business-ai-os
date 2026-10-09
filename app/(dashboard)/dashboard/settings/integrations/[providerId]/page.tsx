import { notFound } from "next/navigation";
import { requireWorkspaceAdmin } from "@/lib/auth/guards";
import { getVisibleProvider, serializableProvider } from "@/lib/integrations/providers";
import { loadIntegrations } from "@/lib/integrations/load";
import { publisherIdFor } from "@/lib/integrations/provider-publisher";
import { parsePublishers } from "@/lib/social/accounts-schema";
import { activityActionLabel } from "@/lib/integrations/activity";
import { getWorkspaceMembers, memberLabels } from "@/lib/workspace-members";
import { IntegrationDetail } from "@/components/settings/integrations/integration-detail";
import type { Channel } from "@/components/channels/channels-panel";
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

  // Cuentas: los canales conectados (las filas completas), los mismos que se
  // ven en /dashboard/channels. "Cuentas" y "canales" son lo mismo: el panel de
  // la pestaña filtra por proveedor (Zernio o Evolution).
  let channels: Channel[] = [];
  if (provider.id === "zernio" || provider.id === "evolution") {
    const { data } = await supabase
      .from("channels")
      .select("*")
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false });
    channels = data ?? [];
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
      provider={serializableProvider(provider)}
      data={data}
      webhookUrl={loaded.webhookUrls[provider.id] ?? null}
      channels={channels}
      metaAccounts={loaded.metaAccounts}
      metaIgUsername={loaded.metaIgUsername}
      youtubeVerifiedAt={loaded.youtubeVerifiedAt}
      socialAccounts={socialAccounts}
      activityEntries={activityEntries}
    />
  );
}
