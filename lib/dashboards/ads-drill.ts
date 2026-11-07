import type { CrmLevel } from "./ads-crm";

/**
 * Bajar de nivel dentro de la pantalla Anuncios: de una campaña a sus AdSets o a sus anuncios, y de un AdSet a sus anuncios,
 * sin salir de la pantalla. La pestaña vive en la URL (`nivel`); el padre elegido es un filtro más de campaña o conjunto
 * (`campana`, `conjunto`, en `ads-table-filters.ts`), así se ve como un chip y se saca igual que cualquier otro filtro.
 * Un link y el «atrás» del navegador muestran lo mismo. Puro: lo prueba `ads-drill.test.ts`.
 */

export type DrillTarget =
  | { kind: "drill"; label: string; level: CrmLevel; campaignIds: string[]; adsetIds: string[] }
  | { kind: "detail"; label: string };

const LEVEL_PARAM: Record<string, CrmLevel> = { campanas: "campaign", adsets: "adset", anuncios: "ad" };
const PARAM_OF_LEVEL: Record<CrmLevel, string> = { campaign: "campanas", adset: "adsets", ad: "anuncios" };

export function parseLevel(params: URLSearchParams): CrmLevel {
  return LEVEL_PARAM[params.get("nivel") ?? ""] ?? "campaign";
}

/** Escribe la pestaña en la URL sin tocar el resto (cuenta, período, filtros). Campañas es la de siempre: no se escribe. */
export function levelToParams(current: URLSearchParams, level: CrmLevel): URLSearchParams {
  const params = new URLSearchParams(current);
  params.delete("nivel");
  if (level !== "campaign") params.set("nivel", PARAM_OF_LEVEL[level]);
  return params;
}

/** Lo que ofrece el menu de una fila. Siempre se puede abrir el detalle, pero nunca sin pedirlo. */
export function drillTargets(level: CrmLevel, row: { objectId: string; campaignId: string | null }): DrillTarget[] {
  if (level === "campaign") {
    return [
      { kind: "drill", label: "Ver AdSets", level: "adset", campaignIds: [row.objectId], adsetIds: [] },
      { kind: "drill", label: "Ver anuncios", level: "ad", campaignIds: [row.objectId], adsetIds: [] },
      { kind: "detail", label: "Abrir el detalle de la campaña" },
    ];
  }
  if (level === "adset") {
    return [
      { kind: "drill", label: "Ver anuncios", level: "ad", campaignIds: row.campaignId ? [row.campaignId] : [], adsetIds: [row.objectId] },
      { kind: "detail", label: "Abrir el detalle del AdSet" },
    ];
  }
  return [{ kind: "detail", label: "Abrir el detalle del anuncio" }];
}
