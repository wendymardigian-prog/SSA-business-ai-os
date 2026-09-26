/**
 * Que cuentas sociales tiene el workspace y por donde puede publicar en cada
 * una (F13).
 *
 * Es una funcion de sincronizacion y no una tabla que alguien edita: lo que
 * hay disponible se DERIVA de lo que esta conectado. Si se desconecta
 * Postproxy, YouTube deja de tener ese camino sin que nadie tenga que acordarse
 * de destildar nada.
 *
 * El nucleo (`computeAccounts`) es puro: recibe lo conectado y devuelve como
 * deberian quedar las cuentas. `syncSocialAccounts` lee la base, lo llama y
 * guarda. Asi la parte que decide se prueba sin base.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, SocialPlatform } from "@/lib/types/database";
import {
  parsePublishers,
  resolveDefaultPublisher,
  type PublisherEntry,
  type PublisherId,
} from "./accounts-schema";
import { canUploadToYouTube } from "./google";

type Db = SupabaseClient<Database>;

/** Un canal de la bandeja conectado por Zernio. */
export interface ZernioChannelSource {
  id: string;
  platform: string;
  late_account_id: string;
  username: string | null;
  display_name: string | null;
}

/** Una conexion OAuth, en lo que le importa a esto. */
export interface ConnectionSource {
  status: string;
  granted_scopes: string[];
  external_account_id: string | null;
  account_label: string | null;
}

/** Lo que ya esta guardado, para no perder lo que se eligio a mano. */
export interface ExistingAccount {
  platform: SocialPlatform;
  default_publisher: string | null;
  publishers: unknown;
}

export interface AccountSources {
  zernioChannels: ZernioChannelSource[];
  postproxyConnected: boolean;
  google: ConnectionSource | null;
  linkedin: ConnectionSource | null;
  threads: ConnectionSource | null;
  existing: ExistingAccount[];
}

export interface ComputedAccount {
  platform: SocialPlatform;
  externalId: string | null;
  username: string | null;
  displayName: string | null;
  channelId: string | null;
  publishers: PublisherEntry[];
  defaultPublisher: PublisherId | null;
  /** El publicador por defecto cambio solo: hay que avisar. */
  defaultChanged: boolean;
}

export interface ComputedAccounts {
  accounts: ComputedAccount[];
  /** Cosas que la persona tiene que saber, en palabras. */
  warnings: string[];
}

const entry = (
  publisher: PublisherId,
  status: PublisherEntry["status"],
  extra: Partial<PublisherEntry> = {},
): PublisherEntry => ({
  publisher,
  account_ref: null,
  status,
  status_reason: null,
  verified_at: null,
  manually_enabled: false,
  ...extra,
});

/** Lo que se eligio a mano y lo que ya se habia verificado, para conservarlo. */
function previous(sources: AccountSources, platform: SocialPlatform) {
  const row = sources.existing.find((e) => e.platform === platform);
  const parsed = row ? parsePublishers(row.publishers) : null;
  return {
    defaultPublisher: row?.default_publisher ?? null,
    entries: parsed?.ok ? parsed.publishers : [],
  };
}

/** Conserva `verified_at` y `manually_enabled`, que son decisiones y no estado. */
function keepDecisions(fresh: PublisherEntry[], old: PublisherEntry[]): PublisherEntry[] {
  return fresh.map((e) => {
    const before = old.find((o) => o.publisher === e.publisher);
    if (!before) return e;
    return {
      ...e,
      verified_at: e.verified_at ?? before.verified_at,
      manually_enabled: e.manually_enabled || before.manually_enabled,
    };
  });
}

export function computeAccounts(sources: AccountSources): ComputedAccounts {
  const accounts: ComputedAccount[] = [];
  const warnings: string[] = [];

  const finish = (
    platform: SocialPlatform,
    fresh: PublisherEntry[],
    data: Omit<ComputedAccount, "platform" | "publishers" | "defaultPublisher" | "defaultChanged">,
  ) => {
    const before = previous(sources, platform);
    const publishers = keepDecisions(fresh, before.entries);
    const { publisher, changed } = resolveDefaultPublisher(publishers, before.defaultPublisher);

    // Solo se avisa si ANTES habia uno elegido y dejo de servir. La primera
    // vez tambien "cambia", pero no hay nada que avisar.
    if (changed && before.defaultPublisher) {
      warnings.push(
        publisher
          ? `En ${platform} se dejo de poder publicar por ${before.defaultPublisher}: ahora sale por ${publisher}.`
          : `En ${platform} ya no queda por donde publicar: revisa la conexion.`,
      );
    }

    accounts.push({ platform, publishers, defaultPublisher: publisher, defaultChanged: changed, ...data });
  };

  // ── Lo que llega por Zernio: Instagram y TikTok ──────────────────────────
  for (const channel of sources.zernioChannels) {
    if (channel.platform !== "instagram" && channel.platform !== "tiktok") continue;
    const platform = channel.platform as SocialPlatform;

    finish(platform, [entry("zernio", "available", { account_ref: channel.late_account_id })], {
      externalId: channel.late_account_id,
      username: channel.username,
      displayName: channel.display_name,
      // Instagram ademas conversa: es la misma cuenta.
      channelId: channel.id,
    });
  }

  // ── YouTube: puede tener dos caminos a la vez ────────────────────────────
  const youtube: PublisherEntry[] = [];
  if (sources.postproxyConnected) youtube.push(entry("postproxy", "available"));

  if (sources.google) {
    const upload = canUploadToYouTube(sources.google.granted_scopes);
    if (!upload.ok) {
      youtube.push(entry("youtube_api", "unavailable", { status_reason: upload.reason ?? null }));
    } else if (sources.google.status !== "active") {
      youtube.push(
        entry("youtube_api", "unavailable", {
          status_reason: "La conexion con Google necesita atencion.",
        }),
      );
    } else {
      // "unverified" y no "available": subir con la API oficial puede dejar el
      // video en privado hasta que Google audite la app, y eso se sabe recien
      // al probarlo (F38).
      youtube.push(
        entry("youtube_api", "unverified", {
          account_ref: sources.google.external_account_id,
          status_reason: "Todavia no se probo una publicacion directa.",
        }),
      );
    }
  }

  if (youtube.length > 0) {
    finish("youtube", youtube, {
      externalId: sources.google?.external_account_id ?? null,
      username: null,
      displayName: sources.google?.account_label ?? "YouTube",
      channelId: null,
    });
  }

  // ── LinkedIn y Threads: un solo camino, el suyo ──────────────────────────
  for (const [platform, connection, publisher] of [
    ["linkedin", sources.linkedin, "linkedin_api"],
    ["threads", sources.threads, "threads_api"],
  ] as const) {
    if (!connection) continue;
    const roto = connection.status === "revoked" || connection.status === "error";
    finish(
      platform,
      [
        entry(publisher, roto ? "unavailable" : "available", {
          account_ref: connection.external_account_id,
          status_reason: roto ? "Hay que volver a conectar la cuenta." : null,
        }),
      ],
      {
        externalId: connection.external_account_id,
        username: null,
        displayName: connection.account_label,
        channelId: null,
      },
    );
  }

  return { accounts, warnings };
}

export interface SyncResult {
  accounts: ComputedAccount[];
  warnings: string[];
}

/**
 * Recalcula las cuentas sociales del workspace y las guarda.
 *
 * Se llama al conectar o desconectar algo. Es idempotente: correrla dos veces
 * deja lo mismo, porque escribe por `(workspace, red)`.
 */
export async function syncSocialAccounts(supabase: Db, workspaceId: string): Promise<SyncResult> {
  const [channels, connections, integrations, existing] = await Promise.all([
    supabase
      .from("channels")
      .select("id, platform, late_account_id, username, display_name")
      .eq("workspace_id", workspaceId)
      .eq("provider", "zernio")
      .eq("is_active", true),
    supabase
      .from("oauth_connections")
      .select("provider, status, granted_scopes, external_account_id, account_label")
      .eq("workspace_id", workspaceId)
      .is("user_id", null),
    supabase
      .from("integration_configs")
      .select("provider, is_active")
      .eq("workspace_id", workspaceId)
      .eq("type", "publishing_service"),
    supabase
      .from("social_accounts")
      .select("platform, default_publisher, publishers")
      .eq("workspace_id", workspaceId),
  ]);

  const connectionOf = (provider: string): ConnectionSource | null => {
    const row = (connections.data ?? []).find((c) => c.provider === provider);
    if (!row) return null;
    return {
      status: row.status,
      granted_scopes: row.granted_scopes ?? [],
      external_account_id: row.external_account_id,
      account_label: row.account_label,
    };
  };

  const computed = computeAccounts({
    zernioChannels: (channels.data ?? []) as ZernioChannelSource[],
    postproxyConnected: (integrations.data ?? []).some(
      (i) => i.provider === "postproxy" && i.is_active,
    ),
    google: connectionOf("google"),
    linkedin: connectionOf("linkedin"),
    threads: connectionOf("threads"),
    existing: (existing.data ?? []) as ExistingAccount[],
  });

  for (const account of computed.accounts) {
    const { error } = await supabase.from("social_accounts").upsert(
      {
        workspace_id: workspaceId,
        platform: account.platform,
        external_id: account.externalId,
        username: account.username,
        display_name: account.displayName,
        channel_id: account.channelId,
        default_publisher: account.defaultPublisher,
        publishers: account.publishers as unknown as Database["public"]["Tables"]["social_accounts"]["Insert"]["publishers"],
        is_active: true,
      },
      { onConflict: "workspace_id,platform" },
    );

    if (error) {
      console.error(`[social] no pude guardar la cuenta de ${account.platform}:`, error.message);
    }
  }

  return { accounts: computed.accounts, warnings: computed.warnings };
}
