import { requireWorkspaceAdmin } from "@/lib/auth/guards";
import { IntegrationsView } from "@/components/settings/integrations-view";
import { listSecretNames } from "@/lib/vault";
import { PROVIDERS } from "@/lib/integrations/providers";

/**
 * Configuracion de integraciones: email saliente y proveedores de IA (BYOK).
 *
 * Los canales de mensajeria siguen viviendo en /dashboard/channels, que tiene
 * su propio flujo (QR de WhatsApp, sync de Zernio). Aca se muestra un resumen
 * y un link, para no partir la experiencia en dos pantallas que hacen lo mismo.
 *
 * Solo Owner/Admin. El guard rebota al dashboard y ademas la RLS de
 * integration_configs no le devuelve una sola fila a un Member.
 */
export default async function IntegrationsPage() {
  const { workspace, supabase } = await requireWorkspaceAdmin();

  const [{ data: configs }, { data: channels }, secretNames] = await Promise.all([
    supabase
      .from("integration_configs")
      .select("type, provider, config, is_active, connected_at, last_error, vault_secret_name")
      .eq("workspace_id", workspace.id),
    supabase
      .from("channels")
      .select("id, platform, username, display_name, is_active, connection_status")
      .eq("workspace_id", workspace.id),
    // Solo los nombres: el valor de un secret nunca sale del servidor.
    listSecretNames(supabase, workspace.id),
  ]);

  const storedSecrets = new Set(secretNames);

  const integrations = PROVIDERS.map((provider) => {
    const row = (configs ?? []).find(
      (c) => c.type === provider.type && c.provider === provider.id,
    );
    return {
      providerId: provider.id,
      isActive: row?.is_active === true,
      connectedAt: row?.connected_at ?? null,
      lastError: row?.last_error ?? null,
      config: (row?.config ?? {}) as Record<string, string>,
      // "Hay una key guardada": se sabe por el nombre, nunca por el valor.
      hasSecret: provider.secretName ? storedSecrets.has(provider.secretName) : false,
    };
  });

  return (
    <IntegrationsView
      integrations={integrations}
      channels={(channels ?? []).map((c) => ({
        id: c.id,
        platform: c.platform,
        label: c.display_name || c.username || c.platform,
        isActive: c.is_active,
        connectionStatus: c.connection_status,
      }))}
    />
  );
}
