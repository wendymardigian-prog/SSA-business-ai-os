"use server";

import { revalidatePath } from "next/cache";
import { getPermissionAction } from "@/lib/auth/guards";
import { logAudit, type AuditChanges } from "@/lib/audit";
import { createServiceClient } from "@/lib/supabase/server";
import { metaNameKey } from "@/lib/meta/name-key";
import type { Json } from "@/lib/types/database";

/**
 * Vincular, ignorar o quitar a mano el vinculo de un toque con un anuncio de Meta (Extra L, AT3, F29).
 *
 * Permiso: `settings.general`. Cada accion:
 *   1. el toque tiene que ser del workspace de la SESION (nunca del pedido);
 *   2. quien vincula tiene que PODER VER el contacto: se comprueba con el cliente del usuario, asi la RLS
 *      de `contacts` (`can_see_contact`) decide, igual que en la ficha;
 *   3. se escribe con `set_touch_meta_match` (atomica: actualiza el toque y recalcula la atribucion del contacto);
 *   4. queda en `audit_log` (entidad contact) con el antes y el despues.
 *
 * El auto-vinculo (trigger y re-vinculo) nunca pisa un `manual` ni un `ignored`.
 */

const NO_PERMISSION = "No tenés permiso para vincular toques con anuncios. Pedile a un Admin que lo haga.";
const NOT_FOUND = "No encontré ese toque. Puede que ya no exista.";
const NO_CONTACT = "No tenés acceso a ese contacto, así que no podés cambiarle la atribución.";

export type MetaMatchActionResult = { ok: true } | { ok: false; error: string };

const ERRORS: Record<string, string> = {
  touch_not_found: NOT_FOUND,
  not_in_catalog: "Ese anuncio, conjunto o campaña no está en el catálogo de Meta. Sincronizá la cuenta y probá de nuevo.",
  nothing_to_link: "Elegí un anuncio, un conjunto o una campaña para vincular.",
  not_manual: "Ese toque no tiene un vínculo manual que quitar.",
  invalid_action: "No pude hacer ese cambio.",
};

type Action = "link" | "ignore" | "unlink";
const AUDIT_ACTION = { link: "attribution.meta_linked", ignore: "attribution.meta_ignored", unlink: "attribution.meta_unlinked" } as const;

interface Snapshot {
  status?: string | null;
  ad_id?: string | null;
  adset_id?: string | null;
  campaign_id?: string | null;
  method?: string | null;
}

async function run(
  touchId: string,
  action: Action,
  ids: { adId?: string | null; adsetId?: string | null; campaignId?: string | null } = {},
): Promise<MetaMatchActionResult> {
  const ctx = await getPermissionAction("settings.general");
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  if (!touchId) return { ok: false, error: NOT_FOUND };

  const service = await createServiceClient();

  // 1. El toque es de este workspace.
  const { data: touch } = await service
    .from("contact_touches")
    .select("id, contact_id")
    .eq("id", touchId)
    .eq("workspace_id", ctx.workspace.id)
    .maybeSingle();
  if (!touch) return { ok: false, error: NOT_FOUND };

  // 2. Quien vincula puede ver el contacto (la RLS de contacts decide con SU sesion).
  const { data: visible } = await ctx.supabase.from("contacts").select("id").eq("id", touch.contact_id).maybeSingle();
  if (!visible) return { ok: false, error: NO_CONTACT };

  // 3. Se escribe de forma atomica.
  const { data, error } = await service.rpc("set_touch_meta_match", {
    p_workspace_id: ctx.workspace.id,
    p_touch_id: touchId,
    p_action: action,
    p_user_id: ctx.user.id,
    p_ad_id: ids.adId ?? undefined,
    p_adset_id: ids.adsetId ?? undefined,
    p_campaign_id: ids.campaignId ?? undefined,
  });
  if (error) {
    console.error("[meta-match] no pude cambiar el vinculo del toque:", error.message);
    return { ok: false, error: "No pude guardar el cambio. Probá de nuevo en un rato." };
  }

  const result = data as { ok?: boolean; error?: string; before?: Snapshot; after?: Snapshot } | null;
  if (!result?.ok) return { ok: false, error: ERRORS[result?.error ?? ""] ?? ERRORS.invalid_action };

  // 4. El historial del contacto, con el antes y el despues.
  const changes: AuditChanges = {
    meta_match: { old: (result.before ?? null) as Json, new: (result.after ?? null) as Json },
  };
  await logAudit({
    supabase: service,
    workspaceId: ctx.workspace.id,
    entityType: "contact",
    entityId: touch.contact_id,
    action: AUDIT_ACTION[action],
    changes,
    metadata: { touch_id: touchId },
    performedBy: ctx.user.id,
  });

  revalidatePath("/dashboard/dashboards/ads/sin-vincular");
  revalidatePath(`/dashboard/contacts/${touch.contact_id}`);
  return { ok: true };
}

/** Vincula el toque a un anuncio (completa su conjunto y campaña), a un conjunto o a una campaña. */
export async function linkTouchToMeta(input: {
  touchId: string;
  adId?: string | null;
  adsetId?: string | null;
  campaignId?: string | null;
}): Promise<MetaMatchActionResult> {
  return run(input.touchId, "link", { adId: input.adId, adsetId: input.adsetId, campaignId: input.campaignId });
}

/** El toque no tiene que vincularse con ningun anuncio (no vuelve a aparecer en «Sin vincular»). */
export async function ignoreTouchMeta(touchId: string): Promise<MetaMatchActionResult> {
  return run(touchId, "ignore");
}

/** Quita un vinculo manual o un «ignorado»: el toque vuelve a resolverse solo. */
export async function unlinkTouchMeta(touchId: string): Promise<MetaMatchActionResult> {
  return run(touchId, "unlink");
}

export interface CatalogOption {
  level: "ad" | "adset" | "campaign";
  id: string;
  name: string | null;
  /** "Conjunto › Campaña", para distinguir dos anuncios con el mismo nombre. */
  path: string | null;
}

const SEARCH_LIMIT = 8;

/**
 * El buscador de «Vincular»: anuncios, conjuntos y campañas del catalogo por nombre (sin importar
 * mayusculas ni tildes) o por id. Permiso `settings.general`; el workspace sale de la sesion.
 */
export async function searchMetaCatalog(query: string): Promise<{ ok: true; options: CatalogOption[] } | { ok: false; error: string }> {
  const ctx = await getPermissionAction("settings.general");
  if (!ctx) return { ok: false, error: NO_PERMISSION };

  const text = (query ?? "").trim().slice(0, 100);
  if (text.length < 2) return { ok: true, options: [] };

  const service = await createServiceClient();
  const key = metaNameKey(text);
  // El texto de la persona va como VALOR de un filtro, nunca dentro de una cadena de filtros (no hay inyeccion posible).
  const like = `%${key.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const ws = ctx.workspace.id;

  const [adsByName, adsById, adsetsByName, adsetsById, campaignsByName, campaignsById] = await Promise.all([
    service.from("meta_ads").select("ad_id, name, adset_id, campaign_id").eq("workspace_id", ws).ilike("name_key", like).limit(SEARCH_LIMIT),
    service.from("meta_ads").select("ad_id, name, adset_id, campaign_id").eq("workspace_id", ws).eq("ad_id", text).limit(SEARCH_LIMIT),
    service.from("meta_adsets").select("adset_id, name, campaign_id").eq("workspace_id", ws).ilike("name_key", like).limit(SEARCH_LIMIT),
    service.from("meta_adsets").select("adset_id, name, campaign_id").eq("workspace_id", ws).eq("adset_id", text).limit(SEARCH_LIMIT),
    service.from("meta_campaigns").select("campaign_id, name").eq("workspace_id", ws).ilike("name_key", like).limit(SEARCH_LIMIT),
    service.from("meta_campaigns").select("campaign_id, name").eq("workspace_id", ws).eq("campaign_id", text).limit(SEARCH_LIMIT),
  ]);

  type AdRow = { ad_id: string; name: string | null; adset_id: string | null; campaign_id: string | null };
  type AdsetRow = { adset_id: string; name: string | null; campaign_id: string | null };
  type CampaignRow = { campaign_id: string; name: string | null };
  const ads = uniqueBy([...((adsById.data ?? []) as AdRow[]), ...((adsByName.data ?? []) as AdRow[])], (r) => r.ad_id);
  const adsets = uniqueBy([...((adsetsById.data ?? []) as AdsetRow[]), ...((adsetsByName.data ?? []) as AdsetRow[])], (r) => r.adset_id);
  const campaigns = uniqueBy([...((campaignsById.data ?? []) as CampaignRow[]), ...((campaignsByName.data ?? []) as CampaignRow[])], (r) => r.campaign_id);

  // Los nombres de los padres, para el camino.
  const adsetIds = [...new Set([...ads.map((a) => a.adset_id), ...adsets.map((s) => s.adset_id)].filter((x): x is string => !!x))];
  const campaignIds = [...new Set([...ads.map((a) => a.campaign_id), ...adsets.map((s) => s.campaign_id)].filter((x): x is string => !!x))];
  const adsetName = new Map<string, string | null>();
  const campaignName = new Map<string, string | null>();
  if (adsetIds.length > 0) {
    const { data } = await service.from("meta_adsets").select("adset_id, name").eq("workspace_id", ws).in("adset_id", adsetIds);
    for (const r of (data ?? []) as Array<{ adset_id: string; name: string | null }>) adsetName.set(r.adset_id, r.name);
  }
  if (campaignIds.length > 0) {
    const { data } = await service.from("meta_campaigns").select("campaign_id, name").eq("workspace_id", ws).in("campaign_id", campaignIds);
    for (const r of (data ?? []) as Array<{ campaign_id: string; name: string | null }>) campaignName.set(r.campaign_id, r.name);
  }
  const path = (adsetId: string | null, campaignId: string | null) =>
    [adsetId ? (adsetName.get(adsetId) ?? adsetId) : null, campaignId ? (campaignName.get(campaignId) ?? campaignId) : null].filter(Boolean).join(" › ") || null;

  const options: CatalogOption[] = [
    ...ads.slice(0, SEARCH_LIMIT).map((a) => ({ level: "ad" as const, id: a.ad_id, name: a.name, path: path(a.adset_id, a.campaign_id) })),
    ...adsets.slice(0, SEARCH_LIMIT).map((s) => ({ level: "adset" as const, id: s.adset_id, name: s.name, path: path(null, s.campaign_id) })),
    ...campaigns.slice(0, SEARCH_LIMIT).map((c) => ({ level: "campaign" as const, id: c.campaign_id, name: c.name, path: null })),
  ];
  return { ok: true, options };
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
