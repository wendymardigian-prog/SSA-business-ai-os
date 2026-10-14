"use server";

import { revalidatePath } from "next/cache";
import { getPermissionAction } from "@/lib/auth/guards";
import { logAudit, type AuditChanges } from "@/lib/audit";
import { createServiceClient } from "@/lib/supabase/server";
import { metaNameKey } from "@/lib/meta/name-key";
import { isoToDateInput } from "@/lib/dates";
import { resolveViewerTimezone } from "@/lib/user-timezone";
import { isPeriodPreset, resolvePeriod } from "@/lib/dashboards/period";
import { parseMetaConfig } from "@/lib/meta/accounts";
import { loadLinkedAds, loadPieceAdsNumbers } from "@/lib/meta/content-ads-load";
import { hasMixedCurrencies, summarizePieceAds, type PieceAdsSummary } from "@/lib/meta/content-ad-summary";

/**
 * El vínculo MANUAL entre un anuncio de Meta y una pieza de Contenido (Extra L, Tirón 2, A2).
 *
 * El automático (`lib/meta/content-link.ts`) no cambia y nunca pisa uno manual (`content_link_manual = true`).
 * Estas acciones solo las usan los menús «⋯» del detalle del anuncio y del detalle de la pieza.
 *
 * Permiso: `content.create` (crear y editar piezas) Y `dashboards.ads.view` (ver los anuncios): hay que poder tocar las dos
 * cosas que se unen. Cada acción: el workspace sale SIEMPRE de la sesión; el anuncio y la pieza tienen que ser de ese
 * workspace; la pieza se lee con la sesión de quien vincula (la RLS decide si la ve); se escribe con el cliente de servicio
 * (`meta_ads` no tiene policy de escritura para la app) y queda en `audit_log` (entidad `meta_ad`).
 *
 * En un archivo `"use server"` todo lo exportado es una función asincrónica: los tipos viven en `lib/meta/content-ad-summary.ts`.
 */

const NO_PERMISSION = "No tenés permiso para vincular anuncios con piezas de contenido. Pedile a un Admin que lo haga.";
const AD_NOT_FOUND = "No encontré ese anuncio en el catálogo. Sincronizá la cuenta y probá de nuevo.";
const PIECE_NOT_FOUND = "No encontré esa pieza, o no tenés acceso a ella.";
const GENERIC = "No pude guardar el cambio. Probá de nuevo en un rato.";
const SEARCH_LIMIT = 8;

export type ContentAdLinkResult = { ok: true } | { ok: false; error: string };

async function linkContext() {
  const ctx = await getPermissionAction("content.create");
  if (!ctx || !ctx.can("dashboards.ads.view")) return null;
  return ctx;
}

/** Los comodines de LIKE escritos por la persona valen como texto, no como comodines. */
const escapeLike = (value: string): string => value.replace(/[%_\\]/g, (c) => `\\${c}`);

const cleanId = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= 200 ? trimmed : null;
};

export interface PieceOption {
  id: string;
  title: string;
  /** La fecha más temprana de sus redes, o cuándo se creó. */
  date: string;
  thumbnailUrl: string | null;
  platforms: string[];
  /** Ya tiene algún anuncio vinculado. */
  paid: boolean;
}

export interface AdOption {
  adId: string;
  name: string | null;
  adAccountId: string;
  /** «Conjunto › Campaña». */
  path: string | null;
  /** Ya está vinculado a otra pieza. */
  linkedTo: string | null;
}

/** El buscador de piezas del menú del anuncio: por título; sin texto, las más recientes. */
export async function searchPiecesForAd(query: string): Promise<{ ok: true; options: PieceOption[] } | { ok: false; error: string }> {
  const ctx = await linkContext();
  if (!ctx) return { ok: false, error: NO_PERMISSION };

  const text = (typeof query === "string" ? query : "").trim().slice(0, 100);
  let request = ctx.supabase
    .from("content_posts")
    .select("id, title, networks, created_at")
    .eq("workspace_id", ctx.workspace.id)
    .is("deleted_at", null)
    .is("archived_at", null);
  // El texto de la persona va como VALOR de un filtro, nunca dentro de una cadena de filtros.
  if (text.length >= 2) request = request.ilike("title", `%${escapeLike(text)}%`);
  const { data: pieces, error } = await request.order("updated_at", { ascending: false }).limit(SEARCH_LIMIT);
  if (error) {
    console.error("[contenido] no pude buscar piezas para vincular:", error.message);
    return { ok: false, error: "No pude buscar. Probá de nuevo." };
  }
  const rows = pieces ?? [];
  if (rows.length === 0) return { ok: true, options: [] };

  const ids = rows.map((p) => p.id);
  const [{ data: posts }, { data: linked }] = await Promise.all([
    ctx.supabase
      .from("social_posts")
      .select("content_post_id, platform, thumbnail_url, published_at, scheduled_at, status")
      .eq("workspace_id", ctx.workspace.id)
      .in("content_post_id", ids)
      .is("deleted_at", null),
    ctx.supabase.from("meta_ads").select("content_post_id").eq("workspace_id", ctx.workspace.id).in("content_post_id", ids),
  ]);
  const paid = new Set((linked ?? []).map((r) => r.content_post_id).filter((id): id is string => !!id));

  const options: PieceOption[] = rows.map((piece) => {
    const mine = (posts ?? []).filter((p) => p.content_post_id === piece.id && p.status !== "cancelled");
    const planned = (Array.isArray(piece.networks) ? piece.networks : []) as Array<{ platform?: string; planned_at?: string | null }>;
    const dates = [...mine.map((p) => p.published_at ?? p.scheduled_at), ...planned.map((n) => n.planned_at ?? null)].filter((d): d is string => !!d).sort();
    return {
      id: piece.id,
      title: piece.title,
      date: dates[0] ?? piece.created_at,
      thumbnailUrl: mine.find((p) => p.thumbnail_url)?.thumbnail_url ?? null,
      platforms: [...new Set([...mine.map((p) => String(p.platform)), ...planned.map((n) => String(n.platform ?? "")).filter(Boolean)])],
      paid: paid.has(piece.id),
    };
  });
  return { ok: true, options };
}

/** El buscador de anuncios del menú de la pieza: por nombre (sin importar mayúsculas ni tildes) o por id. */
export async function searchAdsForPiece(query: string): Promise<{ ok: true; options: AdOption[] } | { ok: false; error: string }> {
  const ctx = await linkContext();
  if (!ctx) return { ok: false, error: NO_PERMISSION };

  const text = (typeof query === "string" ? query : "").trim().slice(0, 100);
  if (text.length < 2) return { ok: true, options: [] };

  const key = metaNameKey(text);
  const like = `%${escapeLike(key)}%`;
  const ws = ctx.workspace.id;
  const select = "ad_id, name, ad_account_id, adset_id, campaign_id, content_post_id";
  const [byName, byId] = await Promise.all([
    ctx.supabase.from("meta_ads").select(select).eq("workspace_id", ws).ilike("name_key", like).limit(SEARCH_LIMIT),
    ctx.supabase.from("meta_ads").select(select).eq("workspace_id", ws).eq("ad_id", text).limit(SEARCH_LIMIT),
  ]);
  if (byName.error && byId.error) return { ok: false, error: "No pude buscar. Probá de nuevo." };

  type AdRow = { ad_id: string; name: string | null; ad_account_id: string; adset_id: string | null; campaign_id: string | null; content_post_id: string | null };
  const seen = new Set<string>();
  const ads = [...((byId.data ?? []) as AdRow[]), ...((byName.data ?? []) as AdRow[])].filter((a) => (seen.has(a.ad_id) ? false : (seen.add(a.ad_id), true))).slice(0, SEARCH_LIMIT);

  const adsetIds = [...new Set(ads.map((a) => a.adset_id).filter((x): x is string => !!x))];
  const campaignIds = [...new Set(ads.map((a) => a.campaign_id).filter((x): x is string => !!x))];
  const pieceIds = [...new Set(ads.map((a) => a.content_post_id).filter((x): x is string => !!x))];
  const [adsets, campaigns, pieces] = await Promise.all([
    adsetIds.length ? ctx.supabase.from("meta_adsets").select("adset_id, name").eq("workspace_id", ws).in("adset_id", adsetIds) : Promise.resolve({ data: [] }),
    campaignIds.length ? ctx.supabase.from("meta_campaigns").select("campaign_id, name").eq("workspace_id", ws).in("campaign_id", campaignIds) : Promise.resolve({ data: [] }),
    pieceIds.length ? ctx.supabase.from("content_posts").select("id, title").eq("workspace_id", ws).in("id", pieceIds) : Promise.resolve({ data: [] }),
  ]);
  const adsetName = new Map(((adsets.data ?? []) as Array<{ adset_id: string; name: string | null }>).map((r) => [r.adset_id, r.name]));
  const campaignName = new Map(((campaigns.data ?? []) as Array<{ campaign_id: string; name: string | null }>).map((r) => [r.campaign_id, r.name]));
  const pieceTitle = new Map(((pieces.data ?? []) as Array<{ id: string; title: string }>).map((r) => [r.id, r.title]));

  return {
    ok: true,
    options: ads.map((a) => ({
      adId: a.ad_id,
      name: a.name,
      adAccountId: a.ad_account_id,
      path: [a.adset_id ? (adsetName.get(a.adset_id) ?? a.adset_id) : null, a.campaign_id ? (campaignName.get(a.campaign_id) ?? a.campaign_id) : null].filter(Boolean).join(" › ") || null,
      linkedTo: a.content_post_id ? (pieceTitle.get(a.content_post_id) ?? "otra pieza") : null,
    })),
  };
}

/** Vincula el anuncio con la pieza, a mano. Si el anuncio ya tenía otra pieza, queda con esta. */
export async function linkAdToPiece(input: { adId: string; pieceId: string }): Promise<ContentAdLinkResult> {
  const ctx = await linkContext();
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  const adId = cleanId(input?.adId);
  const pieceId = cleanId(input?.pieceId);
  if (!adId) return { ok: false, error: AD_NOT_FOUND };
  if (!pieceId) return { ok: false, error: PIECE_NOT_FOUND };

  const service = await createServiceClient();
  const ws = ctx.workspace.id;

  const { data: ad } = await service.from("meta_ads").select("id, ad_id, name, content_post_id, social_post_id, content_link_manual").eq("workspace_id", ws).eq("ad_id", adId).limit(1).maybeSingle();
  if (!ad) return { ok: false, error: AD_NOT_FOUND };

  // La pieza se lee con la sesión de quien vincula: si la RLS no se la deja ver, para esta persona no existe.
  const { data: piece } = await ctx.supabase.from("content_posts").select("id, title").eq("id", pieceId).eq("workspace_id", ws).is("deleted_at", null).maybeSingle();
  if (!piece) return { ok: false, error: PIECE_NOT_FOUND };

  // La publicación de Instagram de la pieza (la única red de Meta que se guarda), si ya salió o está agendada.
  const { data: post } = await service
    .from("social_posts")
    .select("id")
    .eq("workspace_id", ws)
    .eq("content_post_id", piece.id)
    .eq("platform", "instagram")
    .neq("status", "cancelled")
    .is("deleted_at", null)
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  // Lo que tenía antes, copiado ANTES de escribir: el historial dice de dónde venía.
  const before = { content_post_id: ad.content_post_id, social_post_id: ad.social_post_id, content_link_manual: ad.content_link_manual };
  const { error } = await service
    .from("meta_ads")
    .update({ content_post_id: piece.id, social_post_id: post?.id ?? null, content_link_manual: true } as never)
    .eq("id", ad.id)
    .eq("workspace_id", ws);
  if (error) {
    console.error("[contenido] no pude vincular el anuncio con la pieza:", error.message);
    return { ok: false, error: GENERIC };
  }

  const changes: AuditChanges = {
    content_post_id: { old: before.content_post_id, new: piece.id },
    social_post_id: { old: before.social_post_id, new: post?.id ?? null },
    content_link_manual: { old: before.content_link_manual, new: true },
  };
  await logAudit({
    supabase: service,
    workspaceId: ws,
    entityType: "meta_ad",
    entityId: ad.id,
    action: "content_link.linked",
    changes,
    metadata: { ad_id: ad.ad_id, ad_name: ad.name, piece_title: piece.title },
    performedBy: ctx.user.id,
  });

  revalidateAround(piece.id);
  return { ok: true };
}

/** Quita el vínculo del anuncio con su pieza. El automático vuelve a intentarlo en el próximo sync. */
export async function unlinkAdFromPiece(input: { adId: string }): Promise<ContentAdLinkResult> {
  const ctx = await linkContext();
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  const adId = cleanId(input?.adId);
  if (!adId) return { ok: false, error: AD_NOT_FOUND };

  const service = await createServiceClient();
  const ws = ctx.workspace.id;
  const { data: ad } = await service.from("meta_ads").select("id, ad_id, name, content_post_id, social_post_id, content_link_manual").eq("workspace_id", ws).eq("ad_id", adId).limit(1).maybeSingle();
  if (!ad) return { ok: false, error: AD_NOT_FOUND };
  if (!ad.content_post_id && !ad.content_link_manual) return { ok: true }; // ya estaba sin vínculo

  const before = { content_post_id: ad.content_post_id, social_post_id: ad.social_post_id, content_link_manual: ad.content_link_manual };
  const { error } = await service
    .from("meta_ads")
    .update({ content_post_id: null, social_post_id: null, content_link_manual: false } as never)
    .eq("id", ad.id)
    .eq("workspace_id", ws);
  if (error) {
    console.error("[contenido] no pude desvincular el anuncio:", error.message);
    return { ok: false, error: GENERIC };
  }

  const changes: AuditChanges = {
    content_post_id: { old: before.content_post_id, new: null },
    social_post_id: { old: before.social_post_id, new: null },
    content_link_manual: { old: before.content_link_manual, new: false },
  };
  await logAudit({
    supabase: service,
    workspaceId: ws,
    entityType: "meta_ad",
    entityId: ad.id,
    action: "content_link.unlinked",
    changes,
    metadata: { ad_id: ad.ad_id, ad_name: ad.name },
    performedBy: ctx.user.id,
  });

  revalidateAround(before.content_post_id);
  return { ok: true };
}

function revalidateAround(pieceId: string | null) {
  revalidatePath("/dashboard/content");
  if (pieceId) revalidatePath(`/dashboard/content/${pieceId}`);
  revalidatePath("/dashboard/dashboards/ads");
}

/** Los números de la sección «Publicidad» de una pieza, para un período. Los lee con la sesión de quien mira. */
export async function loadPieceAdsSummary(input: {
  pieceId: string;
  period: string;
}): Promise<{ ok: true; summary: PieceAdsSummary; currency: string | null } | { ok: false; error: string }> {
  const ctx = await getPermissionAction("dashboards.ads.view");
  if (!ctx || !ctx.can("content.view")) return { ok: false, error: "No tenés permiso para ver la publicidad de esta pieza." };
  const pieceId = cleanId(input?.pieceId);
  if (!pieceId) return { ok: false, error: PIECE_NOT_FOUND };
  const preset = isPeriodPreset(String(input?.period)) ? (input.period as Parameters<typeof resolvePeriod>[0]) : "historico";

  const ws = ctx.workspace.id;
  const ads = await loadLinkedAds(ctx.supabase, ws, pieceId);
  if (ads.length === 0) return { ok: true, summary: summarizePieceAds({ ads: [], insights: [], crm: [] }), currency: null };

  const timeZone = await resolveViewerTimezone(ctx.workspace.timezone);
  const now = new Date();
  const range = resolvePeriod(preset, now, timeZone);
  const since = range.from ? isoToDateInput(range.from, timeZone) : "2000-01-01";
  const until = isoToDateInput(range.to ?? now.toISOString(), timeZone);

  const numbers = await loadPieceAdsNumbers(ctx.supabase, { workspaceId: ws, adIds: ads.map((a) => a.adId), since, until });

  // La moneda de cada cuenta publicitaria (se lee con el servidor, filtrada por el workspace de la sesión).
  const service = await createServiceClient();
  const { data: configRow } = await service.from("integration_configs").select("config").eq("workspace_id", ws).eq("type", "meta").eq("provider", "meta").maybeSingle();
  const accounts = parseMetaConfig(configRow?.config).ad_accounts;
  const currencies = [...new Set(ads.map((a) => a.adAccountId))].map((id) => accounts.find((acc) => acc.ad_account_id === id)?.currency ?? null);
  const mixed = hasMixedCurrencies(currencies);

  return {
    ok: true,
    summary: summarizePieceAds({ ads, insights: numbers.insights, crm: numbers.crm, currencyMixed: mixed }),
    currency: mixed ? null : (currencies.find((c) => !!c) ?? null),
  };
}
