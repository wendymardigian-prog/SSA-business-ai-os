/**
 * Arma los datos de cada card de Integraciones, para el listado y para el
 * detalle de un proveedor (G3, G5).
 *
 * Antes vivia adentro del `page.tsx` del listado y nunca le pasaba
 * `connection` ni `requiredScopes` a `integrationStatus()`: los caminos de
 * vencimiento de token y de scopes faltantes estaban escritos, testeados, y
 * no corrian nunca. Ahora se lee `oauth_connections` y se enchufan.
 *
 * `buildCardData` es pura (sin acceso a la base) y se testea sola; lo unico
 * que hace I/O es `loadIntegrations`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, OAuthProvider } from "@/lib/types/database";
import { listSecretNames, SECRET_NAMES } from "@/lib/vault";
import {
  PROVIDERS,
  configProviderOf,
  secretFieldsOf,
  type ProviderDefinition,
} from "./providers";
import { integrationStatus } from "./status";
import { buildUsage, type UsageSnapshot } from "./usage";
import { countIntegrationUsage } from "./usage-counts";
import { toConnectionRef, requiredScopesFor, type OAuthConnectionRow } from "./connection-ref";
import { getOAuthAdapter } from "@/lib/oauth/registry";
import { channelWebhookUrl } from "@/lib/webhook-url";
import { parsePublishers } from "@/lib/social/accounts-schema";
import { parseMetaConfig, type AdAccount } from "@/lib/meta/accounts";
import type { IntegrationCardData, OAuthConnectionSummary } from "@/components/settings/integrations/types";

type Db = SupabaseClient<Database>;

/** Una fila de `oauth_connections` del workspace (`user_id IS NULL`). */
export interface WorkspaceConnectionRow extends OAuthConnectionRow {
  provider: string;
  created_at: string;
  last_refreshed_at: string | null;
}

export interface ConfigRow {
  is_active: boolean;
  connected_at: string | null;
  last_error: string | null;
  updated_at: string | null;
}

export interface BuildCardDataParams {
  provider: ProviderDefinition;
  configRow: ConfigRow | null;
  config: Record<string, string>;
  storedSecretKeys: string[];
  /** Ya resuelto por quien llama: contempla el caso especial de Zernio (F5). */
  isActive: boolean;
  usage: UsageSnapshot | null;
  account: string | null;
  /** La conexion OAuth del workspace para este proveedor, si existe. */
  connectionRow: WorkspaceConnectionRow | null;
  /** Solo tiene sentido para `google` (G4). */
  calendarPeople?: number;
}

/**
 * Arma `IntegrationCardData` para un proveedor. Pura: no lee la base ni Vault,
 * todo lo que necesita ya se lo paso quien llama.
 */
export function buildCardData(params: BuildCardDataParams): IntegrationCardData {
  const { provider, configRow, connectionRow } = params;
  const adapter = getOAuthAdapter(provider.id);

  const connectionRef =
    connectionRow && adapter ? toConnectionRef(connectionRow, adapter) : null;

  const { status, reasons } = integrationStatus({
    config: params.isActive
      ? {
          is_active: true,
          last_error: configRow?.last_error ?? null,
          updated_at: configRow?.updated_at ?? null,
        }
      : null,
    connection: connectionRef,
    requiredScopes: requiredScopesFor(provider.id),
    usage: params.usage,
  });

  const oauth: OAuthConnectionSummary | null = connectionRow
    ? {
        tokenExpiresAt: connectionRow.token_expires_at,
        lastRefreshedAt: connectionRow.last_refreshed_at ?? null,
        grantedScopes: connectionRow.granted_scopes ?? [],
      }
    : null;

  const connectedAt = configRow?.connected_at ?? connectionRow?.created_at ?? null;

  const data: IntegrationCardData = {
    providerId: provider.id,
    status,
    reasons,
    account: params.account,
    usage: params.usage,
    storedSecretKeys: params.storedSecretKeys,
    config: params.config,
    connectedAt,
    oauth,
  };
  if (provider.id === "google") data.calendarPeople = params.calendarPeople ?? 0;
  return data;
}

export interface LoadedIntegrations {
  integrations: Record<string, IntegrationCardData>;
  webhookUrls: Record<string, string>;
  youtubeVerifiedAt: string | null;
  metaAccounts: AdAccount[];
  metaIgUsername: string | null;
  channelsSummary: Array<{ id: string; label: string; platform: string }>;
}

/** Los tres proveedores que se conectan por OAuth del WORKSPACE (no por persona). */
const WORKSPACE_OAUTH_PROVIDERS: readonly OAuthProvider[] = ["google", "linkedin", "threads"];

/**
 * Lee todo lo que hace falta para pintar el listado y el detalle de
 * Integraciones.
 *
 * Solo servidor: lee Vault (nombres de secretos, nunca valores) y
 * `oauth_connections` (Admin-only por RLS).
 */
export async function loadIntegrations(supabase: Db, workspaceId: string): Promise<LoadedIntegrations> {
  const [
    { data: configs },
    { data: channels },
    { data: youtubeAccount },
    { data: connections },
    { data: calendarConnections },
    secretNames,
    usageCounts,
  ] = await Promise.all([
    supabase
      .from("integration_configs")
      .select("type, provider, config, is_active, connected_at, last_error, updated_at")
      .eq("workspace_id", workspaceId),
    supabase
      .from("channels")
      .select("id, platform, username, display_name, is_active, provider")
      .eq("workspace_id", workspaceId),
    // Cuando se probo por ultima vez la subida directa a YouTube (F38).
    supabase
      .from("social_accounts")
      .select("publishers")
      .eq("workspace_id", workspaceId)
      .eq("platform", "youtube")
      .maybeSingle(),
    // Las conexiones OAuth del workspace (G3): una por proveedor, no por
    // persona. Google Calendar queda afuera: es per-user (G4, abajo).
    supabase
      .from("oauth_connections")
      .select(
        "provider, status, token_expires_at, refresh_expires_at, granted_scopes, last_error, last_refreshed_at, created_at",
      )
      .eq("workspace_id", workspaceId)
      .is("user_id", null)
      .in("provider", WORKSPACE_OAUTH_PROVIDERS),
    // Cuantas personas conectaron SU Google Calendar (G4). Revocada no cuenta.
    supabase
      .from("oauth_connections")
      .select("user_id")
      .eq("workspace_id", workspaceId)
      .eq("provider", "google_calendar")
      .not("status", "eq", "revoked")
      .not("user_id", "is", null),
    // Solo los nombres: el valor de un secret nunca sale del servidor.
    listSecretNames(supabase, workspaceId),
    countIntegrationUsage(supabase, workspaceId),
  ]);

  const storedSecrets = new Set(secretNames);
  const metaConfig = parseMetaConfig(
    (configs ?? []).find((c) => c.type === "meta" && c.provider === "meta")?.config,
  );
  const youtubePublishers = parsePublishers(youtubeAccount?.publishers ?? []);
  const youtubeVerifiedAt = youtubePublishers.ok
    ? (youtubePublishers.publishers.find((p) => p.publisher === "youtube_api")?.verified_at ?? null)
    : null;
  const activeChannels = (channels ?? []).filter((c) => c.is_active);
  const calendarPeople = new Set((calendarConnections ?? []).map((c) => c.user_id)).size;

  /** Que cuenta se muestra en la card. */
  function accountOf(provider: ProviderDefinition, config: Record<string, string>): string | null {
    if (provider.id === "zernio") {
      const names = activeChannels
        .filter((c) => c.provider === "zernio")
        .map((c) => (c.username ? `@${c.username}` : c.display_name || c.platform));
      return names.length > 0 ? names.join(", ") : null;
    }
    if (provider.id === "evolution") {
      const wa = activeChannels.find((c) => c.provider === "evolution");
      return wa ? wa.display_name || wa.username || "WhatsApp conectado" : null;
    }
    return config.from_email || config.inbound_address || config.default_model || null;
  }

  const integrations: Record<string, IntegrationCardData> = {};

  for (const provider of PROVIDERS) {
    const row = (configs ?? []).find(
      (c) => c.type === provider.type && c.provider === configProviderOf(provider),
    );
    const config = (row?.config ?? {}) as Record<string, string>;

    const storedKeys = secretFieldsOf(provider)
      .filter((field) => storedSecrets.has(field.secretName))
      .map((field) => field.key);

    // Zernio cuenta como conectada si su clave esta en Vault, aunque no
    // tenga fila en integration_configs: la fila la crea recien el dia que
    // alguien guarda la clave desde esta pantalla, y la conexion puede venir
    // de antes.
    const zernioConnected = provider.id === "zernio" && storedSecrets.has(SECRET_NAMES.zernioApiKey);
    const isActive = row?.is_active === true || zernioConnected;
    const usage = buildUsage(provider, usageCounts[provider.id] ?? 0);

    const connectionRow =
      (connections ?? []).find((c) => c.provider === provider.id) ?? null;

    integrations[provider.id] = buildCardData({
      provider,
      configRow: row
        ? {
            is_active: row.is_active,
            connected_at: row.connected_at,
            last_error: row.last_error,
            updated_at: row.updated_at,
          }
        : null,
      config,
      storedSecretKeys: storedKeys,
      isActive,
      usage,
      account: accountOf(provider, config),
      connectionRow: connectionRow as WorkspaceConnectionRow | null,
      calendarPeople,
    });
  }

  return {
    integrations,
    webhookUrls: webhookUrls(),
    youtubeVerifiedAt,
    metaAccounts: metaConfig.ad_accounts,
    metaIgUsername: metaConfig.ig_username,
    channelsSummary: activeChannels
      .filter((c) => c.provider === "zernio")
      .map((c) => ({ id: c.id, label: c.display_name || c.username || c.platform, platform: c.platform })),
  };
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
