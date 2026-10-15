/**
 * Lee lo que hace falta para decir de donde vino una venta (Extra I, F49): el toque, la pieza con su responsable, la
 * publicacion, el anuncio del catalogo de Meta y quien refirio.
 *
 * Todo con el cliente de QUIEN MIRA: la RLS decide que se ve. Lo que no se puede leer queda en `null` y la vista
 * (`saleAttributionView`) lo dice con lo que si hay. Nunca lanza: un fallo aca no puede romper la lista ni la ficha.
 * Por cada tabla es UNA consulta con `in (...)`, no una por venta.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import {
  saleAttributionView,
  touchReferences,
  type SaleAttributionViewModel,
  type ViewAd,
  type ViewPerson,
  type ViewPiece,
  type ViewPublication,
  type ViewReferrer,
  type ViewSale,
  type ViewTouch,
} from "./attribution-view";

type Db = SupabaseClient<Database>;

const THUMBNAIL_SECONDS = 3600;

export const VIEW_TOUCH_COLUMNS =
  "id, occurred_at, channel, origin, source, medium, campaign, content_label, content_post_id, social_post_id, ad_id, adset_id, campaign_id, meta_campaign_id, meta_adset_id, meta_ad_id, gclid, ttclid, li_fat_id, ctwa_clid, fbclid, raw";

export interface OriginParts {
  touch: ViewTouch | null;
  piece: ViewPiece | null;
  publication: ViewPublication | null;
  ad: ViewAd | null;
  referrer: ViewReferrer | null;
}

export interface LoadOriginsParams {
  workspaceId: string;
  touchIds: readonly string[];
  /** `id de persona -> nombre`: para el responsable de la pieza y la persona que refirio. */
  memberNames: ReadonlyMap<string, string>;
  /** Con `dashboards.ads.view` se lee el catalogo de Meta; sin el, ni se intenta (la RLS lo dejaria vacio). */
  canViewAds: boolean;
  /** Solo la ficha: firma la miniatura del anuncio. La lista no. */
  withThumbnails?: boolean;
}

const unique = (values: Array<string | null | undefined>): string[] => [...new Set(values.filter((v): v is string => !!v))];

/** Una consulta que falla devuelve vacio y deja el aviso: una venta sin su origen no tumba la pantalla. */
async function safe<T>(label: string, run: () => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  try {
    const { data, error } = await run();
    if (error) {
      console.error(`[ventas] no pude leer ${label}:`, error.message);
      return [];
    }
    return data ?? [];
  } catch (err) {
    console.error(`[ventas] no pude leer ${label}:`, err instanceof Error ? err.message : "error desconocido");
    return [];
  }
}

export async function loadOriginParts(supabase: Db, params: LoadOriginsParams): Promise<Map<string, OriginParts>> {
  const result = new Map<string, OriginParts>();
  const ids = unique([...params.touchIds]);
  if (ids.length === 0) return result;
  const { workspaceId } = params;

  const touchRows = (await safe("los toques", () =>
    supabase.from("contact_touches").select(VIEW_TOUCH_COLUMNS).eq("workspace_id", workspaceId).in("id", ids),
  )) as unknown as ViewTouch[];
  const touches = new Map(touchRows.map((t) => [t.id, t]));
  const refs = new Map(touchRows.map((t) => [t.id, touchReferences(t)]));
  const all = [...refs.values()];

  // Las publicaciones primero: una publicacion sin pieza en el toque puede apuntar a una.
  const publicationIds = unique(all.map((r) => r.publicationId));
  const publicationRows = publicationIds.length
    ? await safe("las publicaciones", () => supabase.from("social_posts").select("id, platform, assigned_to, content_post_id").eq("workspace_id", workspaceId).in("id", publicationIds))
    : [];
  const publications = new Map(publicationRows.map((p) => [p.id, p]));

  const pieceIds = unique([...all.map((r) => r.pieceId), ...publicationRows.map((p) => p.content_post_id)]);
  const adIds = params.canViewAds ? unique(all.map((r) => r.adId)) : [];
  const adsetIds = params.canViewAds ? unique(all.map((r) => r.adsetId)) : [];
  const campaignIds = params.canViewAds ? unique(all.map((r) => r.campaignId)) : [];
  const referrerContactIds = unique(all.map((r) => r.referrerContactId));

  const [pieceRows, adRows, adsetRows, campaignRows, contactRows] = await Promise.all([
    pieceIds.length ? safe("las piezas", () => supabase.from("content_posts").select("id, title, assigned_to").eq("workspace_id", workspaceId).in("id", pieceIds)) : [],
    adIds.length ? safe("los anuncios", () => supabase.from("meta_ads").select("ad_id, name, ad_account_id, adset_id, campaign_id, thumbnail_path").eq("workspace_id", workspaceId).in("ad_id", adIds)) : [],
    adsetIds.length ? safe("los conjuntos", () => supabase.from("meta_adsets").select("adset_id, name").eq("workspace_id", workspaceId).in("adset_id", adsetIds)) : [],
    campaignIds.length ? safe("las campañas", () => supabase.from("meta_campaigns").select("campaign_id, name").eq("workspace_id", workspaceId).in("campaign_id", campaignIds)) : [],
    referrerContactIds.length ? safe("quien refirio", () => supabase.from("contacts").select("id, display_name").eq("workspace_id", workspaceId).in("id", referrerContactIds)) : [],
  ]);

  const pieces = new Map(pieceRows.map((p) => [p.id, p]));
  const ads = new Map(adRows.map((a) => [a.ad_id, a]));
  const adsets = new Map(adsetRows.map((a) => [a.adset_id, a.name]));
  const campaigns = new Map(campaignRows.map((c) => [c.campaign_id, c.name]));
  const contactNames = new Map(contactRows.map((c) => [c.id, c.display_name]));

  const person = (id: string | null | undefined): ViewPerson | null => {
    if (!id) return null;
    const name = params.memberNames.get(id);
    return name ? { id, name } : null;
  };

  // Las miniaturas se firman una sola vez por anuncio y solo si se pidieron.
  const thumbnails = new Map<string, string>();
  if (params.withThumbnails) {
    await Promise.all(
      adRows
        .filter((a) => a.thumbnail_path)
        .map(async (a) => {
          try {
            const { data } = await supabase.storage.from("ad-creatives").createSignedUrl(a.thumbnail_path as string, THUMBNAIL_SECONDS);
            if (data?.signedUrl) thumbnails.set(a.ad_id, data.signedUrl);
          } catch {
            // Sin miniatura se ve igual.
          }
        }),
    );
  }

  for (const id of ids) {
    const touch = touches.get(id) ?? null;
    const r = refs.get(id);
    if (!touch || !r) {
      result.set(id, { touch: null, piece: null, publication: null, ad: null, referrer: null });
      continue;
    }

    const pub = r.publicationId ? publications.get(r.publicationId) : undefined;
    const pieceRow = pieces.get(r.pieceId ?? pub?.content_post_id ?? "");
    const piece: ViewPiece | null = pieceRow ? { id: pieceRow.id, title: pieceRow.title, assignee: person(pieceRow.assigned_to) } : null;
    const publication: ViewPublication | null = pub ? { id: pub.id, platform: pub.platform ?? null, assignee: person(pub.assigned_to) } : null;

    const adRow = r.adId ? ads.get(r.adId) : undefined;
    const hasCatalog = !!(adRow || (r.adsetId && adsets.has(r.adsetId)) || (r.campaignId && campaigns.has(r.campaignId)));
    const ad: ViewAd | null = hasCatalog
      ? {
          adId: adRow?.ad_id ?? null,
          adAccountId: adRow?.ad_account_id ?? null,
          campaignName: (r.campaignId ? campaigns.get(r.campaignId) : null) ?? null,
          adsetName: (r.adsetId ? adsets.get(r.adsetId) : null) ?? null,
          adName: adRow?.name ?? null,
          thumbnailUrl: adRow ? (thumbnails.get(adRow.ad_id) ?? null) : null,
        }
      : null;

    let referrer: ViewReferrer | null = null;
    if (r.referrerContactId) referrer = { type: "contact", id: r.referrerContactId, name: contactNames.get(r.referrerContactId) ?? null };
    else if (r.referrerUserId) referrer = { type: "member", id: r.referrerUserId, name: params.memberNames.get(r.referrerUserId) ?? null };

    result.set(id, { touch, piece, publication, ad, referrer });
  }
  return result;
}

/** La vista de cada venta, a partir de lo leido. Una venta sin toque (o con uno que no se ve) cae a su copia congelada. */
export function buildOriginViews(
  sales: ReadonlyArray<ViewSale & { id: string }>,
  parts: ReadonlyMap<string, OriginParts>,
  canViewAds: boolean,
): Record<string, SaleAttributionViewModel> {
  const out: Record<string, SaleAttributionViewModel> = {};
  for (const sale of sales) {
    const p = (sale.attribution_touch_id ? parts.get(sale.attribution_touch_id) : null) ?? { touch: null, piece: null, publication: null, ad: null, referrer: null };
    out[sale.id] = saleAttributionView(sale, p.touch, p.piece, p.publication, p.ad, { canViewAds, referrer: p.referrer });
  }
  return out;
}
