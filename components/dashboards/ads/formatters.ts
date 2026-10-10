/**
 * Formatos de los graficos de anuncios: ejes compactos y valores del tooltip.
 */

import { count, money, percent } from "@/lib/dashboards/ads";

/** El simbolo corto de la moneda ("$", "€"). */
export function currencySymbol(currency: string | null): string {
  try {
    const part = new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency: currency || "USD",
      currencyDisplay: "narrowSymbol",
    })
      .formatToParts(0)
      .find((p) => p.type === "currency");
    return part?.value ?? "$";
  } catch {
    return "$";
  }
}

/** 1500 → "1,5k". Para ejes: un numero entero largo no entra en 52 px. */
export function compact(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(".", ",")}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1).replace(".", ",")}k`;
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(".", ",");
}

export type ChartMetric =
  | "spend"
  | "impressions"
  | "clicks"
  | "reach"
  | "leads"
  | "cpm"
  | "cpc"
  | "cpl"
  | "ctr";

export const METRIC_LABELS: Record<ChartMetric, string> = {
  spend: "Gasto",
  impressions: "Impr.",
  clicks: "Clics",
  reach: "Alcance",
  leads: "Leads",
  cpm: "CPM",
  cpc: "CPC",
  cpl: "CPL",
  ctr: "CTR",
};

/** Las opciones de cada eje, en el orden de la referencia. */
export const LEFT_OPTIONS: ChartMetric[] = ["spend", "impressions", "clicks", "reach", "leads", "cpm", "cpc"];
export const RIGHT_OPTIONS: ChartMetric[] = ["ctr", "spend", "impressions", "clicks", "leads", "cpm", "cpc"];

const MONEY_METRICS: ChartMetric[] = ["spend", "cpm", "cpc", "cpl"];

/** El valor de una metrica para el eje (corto). */
export function axisValue(metric: ChartMetric, value: number, currency: string | null): string {
  if (MONEY_METRICS.includes(metric)) return `${currencySymbol(currency)}${compact(value)}`;
  if (metric === "ctr") return `${compact(value)}%`;
  return compact(Math.round(value));
}

/** El valor de una metrica para el tooltip (completo). */
export function tooltipValue(metric: ChartMetric, value: number, currency: string | null): string {
  if (MONEY_METRICS.includes(metric)) return money(value, currency, { narrow: true });
  if (metric === "ctr") return percent(value);
  return count(Math.round(value));
}
