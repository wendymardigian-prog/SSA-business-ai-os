/**
 * Los detalles de una campaña, un conjunto o un anuncio (F57).
 *
 * La regla que define el archivo: **un detalle muestra SOLO lo suyo**. Abrir
 * una campaña y ver los anuncios de otra es peor que no tener la pantalla,
 * porque las conclusiones que sacan de ahi son falsas.
 *
 * Filtrar en memoria y no en la base es a proposito: ya se leyeron todas las
 * filas del periodo para el dashboard, y son cientos. Cuatro consultas mas
 * por cada detalle abierto no cambiarian nada salvo la latencia.
 */

import { computeTotals, groupByObject, type AdsRow, type AdsTotals, type GroupedRow } from "./ads";

export type DetailLevel = "campaign" | "adset" | "ad";

export interface Breadcrumb {
  label: string;
  href: string | null;
}

/**
 * Las migas de pan hasta el objeto abierto.
 *
 * La cuenta y el periodo viajan en cada link: volver atras con otra cuenta
 * seleccionada mostraria numeros de otra cuenta sin que nadie lo pida.
 */
export function breadcrumbs(params: {
  level: DetailLevel;
  campaign?: { id: string; name: string | null } | null;
  adset?: { id: string; name: string | null } | null;
  ad?: { name: string | null } | null;
  adAccountId: string;
  period: string;
}): Breadcrumb[] {
  const query = `?cuenta=${encodeURIComponent(params.adAccountId)}&periodo=${encodeURIComponent(params.period)}`;
  const crumbs: Breadcrumb[] = [{ label: "Meta Ads", href: `/dashboard/dashboards/ads${query}` }];

  if (params.campaign) {
    crumbs.push({
      label: params.campaign.name || params.campaign.id,
      href:
        params.level === "campaign"
          ? null
          : `/dashboard/dashboards/ads/campaigns/${params.campaign.id}${query}`,
    });
  }

  if (params.adset) {
    crumbs.push({
      label: params.adset.name || params.adset.id,
      href:
        params.level === "adset" ? null : `/dashboard/dashboards/ads/adsets/${params.adset.id}${query}`,
    });
  }

  if (params.ad) crumbs.push({ label: params.ad.name || "Anuncio", href: null });

  return crumbs;
}

/**
 * Las filas que pertenecen al objeto abierto.
 *
 * Para una campaña: sus propias filas, sus conjuntos y sus anuncios. Para un
 * conjunto: el conjunto y sus anuncios. Para un anuncio: solo el.
 */
export function rowsFor(
  rows: AdsRow[],
  params: { level: DetailLevel; objectId: string },
): AdsRow[] {
  if (params.level === "campaign") {
    return rows.filter(
      (row) =>
        (row.level === "campaign" && row.objectId === params.objectId) ||
        ((row.level === "adset" || row.level === "ad") && row.campaignId === params.objectId),
    );
  }

  if (params.level === "adset") {
    return rows.filter(
      (row) =>
        (row.level === "adset" && row.objectId === params.objectId) ||
        (row.level === "ad" && row.adsetId === params.objectId),
    );
  }

  return rows.filter((row) => row.level === "ad" && row.objectId === params.objectId);
}

/** Las filas propias del objeto, que son de las que salen sus totales. */
export function ownRows(rows: AdsRow[], params: { level: DetailLevel; objectId: string }): AdsRow[] {
  return rows.filter((row) => row.level === params.level && row.objectId === params.objectId);
}

export interface DetailView {
  objectId: string;
  objectName: string | null;
  status: string | null;
  campaignId: string | null;
  adsetId: string | null;
  totals: AdsTotals;
  /** Los hijos directos: conjuntos de una campaña, anuncios de un conjunto. */
  children: GroupedRow[];
  /** Todos los anuncios que cuelgan, para la pestaña de anuncios. */
  ads: GroupedRow[];
  /** Las filas diarias propias, para los graficos. */
  daily: AdsRow[];
}

/** Todo lo que necesita la pantalla de detalle, filtrado. */
export function buildDetail(params: {
  rows: AdsRow[];
  level: DetailLevel;
  objectId: string;
  uniqueReach?: number | null;
}): DetailView | null {
  const own = ownRows(params.rows, params);
  // Sin filas propias no hay detalle que mostrar: el objeto no tuvo
  // actividad en este periodo, o no es de esta cuenta.
  if (own.length === 0) return null;

  const latest = [...own].sort((a, b) => b.date.localeCompare(a.date))[0];
  const scoped = rowsFor(params.rows, params);

  const childLevel: "adset" | "ad" | null =
    params.level === "campaign" ? "adset" : params.level === "adset" ? "ad" : null;

  return {
    objectId: params.objectId,
    objectName: latest.objectName,
    status: latest.effectiveStatus ?? latest.status,
    campaignId: latest.campaignId,
    adsetId: latest.adsetId,
    totals: computeTotals(own, params.uniqueReach),
    children: childLevel ? groupByObject(scoped, childLevel) : [],
    ads: groupByObject(scoped, "ad"),
    daily: own,
  };
}

export interface Budget {
  /** Diario o total. */
  kind: "daily" | "lifetime";
  amount: number;
  spent: number;
  remaining: number | null;
  /** Que porcentaje se gasto. */
  percent: number | null;
}

/**
 * La barra de presupuesto.
 *
 * En un presupuesto DIARIO no tiene sentido hablar de "restante" del
 * periodo: se renueva cada dia. Lo que se compara es el gasto promedio
 * diario contra el tope diario.
 */
export function budgetProgress(params: {
  dailyBudget: number | null;
  lifetimeBudget: number | null;
  spent: number | null;
  days: number;
}): Budget | null {
  const spent = params.spent ?? 0;

  if (params.lifetimeBudget) {
    const remaining = Math.max(0, params.lifetimeBudget - spent);
    return {
      kind: "lifetime",
      amount: params.lifetimeBudget,
      spent,
      remaining,
      percent: Number(((spent / params.lifetimeBudget) * 100).toFixed(1)),
    };
  }

  if (params.dailyBudget) {
    const perDay = params.days > 0 ? spent / params.days : 0;
    return {
      kind: "daily",
      amount: params.dailyBudget,
      spent: Number(perDay.toFixed(2)),
      // Un presupuesto diario no tiene restante del periodo: se renueva.
      remaining: null,
      percent: Number(((perDay / params.dailyBudget) * 100).toFixed(1)),
    };
  }

  return null;
}

/** Los otros anuncios de la misma campaña, para el selector del detalle. */
export function siblingAds(
  rows: AdsRow[],
  params: { campaignId: string | null; currentAdId: string },
): Array<{ id: string; name: string | null }> {
  if (!params.campaignId) return [];

  const byId = new Map<string, string | null>();
  for (const row of rows) {
    if (row.level !== "ad" || row.campaignId !== params.campaignId) continue;
    if (row.objectId === params.currentAdId) continue;
    byId.set(row.objectId, row.objectName);
  }

  return [...byId.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id));
}

/** Los rankings del anuncio, en castellano. */
export const RANKING_LABELS: Record<string, string> = {
  ABOVE_AVERAGE: "Arriba del promedio",
  AVERAGE: "En el promedio",
  BELOW_AVERAGE_35: "Abajo del promedio (35% inferior)",
  BELOW_AVERAGE_20: "Abajo del promedio (20% inferior)",
  BELOW_AVERAGE_10: "Abajo del promedio (10% inferior)",
  UNKNOWN: "Sin datos suficientes",
};

export function rankingLabel(ranking: string | null): string {
  if (!ranking) return "Sin datos suficientes";
  return RANKING_LABELS[ranking] ?? ranking;
}
