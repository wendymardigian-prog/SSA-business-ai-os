import { count, money, percent, type AdsTotals } from "@/lib/dashboards/ads";
import { kpiDelta } from "@/lib/dashboards/ads-view";
import type { KpiItem } from "./kpi-row";

/**
 * Las ocho cifras de arriba, iguales en el dashboard y en los detalles.
 *
 * La variacion es contra el periodo anterior; en un costo (CPM, CPC) subir es
 * malo, asi que la flecha hacia arriba sale roja. La frecuencia no lleva
 * variacion, como en la referencia.
 */
export function buildKpiItems(params: {
  totals: AdsTotals;
  previous: AdsTotals | null;
  currency: string | null;
  /** En un anuncio los clics salientes son los que importan. */
  clicksSub?: string;
}): KpiItem[] {
  const { totals, previous, currency } = params;
  const m = (value: number | null) => money(value, currency, { narrow: true });
  const delta = (key: keyof AdsTotals, invert = false) =>
    previous ? kpiDelta(totals[key], previous[key], { invert }) : null;

  return [
    { key: "spend", label: "Gasto total", value: m(totals.spend), sub: "presupuesto usado", delta: delta("spend") },
    { key: "impressions", label: "Impresiones", value: count(totals.impressions), sub: "total de vistas", delta: delta("impressions") },
    { key: "reach", label: "Alcance", value: count(totals.reach), sub: "cuentas únicas", delta: delta("reach") },
    { key: "frequency", label: "Frecuencia", value: totals.frequency?.toFixed(2) ?? "—", sub: "imp / persona", delta: null },
    { key: "clicks", label: "Clics", value: count(totals.clicks), sub: params.clicksSub ?? `CTR: ${percent(totals.ctr)}`, delta: delta("clicks") },
    { key: "cpm", label: "CPM", value: m(totals.cpm), sub: "por mil impr.", delta: delta("cpm", true) },
    { key: "cpc", label: "CPC", value: m(totals.cpc), sub: "por clic", delta: delta("cpc", true) },
    { key: "leads", label: "Leads", value: count(totals.leads), sub: `CPL: ${m(totals.cpl)}`, delta: delta("leads") },
  ];
}
