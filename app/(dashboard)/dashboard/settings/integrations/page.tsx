import { requireWorkspaceAdmin } from "@/lib/auth/guards";
import { IntegrationsGrid } from "@/components/settings/integrations/integrations-grid";
import type { IntegrationCardData } from "@/components/settings/integrations/types";
import { listSecretNames, SECRET_NAMES } from "@/lib/vault";
import {
  PROVIDERS,
  configProviderOf,
  secretFieldsOf,
  type ProviderDefinition,
} from "@/lib/integrations/providers";
import { integrationStatus } from "@/lib/integrations/status";
import { buildUsage } from "@/lib/integrations/usage";
import { countIntegrationUsage } from "@/lib/integrations/usage-counts";
import { channelWebhookUrl } from "@/lib/webhook-url";
import { parsePublishers } from "@/lib/social/accounts-schema";
import { parseMetaConfig } from "@/lib/meta/accounts";

/**
 * Integraciones: todo lo que el sistema conecta con afuera, en una pantalla.
 *
 * El servidor arma lo que cada card necesita —estado, cuenta conectada, barra
 * de uso y QUE secretos hay guardados— y nada mas. El valor de un secreto no
 * sale de Vault: de los secretos viaja solo su nombre.
 *
 * Solo Owner/Admin. El guard rebota al dashboard y ademas la RLS de
 * integration_configs no le devuelve una sola fila a un Member.
 */
export default async function IntegrationsPage() {
  const { workspace, supabase } = await requireWorkspaceAdmin();

  const [
    { data: configs },
    { data: channels },
    { data: youtubeAccount },
    secretNames,
    usageCounts,
  ] = await Promise.all([
    supabase
      .from("integration_configs")
      .select(
        "type, provider, config, is_active, connected_at, last_error, updated_at",
      )
      .eq("workspace_id", workspace.id),
    supabase
      .from("channels")
      .select("id, platform, username, display_name, is_active, provider")
      .eq("workspace_id", workspace.id),
    // Cuando se probo por ultima vez la subida directa a YouTube (F38).
    supabase
      .from("social_accounts")
      .select("publishers")
      .eq("workspace_id", workspace.id)
      .eq("platform", "youtube")
      .maybeSingle(),
    // Solo los nombres: el valor de un secret nunca sale del servidor.
    listSecretNames(supabase, workspace.id),
    countIntegrationUsage(supabase, workspace.id),
  ]);

  const storedSecrets = new Set(secretNames);

  const metaConfig = parseMetaConfig(
    (configs ?? []).find((c) => c.type === "meta" && c.provider === "meta")?.config,
  );

  const youtubePublishers = parsePublishers(youtubeAccount?.publishers ?? []);
  const youtubeVerifiedAt = youtubePublishers.ok
    ? (youtubePublishers.publishers.find((p) => p.publisher === "youtube_api")
        ?.verified_at ?? null)
    : null;
  const activeChannels = (channels ?? []).filter((c) => c.is_active);

  /** Que cuenta se muestra en la card. */
  function accountOf(
    provider: ProviderDefinition,
    config: Record<string, string>,
  ): string | null {
    if (provider.id === "zernio") {
      const names = activeChannels
        .filter((c) => c.provider === "zernio")
        .map((c) =>
          c.username ? `@${c.username}` : c.display_name || c.platform,
        );
      return names.length > 0 ? names.join(", ") : null;
    }
    if (provider.id === "evolution") {
      const wa = activeChannels.find((c) => c.provider === "evolution");
      return wa ? wa.display_name || wa.username || "WhatsApp conectado" : null;
    }
    return (
      config.from_email ||
      config.inbound_address ||
      config.default_model ||
      null
    );
  }

  const integrations: Record<string, IntegrationCardData> = {};

  for (const provider of PROVIDERS) {
    const row = (configs ?? []).find(
      (c) =>
        c.type === provider.type && c.provider === configProviderOf(provider),
    );
    const config = (row?.config ?? {}) as Record<string, string>;

    const storedKeys = secretFieldsOf(provider)
      .filter((field) => storedSecrets.has(field.secretName))
      .map((field) => field.key);

    // Zernio cuenta como conectada si su clave esta en Vault, aunque no
    // tenga fila en integration_configs: la fila la crea recien el dia que
    // alguien guarda la clave desde esta pantalla, y la conexion puede venir
    // de antes.
    const zernioConnected =
      provider.id === "zernio" && storedSecrets.has(SECRET_NAMES.zernioApiKey);

    const isActive = row?.is_active === true || zernioConnected;
    const usage = buildUsage(provider, usageCounts[provider.id] ?? 0);

    const { status, reasons } = integrationStatus({
      config: isActive
        ? {
            is_active: true,
            last_error: row?.last_error ?? null,
            updated_at: row?.updated_at ?? null,
          }
        : null,
      usage,
    });

    integrations[provider.id] = {
      providerId: provider.id,
      status,
      // El aviso de "la clave todavia no esta en Vault" se fue con la 00090:
      // ya no hay otro lugar donde pueda estar.
      reasons,
      account: accountOf(provider, config),
      usage,
      storedSecretKeys: storedKeys,
      config,
    };
  }

  return (
    <IntegrationsGrid
      integrations={integrations}
      webhookUrls={webhookUrls()}
      youtubeVerifiedAt={youtubeVerifiedAt}
      metaAccounts={metaConfig.ad_accounts}
      metaIgUsername={metaConfig.ig_username}
      // Ya no hay secretos en columnas viejas: la 00090 las borro.
      zernioLegacySecrets={false}
      channelsSummary={activeChannels
        .filter((c) => c.provider === "zernio")
        .map((c) => ({
          id: c.id,
          label: c.display_name || c.username || c.platform,
          platform: c.platform,
        }))}
    />
  );
}

/**
 * Las direcciones que hay que pegar en cada proveedor.
 *
 * `channelWebhookUrl` lanza si NEXT_PUBLIC_APP_URL apunta a localhost: en
 * desarrollo no hay una direccion util que copiar, y mostrar una que no sirve
 * es peor que no mostrar ninguna.
 */
function webhookUrls(): Record<string, string> {
  const urls: Record<string, string> = {};
  for (const [id, channel] of [
    ["zernio", "zernio"],
    ["evolution", "evolution"],
  ] as const) {
    try {
      urls[id] = channelWebhookUrl(channel);
    } catch {
      // Sin dominio publico configurado no hay URL que copiar.
    }
  }
  return urls;
}
