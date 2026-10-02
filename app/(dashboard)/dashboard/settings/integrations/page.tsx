import { requireWorkspaceAdmin } from "@/lib/auth/guards";
import { IntegrationsGrid } from "@/components/settings/integrations/integrations-grid";
import { loadIntegrations } from "@/lib/integrations/load";

/**
 * Integraciones: todo lo que el sistema conecta con afuera, en una pantalla.
 *
 * `loadIntegrations` arma lo que cada card necesita —estado (ahora con la
 * salud de la credencial OAuth enchufada, G3), cuenta conectada, barra de uso
 * y QUE secretos hay guardados— y nada mas. El valor de un secreto no sale de
 * Vault: de los secretos viaja solo su nombre.
 *
 * Solo Owner/Admin. El guard rebota al dashboard y ademas la RLS de
 * integration_configs no le devuelve una sola fila a un Member.
 */
export default async function IntegrationsPage() {
  const { workspace, supabase } = await requireWorkspaceAdmin();
  const loaded = await loadIntegrations(supabase, workspace.id);

  return (
    <IntegrationsGrid
      integrations={loaded.integrations}
      webhookUrls={loaded.webhookUrls}
      youtubeVerifiedAt={loaded.youtubeVerifiedAt}
      metaAccounts={loaded.metaAccounts}
      metaIgUsername={loaded.metaIgUsername}
      channelsSummary={loaded.channelsSummary}
    />
  );
}
