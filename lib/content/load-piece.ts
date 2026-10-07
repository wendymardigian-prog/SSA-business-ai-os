/**
 * Lee TODO lo que el drawer de la pieza necesita, de una vez (F96).
 *
 * Es lo que antes hacia la pagina del editor (`/content/[id]/edit`) y la del
 * detalle (`/content/[id]`): la pieza, sus publicaciones, las redes conectadas,
 * las automatizaciones por palabra clave y el historial. Vive aca para que la
 * lea el tablero cuando la URL trae `?piece=<id>`, y para que haya UN solo
 * lugar donde se arme (dos pantallas que arman lo mismo terminan mostrando
 * cosas distintas).
 *
 * Devuelve null si la pieza no existe o no es de este workspace: quien llama
 * decide si eso es un 404 (las rutas viejas) o un aviso (el tablero).
 */

import type { PermissionContext } from "@/lib/auth/guards";
import { listConnectedAiProviders } from "@/lib/ai/provider";
import { getWorkspaceMembers, memberLabels } from "@/lib/workspace-members";
import { loadPieceMeasurement } from "@/lib/dashboards/piece-load";
import type { PiecePerformance } from "@/lib/dashboards/piece-performance";
import type { ContentPostStatus } from "@/lib/types/database";
import { connectedPlatforms } from "./connection";
import { authorshipLine } from "./classification";
import type { PublicationSummary } from "./detail";
import type { EditorPermissions } from "./editor";
import type { AutomationRule } from "./keywords";
import { loadContentTaxonomy, type ContentTaxonomy } from "./load-taxonomy";
import type { MediaEntry } from "./media";
import type { NetworkEntry } from "./redistribution";
import type { StoredVersion } from "./versions";

export interface PiecePost {
  id: string;
  title: string;
  format: string | null;
  /** De que idea salio, para poder volver a mirarla (C12). */
  idea: { id: string; title: string; content: string | null } | null;
  /** Si el copywriter esta escribiendo esta pieza ahora (E6). */
  copyStatus: "idle" | "generating" | "failed";
  /** El guion completo para grabar (F90). */
  script: string | null;
  recordingNotes: string | null;
  pillarId: string | null;
  offerId: string | null;
  funnelStage: string | null;
  reference: string | null;
  /** "Ana · creada el 3 oct · editada el 5 oct" (F91). */
  authorship: string | null;
  caption: string | null;
  networks: NetworkEntry[];
  media: MediaEntry[];
  status: ContentPostStatus;
  aiUnreviewed: boolean;
  /** El comentario con el que la devolvieron, si la devolvieron. */
  reviewNote: string | null;
  updatedAt: string;
}

export interface PieceData {
  post: PiecePost;
  perms: EditorPermissions;
  publications: PublicationSummary[];
  /** Las redes conectadas del negocio. */
  connected: string[];
  automations: AutomationRule[];
  channelIdByPlatform: Record<string, string | null>;
  /** Por donde puede salir cada red (C10: solo informativo, no se elige por pieza). */
  publishersByPlatform: Record<string, string[]>;
  /** El publicador real de cada cuenta, el que usa el despachador (F13). */
  defaultPublisherByPlatform: Record<string, string | null>;
  versions: StoredVersion[];
  authorNames: Record<string, string>;
  aiAvailable: boolean;
  timeZone: string;
  taxonomy: ContentTaxonomy;
  /** Como le fue a cada publicacion (F102). Null si todavia no salio ninguna. */
  measurement: PiecePerformance | null;
}

export async function loadPiece(ctx: PermissionContext, postId: string): Promise<PieceData | null> {
  const { workspace, user, supabase, can } = ctx;
  const canUseAi = can("content.ai");
  // La zona del NEGOCIO: la misma que usa el editor para agendar (A19,
  // lib/dates.ts) y el tope diario server-side (lib/publishing/schedule-core.ts).
  const timeZone = workspace.timezone || "UTC";

  const { data: post } = await supabase
    .from("content_posts")
    .select(
      "id, title, format, script, recording_notes, caption, networks, media, status, ai_unreviewed, review_note, created_by, created_at, updated_at, copy_status, idea_id, pillar_id, offer_id, funnel_stage, reference",
    )
    .eq("id", postId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();

  if (!post) return null;

  const [
    publicationsRes,
    accountsRes,
    channelsRes,
    triggersRes,
    versionsRes,
    aiProviders,
    members,
    taxonomy,
    ideaRes,
    measurement,
  ] =
    await Promise.all([
      supabase
        .from("social_posts")
        .select(
          "platform, status, scheduled_at, published_at, url, origin, last_error, last_error_kind, attempts, warning, actual_visibility",
        )
        .eq("content_post_id", postId)
        .is("deleted_at", null)
        .order("platform"),
      supabase
        .from("social_accounts")
        .select("platform, channel_id, username, display_name, publishers, default_publisher")
        .eq("workspace_id", workspace.id)
        .eq("is_active", true),
      supabase
        .from("channels")
        .select("id, platform")
        .eq("workspace_id", workspace.id)
        .eq("is_active", true),
      // Las automatizaciones por palabra clave, para decir si el CTA tiene
      // quien lo conteste (F27).
      supabase
        .from("triggers")
        .select("id, type, config, is_active, channel_id, flows(id, name)")
        .eq("workspace_id", workspace.id)
        .in("type", ["keyword", "comment_keyword"]),
      supabase
        .from("content_post_versions")
        .select("id, version_no, snapshot, author_kind, author_id, reason, created_at")
        .eq("post_id", postId)
        .order("version_no", { ascending: false })
        .limit(50),
      canUseAi ? listConnectedAiProviders(workspace.id) : Promise.resolve([]),
      getWorkspaceMembers(workspace.id),
      loadContentTaxonomy(supabase, workspace.id, can("settings.manage")),
      // La idea de la que salio: el chip para volver a abrirla y su texto, que
      // es contexto para quien escribe el guion (F90).
      post.idea_id
        ? supabase
            .from("content_ideas")
            .select("id, title, content")
            .eq("id", post.idea_id)
            .eq("workspace_id", workspace.id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      // El rendimiento por red (F102): lo lee con el cliente de quien mira.
      loadPieceMeasurement(supabase, { workspaceId: workspace.id, pieceId: postId }),
    ]);

  // Las plataformas de `channels` y las de `social_accounts` no son el mismo
  // conjunto (una tiene whatsapp, la otra youtube), asi que el mapa es por
  // texto y no por tipo.
  const channelByPlatform = new Map<string, string>(
    (channelsRes.data ?? []).map((c) => [c.platform as string, c.id]),
  );

  const automations: AutomationRule[] = (triggersRes.data ?? []).map((row) => {
    const config = (row.config ?? {}) as {
      keywords?: Array<string | { value: string; matchType?: string }>;
      matchType?: string;
      postIds?: string[];
    };
    const flow = row.flows as { id: string; name: string } | null;

    return {
      triggerId: row.id,
      flowId: flow?.id ?? "",
      flowName: flow?.name ?? "Automatizacion",
      type: row.type,
      isActive: row.is_active,
      channelIds: row.channel_id ? [row.channel_id] : [],
      keywords: (config.keywords ?? []).map((kw) =>
        typeof kw === "string"
          ? { value: kw, matchType: config.matchType }
          : { value: kw.value, matchType: kw.matchType ?? config.matchType },
      ),
      postIds: config.postIds ?? [],
    };
  });

  // Por donde puede salir cada red: llena "Publicar por" (C8).
  const publishersByPlatform: Record<string, string[]> = {};
  for (const account of accountsRes.data ?? []) {
    const entries = (Array.isArray(account.publishers) ? account.publishers : []) as Array<{
      publisher?: string;
      status?: string;
    }>;
    publishersByPlatform[account.platform as string] = entries
      .filter((e) => e.publisher && e.status !== "unavailable")
      .map((e) => e.publisher as string);
  }

  const labels = memberLabels(members);
  const idea = ideaRes.data as { id: string; title: string; content: string | null } | null;

  return {
    post: {
      id: post.id,
      title: post.title,
      format: post.format,
      idea: idea ? { id: idea.id, title: idea.title, content: idea.content } : null,
      copyStatus: post.copy_status,
      script: post.script,
      recordingNotes: post.recording_notes,
      pillarId: post.pillar_id,
      offerId: post.offer_id,
      funnelStage: post.funnel_stage,
      reference: post.reference,
      authorship: authorshipLine({
        authorName: post.created_by ? (labels.get(post.created_by) ?? null) : null,
        createdAt: post.created_at,
        updatedAt: post.updated_at,
        timeZone,
      }),
      caption: post.caption,
      networks: (Array.isArray(post.networks) ? post.networks : []) as unknown as NetworkEntry[],
      media: (Array.isArray(post.media) ? post.media : []) as unknown as MediaEntry[],
      status: post.status,
      aiUnreviewed: post.ai_unreviewed,
      reviewNote: post.review_note,
      updatedAt: post.updated_at,
    },
    perms: {
      create: true,
      approve: can("content.approve"),
      publish: can("content.publish"),
      ai: canUseAi,
      isAuthor: post.created_by === user.id,
    },
    publications: (publicationsRes.data ?? []).map((p) => ({
      platform: p.platform,
      status: p.status,
      scheduledAt: p.scheduled_at,
      publishedAt: p.published_at,
      origin: p.origin,
      url: p.url,
      lastError: p.last_error,
      lastErrorKind: p.last_error_kind,
      attempts: p.attempts ?? 0,
      warning: p.warning,
      actualVisibility: p.actual_visibility,
    })),
    // Conectada = cuenta activa CON publicador usable (Contenido v4, C1): la
    // consulta ya filtra is_active, pero desconectar Zernio deja la cuenta
    // activa sin publicador, y esa red no esta conectada para nada.
    connected: connectedPlatforms(
      (accountsRes.data ?? []).map((a) => ({
        platform: a.platform as string,
        is_active: true,
        default_publisher: a.default_publisher as string | null,
      })),
    ),
    automations,
    channelIdByPlatform: Object.fromEntries(
      (accountsRes.data ?? []).map((a) => [
        a.platform,
        a.channel_id ?? channelByPlatform.get(a.platform as string) ?? null,
      ]),
    ),
    publishersByPlatform,
    defaultPublisherByPlatform: Object.fromEntries(
      (accountsRes.data ?? []).map((a) => [a.platform as string, (a.default_publisher as string | null) ?? null]),
    ),
    versions: (versionsRes.data ?? []) as unknown as StoredVersion[],
    authorNames: Object.fromEntries(labels),
    aiAvailable: aiProviders.length > 0,
    timeZone,
    taxonomy,
    measurement,
  };
}
