import { count, money, percent, type AdsTotals } from "@/lib/dashboards/ads";
import { kpiDelta } from "@/lib/dashboards/ads-view";
import type { crmLeadsSummary } from "@/lib/dashboards/ads-crm";
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
  /** Lo que dice el CRM de toda la cuenta (dashboard principal). Sin esto no hay tarjeta «Leads CRM». */
  crmLeads?: ReturnType<typeof crmLeadsSummary> | null;
}): KpiItem[] {
  const { totals, previous, currency } = params;
  const m = (value: number | null) => money(value, currency, { narrow: true });
  const delta = (key: keyof AdsTotals, invert = false) =>
    previous ? kpiDelta(totals[key], previous[key], { invert }) : null;

  const items: KpiItem[] = [
    { key: "spend", label: "Gasto total", value: m(totals.spend), sub: "presupuesto usado", delta: delta("spend"), tip: "Lo que Meta cobró por mostrar estos anuncios en el período elegido." },
    { key: "impressions", label: "Impresiones", value: count(totals.impressions), sub: "total de vistas", delta: delta("impressions"), tip: "Las veces que Meta mostró el anuncio. Una misma persona puede sumar varias." },
    { key: "reach", label: "Alcance", value: count(totals.reach), sub: "cuentas únicas", delta: delta("reach"), tip: "Cuántas personas distintas vieron el anuncio al menos una vez en el período. Si Meta no responde en el momento, es la suma de los días: puede contar dos veces a alguien." },
    { key: "frequency", label: "Frecuencia", value: totals.frequency?.toFixed(2) ?? "—", sub: "imp / persona", delta: null, tip: "Cuántas veces vio el anuncio cada persona, en promedio: impresiones ÷ alcance. Por encima de 3 o 4 la gente se puede cansar de verlo." },
    { key: "clicks", label: "Clics", value: count(totals.clicks), sub: params.clicksSub ?? `CTR: ${percent(totals.ctr)}`, delta: delta("clicks"), tip: "Todos los clics en el anuncio, también los que no llevan a tu destino (como el perfil o «ver más»). El CTR es clics ÷ impresiones." },
    { key: "cpm", label: "CPM", value: m(totals.cpm), sub: "por mil impr.", delta: delta("cpm", true), tip: "Cuánto cuesta que el anuncio se muestre mil veces: gasto ÷ impresiones × 1.000. Si sube, la flecha sale en rojo: es más caro." },
    { key: "cpc", label: "CPC", value: m(totals.cpc), sub: "por clic", delta: delta("cpc", true), tip: "Cuánto cuesta cada clic: gasto ÷ clics. Si sube, la flecha sale en rojo: es más caro." },
    // La cifra de Meta lleva su nombre: «Leads» a secas se confundia con la del CRM.
    { key: "leads", label: "Leads Meta", value: count(totals.leads), sub: `CPL: ${m(totals.cpl)}`, delta: delta("leads"), tip: "Los leads que reporta Meta (su píxel o sus formularios). Pueden no coincidir con los de tu CRM: Meta los atribuye con su propio criterio, y no todos llegan a ser un contacto. El CPL es gasto ÷ estos leads." },
  ];

  const crm = params.crmLeads;
  if (crm) {
    items.push({
      key: "leads-crm",
      label: "Leads CRM",
      value: `${count(crm.leadsNew)} · ${count(crm.leadsTotal)}`,
      sub: `CPL ${m(crm.cplNew)} nuevo · ${m(crm.cplTotal)} total`,
      delta: null,
      tip: "Nuevos · totales. Leads nuevos: personas cuyo primer contacto fue un anuncio (cuentan una sola vez en su vida). Leads totales: personas con algún toque de un anuncio en el período. CPL nuevo = gasto ÷ nuevos; CPL total = gasto ÷ totales.",
    });
  }
  return items;
}
