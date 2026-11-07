import type { CrmLevel, ParentScope } from "./ads-crm";

/**
 * Bajar de nivel dentro de la pantalla Anuncios: de una campaña a sus AdSets o a sus anuncios, y de un AdSet a sus anuncios,
 * sin salir de la pantalla. Vive en la URL (`nivel`, `campana` y `conjunto`), asi un link y el «atrás» del navegador muestran
 * lo mismo. Puro: lo prueba `ads-drill.test.ts`.
 */

export interface DrillState {
  level: CrmLevel;
  campaignId: string | null;
  adsetId: string | null;
}

export type DrillTarget =
  | { kind: "drill"; label: string; state: DrillState }
  | { kind: "detail"; label: string };

const LEVEL_PARAM: Record<string, CrmLevel> = { campanas: "campaign", adsets: "adset", anuncios: "ad" };
const PARAM_OF_LEVEL: Record<CrmLevel, string> = { campaign: "campanas", adset: "adsets", ad: "anuncios" };
const DRILL_PARAMS = ["nivel", "campana", "conjunto"];

/** Un id de Meta. Lo que no lo parece se ignora: viene de la URL. */
function safeId(raw: string | null): string | null {
  return raw && /^[\w-]{1,64}$/.test(raw) ? raw : null;
}

export function parseDrill(params: URLSearchParams): DrillState {
  const level = LEVEL_PARAM[params.get("nivel") ?? ""] ?? "campaign";
  // Un filtro que no le corresponde al nivel no se aplica: en Campañas no hay padre.
  const campaignId = level === "campaign" ? null : safeId(params.get("campana"));
  const adsetId = level === "ad" ? safeId(params.get("conjunto")) : null;
  return { level, campaignId, adsetId };
}

/** Escribe lo elegido en la URL sin tocar el resto (cuenta, periodo). */
export function drillToParams(current: URLSearchParams, state: DrillState): URLSearchParams {
  const params = new URLSearchParams(current);
  for (const key of DRILL_PARAMS) params.delete(key);
  if (state.level !== "campaign") params.set("nivel", PARAM_OF_LEVEL[state.level]);
  if (state.level !== "campaign" && state.campaignId) params.set("campana", state.campaignId);
  if (state.level === "ad" && state.adsetId) params.set("conjunto", state.adsetId);
  return params;
}

/** El padre por el que se filtra la tabla: el AdSet si hay, si no la campaña. */
export function drillScope(state: DrillState): ParentScope | null {
  if (state.level === "ad" && state.adsetId) return { level: "adset", id: state.adsetId };
  if (state.level !== "campaign" && state.campaignId) return { level: "campaign", id: state.campaignId };
  return null;
}

/** Cambiar de pestaña: se conserva el filtro que todavia tiene sentido. Campañas no tiene padre, asi que lo limpia. */
export function withLevel(state: DrillState, level: CrmLevel): DrillState {
  return {
    level,
    campaignId: level === "campaign" ? null : state.campaignId,
    adsetId: level === "ad" ? state.adsetId : null,
  };
}

/** Lo que ofrece el menu de una fila. Siempre se puede abrir el detalle, pero nunca sin pedirlo. */
export function drillTargets(level: CrmLevel, row: { objectId: string; campaignId: string | null }): DrillTarget[] {
  if (level === "campaign") {
    return [
      { kind: "drill", label: "Ver AdSets", state: { level: "adset", campaignId: row.objectId, adsetId: null } },
      { kind: "drill", label: "Ver anuncios", state: { level: "ad", campaignId: row.objectId, adsetId: null } },
      { kind: "detail", label: "Abrir el detalle de la campaña" },
    ];
  }
  if (level === "adset") {
    return [
      { kind: "drill", label: "Ver anuncios", state: { level: "ad", campaignId: row.campaignId, adsetId: row.objectId } },
      { kind: "detail", label: "Abrir el detalle del AdSet" },
    ];
  }
  return [{ kind: "detail", label: "Abrir el detalle del anuncio" }];
}

export interface DrillChip {
  key: "campaign" | "adset";
  /** «Campaña» o «AdSet». */
  label: string;
  /** Null: no se conoce el nombre. */
  name: string | null;
  /** Como queda todo al sacar este filtro. */
  clear: DrillState;
}

/** Los filtros puestos, para mostrarlos arriba de la tabla y poder sacarlos. */
export function drillChips(state: DrillState, nameOf: (level: "campaign" | "adset", id: string) => string | null): DrillChip[] {
  const chips: DrillChip[] = [];
  if (state.campaignId) {
    chips.push({ key: "campaign", label: "Campaña", name: nameOf("campaign", state.campaignId), clear: { level: state.level, campaignId: null, adsetId: null } });
  }
  if (state.adsetId) {
    chips.push({ key: "adset", label: "AdSet", name: nameOf("adset", state.adsetId), clear: { level: state.level, campaignId: state.campaignId, adsetId: null } });
  }
  return chips;
}
