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
import { getZernioKeyState } from "@/lib/integrations/zernio-key";
import { createZernioClient } from "@/lib/zernio-client";
import { platformLabel } from "@/lib/platforms";

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
  /** La fila (varias cuentas de la misma red, 00236). Sin pasar, se identifica por la red. */
  id?: string;
  is_active?: boolean | null;
  platform: SocialPlatform;
  default_publisher: string | null;
  publishers: unknown;
  /**
   * La identidad ya guardada. Hace falta cuando Zernio se desconecta: la cuenta
   * no se borra, queda "no disponible", y el upsert no puede pisar su usuario,
   * su nombre ni su canal con null.
   */
  external_id?: string | null;
  username?: string | null;
  display_name?: string | null;
  channel_id?: string | null;
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
  /**
   * Si hay clave de Zernio. `false` = se desconecto: las cuentas que salian por
   * Zernio quedan "no disponibles" (F74). Sin pasar = se asume conectado, que
   * es lo que hacia el codigo antes de este campo.
   */
  zernioConnected?: boolean;
  postproxyConnected: boolean;
  /** El perfil de YouTube dentro de Postproxy, si la prueba lo encontro (A11). */
  postproxyProfileId?: string | null;
  google: ConnectionSource | null;
  linkedin: ConnectionSource | null;
  threads: ConnectionSource | null;
  existing: ExistingAccount[];
}

export interface ComputedAccount {
  /** La fila que ya existia para esta cuenta, si hay: se actualiza esa y no se crea otra. */
  existingId?: string | null;
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

/**
 * La fila que ya existe para una cuenta. Por su `external_id`; si no hay (o no coincide) y la red tiene UNA sola
 * cuenta en cada lado, es la misma que se reconecto con otro id (lo que pasaba antes de las varias cuentas). Sin
 * `externalId` (YouTube, LinkedIn, Threads) se identifica por la red.
 */
function matchExisting(
  sources: AccountSources,
  platform: SocialPlatform,
  externalId: string | null,
  listedInPlatform = 1,
): ExistingAccount | undefined {
  const same = sources.existing.filter((e) => e.platform === platform);
  if (externalId === null) return same.find((e) => !e.external_id) ?? (same.length === 1 ? same[0] : undefined);
  const exact = same.find((e) => e.external_id === externalId);
  if (exact) return exact;
  if (listedInPlatform === 1 && same.length === 1) return same[0];
  return undefined;
}

/** Lo que se eligio a mano y lo que ya se habia verificado, para conservarlo. */
function previous(row: ExistingAccount | undefined) {
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
    data: Omit<ComputedAccount, "platform" | "publishers" | "defaultPublisher" | "defaultChanged" | "existingId">,
    row?: ExistingAccount,
  ) => {
    const before = previous(row);
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

    accounts.push({
      platform,
      publishers,
      defaultPublisher: publisher,
      defaultChanged: changed,
      existingId: row?.id ?? null,
      ...data,
    });
  };

  // ── Lo que llega por Zernio: Instagram y TikTok ──────────────────────────
  if (sources.zernioConnected === false) {
    // Sin clave no se publica ni se lee nada por Zernio. Antes la
    // sincronizacion no calculaba nada en este caso y la cuenta quedaba
    // "disponible" para siempre, asi que desconectar no se notaba en ningun
    // lado y programar seguia pareciendo posible. La cuenta NO se borra: se
    // marca y se conserva todo lo demas, para que reconectar la deje como
    // estaba.
    // Cada cuenta de Instagram y de TikTok (puede haber varias por red) queda marcada por separado.
    for (const row of sources.existing.filter((e) => e.platform === "instagram" || e.platform === "tiktok")) {
      const before = previous(row);
      const usedZernio =
        before.entries.some((e) => e.publisher === "zernio") || before.defaultPublisher === "zernio";
      if (!usedZernio) continue;

      finish(
        row.platform,
        [
          entry("zernio", "unavailable", {
            account_ref: before.entries.find((e) => e.publisher === "zernio")?.account_ref ?? null,
            status_reason: "Zernio no esta conectado. Pega la clave de nuevo en Integraciones.",
          }),
        ],
        {
          externalId: row.external_id ?? null,
          username: row.username ?? null,
          displayName: row.display_name ?? null,
          channelId: row.channel_id ?? null,
        },
        row,
      );
    }
  } else if (sources.zernioAccounts) {
    // Camino nuevo (F73): la lista que devuelve Zernio. Cada cuenta es una
    // fila; si además hay un canal de bandeja con ese mismo id, se enlaza.
    const listedByPlatform = new Map<string, number>();
    for (const a of sources.zernioAccounts) {
      if (a.isActive) listedByPlatform.set(a.platform, (listedByPlatform.get(a.platform) ?? 0) + 1);
    }
    const matchedIds = new Set<string>();

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

      const row = matchExisting(sources, platform, account._id, listedByPlatform.get(account.platform) ?? 1);
      if (row?.id) matchedIds.add(row.id);

      finish(
        platform,
        [entry("zernio", "available", { account_ref: account._id })],
        {
          externalId: account._id,
          username: account.username,
          displayName: account.displayName,
          // Solo Instagram tiene canal de bandeja; TikTok queda sin canal (F73).
          channelId: platform === "instagram" ? (channel?.id ?? null) : null,
          // El perfil viene de la misma lista: no se inventa nada que no traiga.
          avatarUrl: account.profilePicture,
          profileUrl: account.profileUrl,
          profileSynced: true,
        },
        row,
      );
    }

    // Una cuenta que Zernio ya no lista (la desconectaron de su lado) no se borra ni se pisa: queda "no disponible",
    // como cuando se desconecta Zernio entero, y reconectarla la deja como estaba.
    for (const row of sources.existing) {
      if (row.platform !== "instagram" && row.platform !== "tiktok") continue;
      if (!row.id || matchedIds.has(row.id)) continue;
      const before = previous(row);
      const usedZernio =
        before.entries.some((e) => e.publisher === "zernio") || before.defaultPublisher === "zernio";
      if (!usedZernio) continue;

      finish(
        row.platform,
        [
          entry("zernio", "unavailable", {
            account_ref: before.entries.find((e) => e.publisher === "zernio")?.account_ref ?? null,
            status_reason: "Esta cuenta ya no figura en Zernio. Volve a conectarla ahi.",
          }),
        ],
        {
          externalId: row.external_id ?? null,
          username: row.username ?? null,
          displayName: row.display_name ?? null,
          channelId: row.channel_id ?? null,
        },
        row,
      );
    }
  } else {
    // Respaldo: lo de siempre, armado desde los canales de la bandeja.
    for (const channel of sources.zernioChannels) {
      if (channel.platform !== "instagram" && channel.platform !== "tiktok") continue;
      const platform = channel.platform as SocialPlatform;

      const siblings = sources.zernioChannels.filter((c) => c.platform === channel.platform).length;
      finish(
        platform,
        [entry("zernio", "available", { account_ref: channel.late_account_id })],
        {
          externalId: channel.late_account_id,
          username: channel.username,
          displayName: channel.display_name,
          // Instagram ademas conversa: es la misma cuenta.
          channelId: channel.id,
        },
        matchExisting(sources, platform, channel.late_account_id, siblings),
      );
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
    const youtubeRow = sources.existing.find((e) => e.platform === "youtube");
    finish(
      "youtube",
      youtube,
      {
        externalId: sources.google?.external_account_id ?? null,
        // El @ lo escribe la lectura de metricas (lo trae la API del canal):
        // recalcular las cuentas no lo borra.
        username: youtubeRow?.username ?? null,
        displayName: sources.google?.account_label ?? "YouTube",
        channelId: null,
      },
      youtubeRow,
    );
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
      sources.existing.find((e) => e.platform === platform),
    );
  }

  return { accounts, warnings };
}

export interface SyncResult {
  accounts: ComputedAccount[];
  warnings: string[];
  /** Lo que Zernio informa sobre Analytics del plan (null si no se pudo leer). */
  zernioHasAnalytics: boolean | null;
  /**
   * Las cuentas que esta corrida conecto: una red que no estaba, o que estaba
   * desactivada. Son las que hay que leer ya, sin esperar al cron de las 3 AM.
   */
  newAccountIds: string[];
}

/**
 * Recalcula las cuentas sociales del workspace y las guarda.
 *
 * Se llama al conectar o desconectar algo. Es idempotente: correrla dos veces
 * deja lo mismo, porque cada cuenta se identifica por `(workspace, red, external_id)` (varias por red, 00236).
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
      .select("id, platform, default_publisher, publishers, external_id, username, display_name, channel_id, is_active")
      .eq("workspace_id", workspaceId),
  ]);

  // Lo que ya estaba activo antes de esta corrida: todo lo demas es nuevo.
  const activeBefore = new Set((existing.data ?? []).filter((row) => row.is_active).map((row) => row.id));
  const newAccountIds: string[] = [];

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
    zernioConnected: zernio.connected,
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

  const saveWarnings: string[] = [];
  for (const account of computed.accounts) {
    // Los datos de perfil se escriben solo si la fuente los entregó. Un campo
    // ausente no se pisa (undefined no viaja en el JSON) y no se inventa cero.
    const profile = {
      handle: account.username ?? undefined,
      avatar_url: account.avatarUrl ?? undefined,
      profile_url: account.profileUrl ?? undefined,
      profile_synced_at: account.profileSynced ? new Date().toISOString() : undefined,
    };
    const values = {
      external_id: account.externalId,
      username: account.username,
      display_name: account.displayName,
      channel_id: account.channelId,
      default_publisher: account.defaultPublisher,
      publishers: account.publishers as unknown as Database["public"]["Tables"]["social_accounts"]["Insert"]["publishers"],
      is_active: true,
      ...profile,
    };

    // Buscar-y-escribir y no `upsert`: con varias cuentas por red la identidad es (red, external_id) y esos indices
    // son PARCIALES (00236), que PostgREST no puede apuntar con un `on_conflict`. La fila ya la encontro
    // `computeAccounts` (`existingId`).
    const { data: saved, error } = account.existingId
      ? await supabase.from("social_accounts").update(values).eq("id", account.existingId).select("id").maybeSingle()
      : await supabase
          .from("social_accounts")
          .insert({ workspace_id: workspaceId, platform: account.platform, ...values })
          .select("id")
          .maybeSingle();

    if (error) {
      console.error(`[social] no pude guardar la cuenta de ${account.platform}:`, error.message);
      // Antes quedaba solo en el log y la pantalla decia que todo habia salido bien: la segunda cuenta de una red
      // no aparecia en ningun lado y nadie sabia por que.
      saveWarnings.push(saveFailureWarning(account, error));
    } else if (saved && !activeBefore.has(saved.id)) {
      newAccountIds.push(saved.id);
    }
  }

  // Con la cuenta ya creada, los comentarios que entraron antes (huerfanos) se
  // vinculan a su publicacion cuando esta existe (F76). Nunca lanza.
  for (const platform of new Set(computed.accounts.map((a) => a.platform))) {
    await adoptOrphanComments(supabase, workspaceId, platform);
  }

  const warnings = [...computed.warnings, ...saveWarnings, ...(zernio.warning ? [zernio.warning] : [])];
  return {
    accounts: computed.accounts,
    warnings,
    zernioHasAnalytics: zernio.hasAnalytics,
    newAccountIds,
  };
}

/**
 * El aviso cuando una cuenta no se pudo guardar, en palabras. Sin el error crudo de la base (puede traer valores).
 *
 * Un `23505` al CREAR una cuenta es casi siempre la base sin la 00236: el indice viejo `(workspace_id, platform)`
 * admite una sola cuenta por red, y la segunda Instagram choca contra la primera.
 */
export function saveFailureWarning(
  account: Pick<ComputedAccount, "platform" | "username" | "displayName" | "existingId">,
  error: { code?: string | null },
): string {
  const name = account.username ? `@${account.username}` : (account.displayName ?? "una cuenta");
  const red = platformLabel(account.platform);
  if (!account.existingId && error.code === "23505") {
    return `No pude guardar ${name} de ${red}: la base solo admite una cuenta por red. Falta aplicar la migración 00236 (varias cuentas por red).`;
  }
  return `No pude guardar ${name} de ${red}. Probá "Sincronizar cuentas" de nuevo en un rato.`;
}

/**
 * Lee de Zernio las cuentas de Instagram y TikTok. Nunca lanza: un error de red
 * o una clave ausente se devuelve como `warning` y el llamador sigue.
 */
async function readZernioAccounts(workspaceId: string): Promise<{
  accounts: ZernioAccountSource[] | null;
  /** Hay clave de Zernio guardada. Sin ella, Zernio esta desconectado. */
  connected: boolean;
  hasAnalytics: boolean | null;
  warning: string | null;
}> {
  try {
    const key = await getZernioKeyState(workspaceId);
    // Sin clave guardada: Zernio esta desconectado.
    if (key.state === "absent") return { accounts: null, connected: false, hasAnalytics: null, warning: null };
    // No pudimos mirar si la hay (Vault fallo): no se toca nada. Quedan las
    // cuentas como estaban y se avisa; desconectar por una falla de red seria
    // un susto y un Instagram que no programa hasta la proxima sincronizacion.
    if (key.state === "unknown") {
      return {
        accounts: null,
        connected: true,
        hasAnalytics: null,
        warning: "No pude verificar la conexion con Zernio. Quedan las cuentas como estaban; probá de nuevo en un rato.",
      };
    }

    const res = await createZernioClient(key.key).accounts.listAccounts();
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
      connected: true,
      hasAnalytics: res.data?.hasAnalyticsAccess ?? null,
      warning: null,
    };
  } catch (err) {
    const detalle = err instanceof Error ? err.message : String(err);
    console.error("[social] no pude leer las cuentas de Zernio:", detalle);
    // Hay clave pero Zernio no respondio: sigue conectado, solo que no se pudo
    // leer. Se usa el respaldo por canales y no se desactiva nada.
    return {
      accounts: null,
      connected: true,
      hasAnalytics: null,
      warning: "No pude leer las cuentas de Zernio. Quedan las últimas que se guardaron; probá de nuevo en un rato.",
    };
  }
}
