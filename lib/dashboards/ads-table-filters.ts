/**
 * Los filtros de la pantalla Anuncios: buscador, estado, campaña y conjunto, objetivo, gasto y orden. Viven en la URL (así un
 * link y el «atrás» del navegador muestran lo mismo) y se aplican sobre las filas que ya están en la página: filtrar no le pide
 * nada al servidor.
 *
 * Parámetros: `q`, `estado` (`activos|pausados`), `campana` y `conjunto` (ids separados por coma; un solo id, como lo deja
 * «Ver AdSets» del menú de una fila, sigue valiendo), `objetivo` (separados por coma), `gasto_min`, `gasto_max`, `con_gasto=1`,
 * `con_leads=1` y `orden` (`ads-table-view.ts`). Lo que no parece un id o un número se ignora: viene de la URL.
 *
 * Campaña y conjunto valen en las tres pestañas:
 *  - Campaña: en Campañas, esas campañas; en AdSets y Anuncios, lo que cuelga de ellas.
 *  - Conjunto: en AdSets, esos conjuntos; en Anuncios, sus anuncios; en Campañas, las campañas que los contienen.
 *
 * Modulo puro: lo prueba `ads-table-filters.test.ts`.
 */

import { foldText } from "@/lib/ui/multi-filter";
import type { CrmLevel, CrmRow, StatusFilter } from "./ads-crm";
import { parseSort, serializeSort, type SortState } from "./ads-table-view";

export interface AdsTableFilters {
  q: string;
  status: StatusFilter;
  campaignIds: string[];
  adsetIds: string[];
  objectives: string[];
  /** En la moneda de la cuenta. */
  spendMin: number | null;
  spendMax: number | null;
  withSpend: boolean;
  withLeads: boolean;
  sort: SortState | null;
}

export const EMPTY_FILTERS: AdsTableFilters = {
  q: "",
  status: "all",
  campaignIds: [],
  adsetIds: [],
  objectives: [],
  spendMin: null,
  spendMax: null,
  withSpend: false,
  withLeads: false,
  sort: null,
};

/** Todo lo que escribe este módulo en la URL (para limpiar sin tocar la cuenta, el período ni la pestaña). */
export const FILTER_PARAMS = ["q", "estado", "campana", "conjunto", "objetivo", "gasto_min", "gasto_max", "con_gasto", "con_leads", "orden"] as const;

const STATUS_PARAM: Record<string, StatusFilter> = { activos: "active", pausados: "paused" };
const PARAM_OF_STATUS: Record<StatusFilter, string | null> = { all: null, active: "activos", paused: "pausados" };

/** Un id de Meta. */
const safeId = (raw: string): boolean => /^[\w-]{1,64}$/.test(raw);
/** Un objetivo de Meta (OUTCOME_LEADS, LEAD_GENERATION…). */
const safeObjective = (raw: string): boolean => /^[A-Z0-9_]{1,64}$/.test(raw);

function list(raw: string | null, valid: (value: string) => boolean): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(",").map((v) => v.trim()).filter(valid))].slice(0, 100);
}

/** Un monto: número positivo con punto o coma decimal. Lo demás, sin filtro. */
export function parseAmount(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const clean = raw.trim().replace(",", ".");
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(clean)) return null;
  return Number(clean);
}

export function parseAdsTableFilters(params: URLSearchParams): AdsTableFilters {
  return {
    q: (params.get("q") ?? "").trim().slice(0, 200),
    status: STATUS_PARAM[params.get("estado") ?? ""] ?? "all",
    campaignIds: list(params.get("campana"), safeId),
    adsetIds: list(params.get("conjunto"), safeId),
    objectives: list(params.get("objetivo"), safeObjective),
    spendMin: parseAmount(params.get("gasto_min")),
    spendMax: parseAmount(params.get("gasto_max")),
    withSpend: params.get("con_gasto") === "1",
    withLeads: params.get("con_leads") === "1",
    sort: parseSort(params.get("orden")),
  };
}

/** Escribe los filtros en la URL sin tocar el resto (cuenta, período, pestaña). Lo vacío no se escribe. */
export function adsTableFiltersToParams(current: URLSearchParams, filters: AdsTableFilters): URLSearchParams {
  const params = new URLSearchParams(current);
  for (const key of FILTER_PARAMS) params.delete(key);
  const set = (key: string, value: string | null) => {
    if (value) params.set(key, value);
  };
  set("q", filters.q.trim() || null);
  set("estado", PARAM_OF_STATUS[filters.status]);
  set("campana", filters.campaignIds.join(",") || null);
  set("conjunto", filters.adsetIds.join(",") || null);
  set("objetivo", filters.objectives.join(",") || null);
  set("gasto_min", filters.spendMin !== null ? String(filters.spendMin) : null);
  set("gasto_max", filters.spendMax !== null ? String(filters.spendMax) : null);
  set("con_gasto", filters.withSpend ? "1" : null);
  set("con_leads", filters.withLeads ? "1" : null);
  set("orden", serializeSort(filters.sort));
  return params;
}

/** Al cambiar de cuenta: campaña y conjunto son de la cuenta anterior, se sacan; lo demás se conserva. */
export function withoutAccountFilters(filters: AdsTableFilters): AdsTableFilters {
  return { ...filters, campaignIds: [], adsetIds: [] };
}

export interface FilterContext {
  level: CrmLevel;
  /** El objetivo de cada campaña (del catálogo), para filtrar conjuntos y anuncios por el objetivo de su campaña. */
  campaignObjective: (campaignId: string) => string | null;
  /** Las campañas de los conjuntos elegidos (para filtrar campañas por conjunto). */
  campaignOfAdset: (adsetId: string) => string | null;
}

/** Lo que filtra la tabla, SIN el estado (que tiene su propio contador) ni el orden. */
export function applyAdsTableFilters(rows: CrmRow[], filters: AdsTableFilters, ctx: FilterContext): CrmRow[] {
  const q = foldText(filters.q.trim());
  const campaigns = new Set(filters.campaignIds);
  const adsets = new Set(filters.adsetIds);
  const objectives = new Set(filters.objectives);
  const campaignsOfAdsets = new Set(filters.adsetIds.map(ctx.campaignOfAdset).filter((c): c is string => !!c));

  return rows.filter((row) => {
    const campaignId = ctx.level === "campaign" ? row.objectId : row.campaignId;
    if (q && !foldText(row.name || row.objectId).includes(q)) return false;
    if (campaigns.size > 0 && !(campaignId && campaigns.has(campaignId))) return false;
    if (adsets.size > 0) {
      if (ctx.level === "campaign" && !campaignsOfAdsets.has(row.objectId)) return false;
      if (ctx.level === "adset" && !adsets.has(row.objectId)) return false;
      if (ctx.level === "ad" && !(row.adsetId && adsets.has(row.adsetId))) return false;
    }
    if (objectives.size > 0) {
      const objective = ctx.level === "campaign" ? row.objective : campaignId ? ctx.campaignObjective(campaignId) : null;
      if (!objective || !objectives.has(objective)) return false;
    }
    const spend = row.spend ?? 0;
    if (filters.withSpend && !(spend > 0)) return false;
    if (filters.withLeads && !(row.leadsTotal > 0)) return false;
    if (filters.spendMin !== null && spend < filters.spendMin) return false;
    if (filters.spendMax !== null && spend > filters.spendMax) return false;
    return true;
  });
}

/** ¿Hay algo que achica la tabla (búsqueda, estado o un filtro del menú)? El orden no cuenta: no saca filas. */
export function hasActiveFilters(filters: AdsTableFilters): boolean {
  return filters.q.trim() !== "" || filters.status !== "all" || countMenuFilters(filters) > 0;
}

/** Los filtros puestos dentro del botón «Filtros» (el globito). Búsqueda y estado tienen su propio control. */
export function countMenuFilters(filters: AdsTableFilters): number {
  return (
    (filters.campaignIds.length > 0 ? 1 : 0) +
    (filters.adsetIds.length > 0 ? 1 : 0) +
    (filters.objectives.length > 0 ? 1 : 0) +
    (filters.spendMin !== null || filters.spendMax !== null ? 1 : 0) +
    (filters.withSpend ? 1 : 0) +
    (filters.withLeads ? 1 : 0)
  );
}

export interface FilterChip {
  key: string;
  label: string;
  /** Como quedan los filtros al sacar este. */
  clear: AdsTableFilters;
}

/** Los filtros del menú puestos, para mostrarlos arriba de la tabla y sacarlos con una X. */
export function activeFilterChips(
  filters: AdsTableFilters,
  names: { campaign: (id: string) => string | null; adset: (id: string) => string | null; objective: (value: string) => string; money: (value: number) => string },
): FilterChip[] {
  const chips: FilterChip[] = [];
  const many = (ids: string[], nameOf: (id: string) => string | null, singular: string, plural: string) =>
    ids.length === 1 ? `${singular}: ${nameOf(ids[0]) ?? "sin nombre"}` : `${ids.length} ${plural}`;

  if (filters.campaignIds.length > 0) {
    chips.push({ key: "campaign", label: many(filters.campaignIds, names.campaign, "Campaña", "campañas"), clear: { ...filters, campaignIds: [] } });
  }
  if (filters.adsetIds.length > 0) {
    chips.push({ key: "adset", label: many(filters.adsetIds, names.adset, "AdSet", "AdSets"), clear: { ...filters, adsetIds: [] } });
  }
  if (filters.objectives.length > 0) {
    const label = filters.objectives.length === 1 ? `Objetivo: ${names.objective(filters.objectives[0])}` : `${filters.objectives.length} objetivos`;
    chips.push({ key: "objective", label, clear: { ...filters, objectives: [] } });
  }
  if (filters.spendMin !== null || filters.spendMax !== null) {
    const label =
      filters.spendMin !== null && filters.spendMax !== null
        ? `Gasto entre ${names.money(filters.spendMin)} y ${names.money(filters.spendMax)}`
        : filters.spendMin !== null
          ? `Gasto desde ${names.money(filters.spendMin)}`
          : `Gasto hasta ${names.money(filters.spendMax as number)}`;
    chips.push({ key: "spend", label, clear: { ...filters, spendMin: null, spendMax: null } });
  }
  if (filters.withSpend) chips.push({ key: "withSpend", label: "Con gasto", clear: { ...filters, withSpend: false } });
  if (filters.withLeads) chips.push({ key: "withLeads", label: "Con leads", clear: { ...filters, withLeads: false } });
  return chips;
}

/** Saca todos los filtros del menú, la búsqueda y el estado. El orden queda: no es un filtro. */
export function clearFilters(filters: AdsTableFilters): AdsTableFilters {
  return { ...EMPTY_FILTERS, sort: filters.sort };
}
