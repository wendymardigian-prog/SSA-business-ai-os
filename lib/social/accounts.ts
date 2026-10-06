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
import { adoptOrphanComments } from "@/lib/comments/adopt";
import { getZernioApiKey } from "@/lib/integrations/zernio-key";
import { createZernioClient } from "@/lib/zernio-client";

type Db = SupabaseClient<Database>;

/** Las redes que `social_accounts.platform` admite (ver el CHECK de 00082). */
const SOCIAL_PLATFORMS: SocialPlatform[] = ["instagram", "tiktok", "youtube", "linkedin", "threads"];

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

/**
 * Una cuenta que Zernio lista con su API (`accounts.listAccounts`, F73). Es la
 * fuente de verdad de Instagram y TikTok: TikTok no tiene canal de bandeja, así
 * que sin esta lista no hay forma de que exista.
 */
export interface ZernioAccountSource {
  _id: string;
  platform: string;
  username: string | null;
  displayName: string | null;
  isActive: boolean;
  /** Foto de perfil y link, si Zernio los trae (F75). */
  profilePicture: string | null;
  profileUrl: string | null;
}

export interface AccountSources {
  zernioChannels: ZernioChannelSource[];
  /**
   * Lo que Zernio dice de cada cuenta. `null` (o sin pasar) = no se pudo leer:
   * se usa `zernioChannels` como respaldo, que es lo que se hacía hasta hoy.
   */
  zernioAccounts?: ZernioAccountSource[] | null;
  postproxyConnected: boolean;
  /** El perfil de YouTube dentro de Postproxy, si la prueba lo encontro (A11). */
  postproxyProfileId?: string | null;
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
  /** Datos de perfil que la fuente entregó (F75). Ausente = no lo entregó. */
  avatarUrl?: string | null;
  profileUrl?: string | null;
  /** La lectura del perfil salió bien: se puede sellar `profile_synced_at`. */
  profileSynced?: boolean;
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
  if (sources.zernioAccounts) {
    // Camino nuevo (F73): la lista que devuelve Zernio. Cada cuenta es una
    // fila; si además hay un canal de bandeja con ese mismo id, se enlaza.
    for (const account of sources.zernioAccounts) {
      if (!account.isActive) continue;
      if (!SOCIAL_PLATFORMS.includes(account.platform as SocialPlatform)) {
        // Una red que social_accounts no admite se saltea con aviso, sin fallar (F73).
        warnings.push(`Zernio tiene una cuenta de "${account.platform}" que todavía no se puede usar acá.`);
        continue;
      }
      // YouTube, LinkedIn y Threads no salen por Zernio: se arman por sus propios caminos.
      if (account.platform !== "instagram" && account.platform !== "tiktok") continue;
      const platform = account.platform as SocialPlatform;
      const channel = sources.zernioChannels.find(
        (c) => c.late_account_id === account._id && c.platform === "instagram",
      );

      finish(platform, [entry("zernio", "available", { account_ref: account._id })], {
        externalId: account._id,
        username: account.username,
        displayName: account.displayName,
        // Solo Instagram tiene canal de bandeja; TikTok queda sin canal (F73).
        channelId: platform === "instagram" ? (channel?.id ?? null) : null,
        // El perfil viene de la misma lista: no se inventa nada que no traiga.
        avatarUrl: account.profilePicture,
        profileUrl: account.profileUrl,
        profileSynced: true,
      });
    }
  } else {
    // Respaldo: lo de siempre, armado desde los canales de la bandeja.
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
  }

  // ── YouTube: puede tener dos caminos a la vez ────────────────────────────
  const youtube: PublisherEntry[] = [];
  if (sources.postproxyConnected) {
    // Sin perfil no se puede publicar: Postproxy acepta el pedido y no lo
    // manda a ningun lado (A11).
    youtube.push(
      sources.postproxyProfileId
        ? entry("postproxy", "available", { account_ref: sources.postproxyProfileId })
        : entry("postproxy", "unavailable", {
            status_reason:
              "Postproxy no tiene ninguna cuenta de YouTube conectada. Conectala ahi y volve a guardar la clave.",
          }),
    );
  }

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
  /** Lo que Zernio informa sobre Analytics del plan (null si no se pudo leer). */
  zernioHasAnalytics: boolean | null;
}

/**
 * Recalcula las cuentas sociales del workspace y las guarda.
 *
 * Se llama al conectar o desconectar algo. Es idempotente: correrla dos veces
 * deja lo mismo, porque escribe por `(workspace, red)`.
 */
export async function syncSocialAccounts(supabase: Db, workspaceId: string): Promise<SyncResult> {
  // Lo que dice Zernio de sus cuentas (F73). Si no hay clave o la llamada
  // falla, no se borra nada: se avisa y queda el respaldo por canales.
  const zernio = await readZernioAccounts(workspaceId);

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
      .select("provider, is_active, config")
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
    zernioAccounts: zernio.accounts,
    postproxyConnected: (integrations.data ?? []).some(
      (i) => i.provider === "postproxy" && i.is_active,
    ),
    postproxyProfileId:
      ((integrations.data ?? []).find((i) => i.provider === "postproxy" && i.is_active)?.config as
        | { youtube_profile_id?: string }
        | null
        | undefined)?.youtube_profile_id ?? null,
    google: connectionOf("google"),
    linkedin: connectionOf("linkedin"),
    threads: connectionOf("threads"),
    existing: (existing.data ?? []) as ExistingAccount[],
  });

  for (const account of computed.accounts) {
    // Los datos de perfil se escriben solo si la fuente los entregó. Un campo
    // ausente no se pisa (undefined no viaja en el JSON) y no se inventa cero.
    const profile = {
      handle: account.username ?? undefined,
      avatar_url: account.avatarUrl ?? undefined,
      profile_url: account.profileUrl ?? undefined,
      profile_synced_at: account.profileSynced ? new Date().toISOString() : undefined,
    };
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
        ...profile,
      },
      { onConflict: "workspace_id,platform" },
    );

    if (error) {
      console.error(`[social] no pude guardar la cuenta de ${account.platform}:`, error.message);
    }
  }

  // Con la cuenta ya creada, los comentarios que entraron antes (huerfanos) se
  // vinculan a su publicacion cuando esta existe (F76). Nunca lanza.
  for (const account of computed.accounts) {
    await adoptOrphanComments(supabase, workspaceId, account.platform);
  }

  const warnings = [...computed.warnings, ...(zernio.warning ? [zernio.warning] : [])];
  return { accounts: computed.accounts, warnings, zernioHasAnalytics: zernio.hasAnalytics };
}

/**
 * Lee de Zernio las cuentas de Instagram y TikTok. Nunca lanza: un error de red
 * o una clave ausente se devuelve como `warning` y el llamador sigue.
 */
async function readZernioAccounts(workspaceId: string): Promise<{
  accounts: ZernioAccountSource[] | null;
  hasAnalytics: boolean | null;
  warning: string | null;
}> {
  try {
    const apiKey = await getZernioApiKey(workspaceId);
    if (!apiKey) return { accounts: null, hasAnalytics: null, warning: null };

    const res = await createZernioClient(apiKey).accounts.listAccounts();
    // El SDK tipa la respuesta; la anotación evita depender de la inferencia.
    const raw: Array<{
      _id: string;
      platform: string;
      username?: string | null;
      displayName?: string | null;
      isActive?: boolean;
      profilePicture?: string | null;
      profileUrl?: string | null;
    }> = res.data?.accounts ?? [];
    const accounts: ZernioAccountSource[] = raw.map((a) => ({
      _id: a._id,
      platform: a.platform,
      username: a.username ?? null,
      displayName: a.displayName ?? null,
      isActive: a.isActive !== false,
      profilePicture: a.profilePicture ?? null,
      profileUrl: a.profileUrl ?? null,
    }));
    return {
      accounts,
      hasAnalytics: res.data?.hasAnalyticsAccess ?? null,
      warning: null,
    };
  } catch (err) {
    const detalle = err instanceof Error ? err.message : String(err);
    console.error("[social] no pude leer las cuentas de Zernio:", detalle);
    return {
      accounts: null,
      hasAnalytics: null,
      warning: "No pude leer las cuentas de Zernio. Quedan las últimas que se guardaron; probá de nuevo en un rato.",
    };
  }
}
