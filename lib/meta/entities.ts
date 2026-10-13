/**
 * El catalogo de Meta: campañas, conjuntos y anuncios (Extra L, AT2, F23).
 *
 * Hasta ahora solo se guardaban METRICAS por dia. Esto trae las ENTIDADES, con su estado,
 * su creativo y los ids de la publicacion que promocionan. Tres decisiones:
 *
 * 1. **Se piden tambien los pausados, archivados y borrados.** Por defecto Meta devuelve solo
 *    lo "activo y pausado": un anuncio archivado que trajo un lead hace un mes desaparece del
 *    catalogo y el vinculo de AT3 lo pierde. `filtering` los pide a todos. Si Meta rechaza
 *    `DELETED` (varia por nivel y version), se reintenta sin el y queda anotado.
 * 2. **Paginacion completa con tope.** Cincuenta paginas por nivel; si se llega al tope, el
 *    resultado lo DICE (`stopReason: "capped"`) y el sync lo anota en la cuenta: cortar en
 *    silencio da un catalogo incompleto que nadie sabe que lo es.
 * 3. **El limite de uso de Meta se respeta cortando.** Pasado el 90 %, lo que queda se deja
 *    para el proximo ciclo (`stopReason: "usage"`).
 *
 * Un error del grafo vuelve como resultado, no como excepcion (ver `graph.ts`).
 * Modulo puro: no sabe de Supabase.
 */

import { GRAPH, humanizeGraphError, isTransientGraphError, type GraphError } from "./graph";
import { readUsage } from "./insights";
import { metaNameKey } from "./name-key";

export type CatalogLevel = "campaign" | "adset" | "ad";

/** Paginas por nivel antes de cortar y anotarlo. */
export const MAX_ENTITY_PAGES = 50;
const PAGE_SIZE = 200;

/** Los estados efectivos que se piden. `DELETED` va al final: es el que Meta puede rechazar. */
export const EFFECTIVE_STATUSES = [
  "ACTIVE",
  "PAUSED",
  "ARCHIVED",
  "CAMPAIGN_PAUSED",
  "ADSET_PAUSED",
  "IN_PROCESS",
  "WITH_ISSUES",
  "PENDING_REVIEW",
  "DISAPPROVED",
  "PREAPPROVED",
  "PENDING_BILLING_INFO",
  "DELETED",
] as const;

const CREATIVE_FIELDS =
  "creative{id,title,body,call_to_action_type,object_type,thumbnail_url,image_url,object_story_id,effective_instagram_media_id,effective_object_story_id,link_url}";

const FIELDS: Record<CatalogLevel, string> = {
  campaign: "id,name,status,effective_status,objective,buying_type,daily_budget,lifetime_budget,start_time,stop_time,created_time",
  adset: "id,name,campaign_id,status,effective_status,optimization_goal,billing_event,daily_budget,lifetime_budget,start_time,end_time,created_time",
  ad: `id,name,campaign_id,adset_id,status,effective_status,created_time,${CREATIVE_FIELDS}`,
};

const EDGE: Record<CatalogLevel, string> = { campaign: "campaigns", adset: "adsets", ad: "ads" };

// ── Filas normalizadas ───────────────────────────────────────────────────

export interface CampaignEntity {
  campaignId: string;
  name: string | null;
  nameKey: string;
  status: string | null;
  effectiveStatus: string | null;
  objective: string | null;
  buyingType: string | null;
  dailyBudget: number | null;
  lifetimeBudget: number | null;
  startTime: string | null;
  stopTime: string | null;
  createdTime: string | null;
}

export interface AdsetEntity {
  adsetId: string;
  campaignId: string | null;
  name: string | null;
  nameKey: string;
  status: string | null;
  effectiveStatus: string | null;
  optimizationGoal: string | null;
  billingEvent: string | null;
  dailyBudget: number | null;
  lifetimeBudget: number | null;
  startTime: string | null;
  stopTime: string | null;
  createdTime: string | null;
}

export interface AdEntity {
  adId: string;
  campaignId: string | null;
  adsetId: string | null;
  name: string | null;
  nameKey: string;
  status: string | null;
  effectiveStatus: string | null;
  createdTime: string | null;
  creativeId: string | null;
  /** { title, body, cta, link_url, object_type } */
  creative: Record<string, string>;
  thumbnailSourceUrl: string | null;
  /** La publicacion de Instagram que promociona (para enlazar con Contenido). */
  instagramMediaId: string | null;
  /** La publicacion de Facebook que promociona. */
  objectStoryId: string | null;
}

export type CatalogEntity = CampaignEntity | AdsetEntity | AdEntity;

interface RawEntity {
  id?: string;
  name?: string;
  campaign_id?: string;
  adset_id?: string;
  status?: string;
  effective_status?: string;
  objective?: string;
  buying_type?: string;
  optimization_goal?: string;
  billing_event?: string;
  daily_budget?: string | number;
  lifetime_budget?: string | number;
  start_time?: string;
  stop_time?: string;
  end_time?: string;
  created_time?: string;
  creative?: {
    id?: string;
    title?: string;
    body?: string;
    call_to_action_type?: string;
    object_type?: string;
    thumbnail_url?: string;
    image_url?: string;
    object_story_id?: string;
    effective_instagram_media_id?: string;
    effective_object_story_id?: string;
    link_url?: string;
  };
}

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value : null);

/** Meta manda los presupuestos como texto ("5000"): a numero, o null si no es uno. */
const amount = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
};

export function normalizeCampaign(raw: RawEntity): CampaignEntity | null {
  if (!raw.id) return null;
  return {
    campaignId: raw.id,
    name: text(raw.name),
    nameKey: metaNameKey(raw.name),
    status: text(raw.status),
    effectiveStatus: text(raw.effective_status),
    objective: text(raw.objective),
    buyingType: text(raw.buying_type),
    dailyBudget: amount(raw.daily_budget),
    lifetimeBudget: amount(raw.lifetime_budget),
    startTime: text(raw.start_time),
    stopTime: text(raw.stop_time),
    createdTime: text(raw.created_time),
  };
}

export function normalizeAdset(raw: RawEntity): AdsetEntity | null {
  if (!raw.id) return null;
  return {
    adsetId: raw.id,
    campaignId: text(raw.campaign_id),
    name: text(raw.name),
    nameKey: metaNameKey(raw.name),
    status: text(raw.status),
    effectiveStatus: text(raw.effective_status),
    optimizationGoal: text(raw.optimization_goal),
    billingEvent: text(raw.billing_event),
    dailyBudget: amount(raw.daily_budget),
    lifetimeBudget: amount(raw.lifetime_budget),
    startTime: text(raw.start_time),
    // En los conjuntos Meta lo llama `end_time`.
    stopTime: text(raw.end_time ?? raw.stop_time),
    createdTime: text(raw.created_time),
  };
}

export function normalizeAd(raw: RawEntity): AdEntity | null {
  if (!raw.id) return null;
  const creative = raw.creative ?? {};
  const pairs: Record<string, string | null> = {
    title: text(creative.title),
    body: text(creative.body),
    cta: text(creative.call_to_action_type),
    link_url: text(creative.link_url),
    object_type: text(creative.object_type),
  };
  return {
    adId: raw.id,
    campaignId: text(raw.campaign_id),
    adsetId: text(raw.adset_id),
    name: text(raw.name),
    nameKey: metaNameKey(raw.name),
    status: text(raw.status),
    effectiveStatus: text(raw.effective_status),
    createdTime: text(raw.created_time),
    creativeId: text(creative.id),
    creative: Object.fromEntries(Object.entries(pairs).filter((e): e is [string, string] => e[1] !== null)),
    thumbnailSourceUrl: text(creative.thumbnail_url) ?? text(creative.image_url),
    instagramMediaId: text(creative.effective_instagram_media_id),
    objectStoryId: text(creative.effective_object_story_id) ?? text(creative.object_story_id),
  };
}

const NORMALIZERS = {
  campaign: normalizeCampaign,
  adset: normalizeAdset,
  ad: normalizeAd,
} as const;

// ── Lectura ──────────────────────────────────────────────────────────────

export type StopReason = "capped" | "usage";

export type FetchEntitiesResult<L extends CatalogLevel> =
  | {
      ok: true;
      rows: Array<L extends "campaign" ? CampaignEntity : L extends "adset" ? AdsetEntity : AdEntity>;
      pages: number;
      /** null = se leyo todo. "capped"/"usage" = quedo algo sin leer: el catalogo esta incompleto. */
      stopReason: StopReason | null;
      /** Meta rechazo `DELETED` y se leyo sin el. */
      deletedRejected: boolean;
    }
  | { ok: false; error: string; retryable: boolean };

function entitiesUrl(params: {
  token: string;
  adAccountId: string;
  level: CatalogLevel;
  updatedSince: Date | null;
  statuses: readonly string[];
}): string {
  const url = new URL(`${GRAPH}/${params.adAccountId}/${EDGE[params.level]}`);
  url.searchParams.set("fields", FIELDS[params.level]);
  url.searchParams.set("limit", String(PAGE_SIZE));
  url.searchParams.set("filtering", JSON.stringify([{ field: "effective_status", operator: "IN", value: params.statuses }]));
  if (params.updatedSince) {
    url.searchParams.set("updated_since", String(Math.floor(params.updatedSince.getTime() / 1000)));
  }
  url.searchParams.set("access_token", params.token);
  return url.toString();
}

/**
 * Trae un nivel del catalogo, paginando hasta el final (o hasta un tope que se avisa).
 *
 * `updatedSince`: en un sync incremental solo viene lo que cambio desde esa fecha.
 */
export async function fetchEntities<L extends CatalogLevel>(params: {
  token: string;
  adAccountId: string;
  level: L;
  updatedSince?: Date | null;
  maxPages?: number;
  fetchImpl?: typeof fetch;
}): Promise<FetchEntitiesResult<L>> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const maxPages = params.maxPages ?? MAX_ENTITY_PAGES;
  const normalize = NORMALIZERS[params.level] as (raw: RawEntity) => CatalogEntity | null;

  let statuses: readonly string[] = EFFECTIVE_STATUSES;
  let deletedRejected = false;
  const rows: CatalogEntity[] = [];
  let pages = 0;
  let stopReason: StopReason | null = null;

  let next: string | null = entitiesUrl({
    token: params.token,
    adAccountId: params.adAccountId,
    level: params.level,
    updatedSince: params.updatedSince ?? null,
    statuses,
  });

  while (next) {
    if (pages >= maxPages) {
      stopReason = "capped";
      break;
    }

    let body: { data?: RawEntity[]; paging?: { next?: string }; error?: GraphError };
    let usageHeader: string | null = null;
    try {
      const response = await fetchImpl(next);
      body = await response.json();
      usageHeader = response.headers?.get?.("x-business-use-case-usage") ?? null;
    } catch (err) {
      // Una caida de red es temporal: la peticion era valida.
      return { ok: false, error: err instanceof Error ? err.message : String(err), retryable: true };
    }

    if (body.error) {
      // Algunas versiones del grafo no aceptan DELETED en el filtro (codigo 100). Se lee sin el
      // y se avisa: perder los borrados es mejor que perder el catalogo entero.
      const canRetryWithoutDeleted = body.error.code === 100 && pages === 0 && statuses.includes("DELETED");
      if (canRetryWithoutDeleted) {
        statuses = statuses.filter((s) => s !== "DELETED");
        deletedRejected = true;
        next = entitiesUrl({
          token: params.token,
          adAccountId: params.adAccountId,
          level: params.level,
          updatedSince: params.updatedSince ?? null,
          statuses,
        });
        continue;
      }
      return { ok: false, error: humanizeGraphError(body.error), retryable: isTransientGraphError(body.error) };
    }

    for (const raw of body.data ?? []) {
      const row = normalize(raw);
      if (row) rows.push(row);
    }

    pages += 1;
    next = body.paging?.next ?? null;

    // El uso se mira despues de cada pagina: pasado el 90 % se corta aunque falten paginas.
    if (next && readUsage(usageHeader)?.shouldPause) {
      stopReason = "usage";
      break;
    }
  }

  return { ok: true, rows: rows as never, pages, stopReason, deletedRejected };
}

/** Desde cuando pedir en un sync incremental: la ultima vez completa menos un dia de margen. */
export function updatedSinceFor(catalogSyncedAt: string | null | undefined): Date | null {
  if (!catalogSyncedAt) return null;
  const at = new Date(catalogSyncedAt).getTime();
  if (Number.isNaN(at)) return null;
  return new Date(at - 86_400_000);
}
