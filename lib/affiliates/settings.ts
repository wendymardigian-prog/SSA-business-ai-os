// @plantilla-quitar(ventas)
/**
 * Las reglas de afiliados (F72, `workspaces.affiliate_settings`). Puro; la gemela SQL es
 * `public.validate_affiliate_settings` (00343) y las dos corren `affiliate-settings.cases.json`: mismos textos y orden.
 */
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const REPLACE = ["keep", "last", "last_if_not_bought"];
const intIn = (v: unknown, min: number, max: number) => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

export const REPLACE_LABELS: Record<string, string> = {
  keep: "Se queda el que estaba",
  last: "Gana el último",
  last_if_not_bought: "Gana el último, salvo que ya haya comprado",
};

export const LEAD_NAME_LABELS: Record<string, string> = {
  first_name_initial: "Nombre e inicial (Ana P.)",
  full: "Nombre completo",
  hidden: "No mostrar el nombre",
};

export function validateAffiliateSettings(p: unknown): string[] {
  if (!isObj(p)) return ["las reglas no son válidas"];
  const v: string[] = [];
  if ("originated" in p) {
    const o = p.originated;
    if (!isObj(o)) v.push("la regla de «lo trajo» no es válida");
    else {
      if ("months" in o && o.months !== null && !intIn(o.months, 1, 120)) v.push("«lo trajo» dura de 1 a 120 meses (o de por vida)");
      if ("replace" in o && !REPLACE.includes(o.replace as string)) v.push("elegí qué pasa con otro afiliado sobre un «lo trajo»");
    }
  }
  if ("influenced" in p) {
    const i = p.influenced;
    if (!isObj(i)) v.push("la regla de «influyó» no es válida");
    else {
      if ("days" in i && !intIn(i.days, 1, 3650)) v.push("«influyó» dura de 1 a 3650 días");
      if ("renew_on_click" in i && typeof i.renew_on_click !== "boolean") v.push("«un clic nuevo corre la fecha» tiene que ser sí o no");
      if ("replace" in i && !REPLACE.includes(i.replace as string)) v.push("elegí qué pasa con otro afiliado sobre un «influyó»");
    }
  }
  if ("counts" in p && (!isObj(p.counts) || ("first_purchase_only" in p.counts && typeof p.counts.first_purchase_only !== "boolean"))) {
    v.push("«solo la primera compra» tiene que ser sí o no");
  }
  if ("show_lead_names" in p && !["first_name_initial", "full", "hidden"].includes(p.show_lead_names as string)) v.push("elegí cómo se ven los nombres de los referidos");
  return v;
}
