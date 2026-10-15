/**
 * Las opciones del buscador del catalogo de Meta del selector "Cargar a mano" (Extra I, F47): un anuncio, un conjunto
 * o una campaña, dichos como "Campaña › Conjunto › Anuncio". Puro: los nombres los lee quien llama con la sesion.
 */

export type AdLevel = "ad" | "adset" | "campaign";

export interface AdOption {
  /** Para la clave de React y para no repetir: el id del nivel elegido. */
  key: string;
  level: AdLevel;
  adId: string | null;
  adsetId: string | null;
  campaignId: string | null;
  /** "Campaña X › Conjunto Y › Anuncio Z" (con el id si Meta no dio el nombre). */
  label: string;
}

interface Named {
  id: string;
  name: string | null;
}

const nameOrId = (kind: string, item: Named) => item.name?.trim() || `${kind} ${item.id}`;

/** Una opcion del buscador. Los padres que se conocen se suman al camino; los que no, no se inventan. */
export function buildAdOption(params: { level: AdLevel; ad?: Named | null; adset?: Named | null; campaign?: Named | null }): AdOption {
  const { level, ad, adset, campaign } = params;
  const parts = [
    campaign ? nameOrId("Campaña", campaign) : null,
    level !== "campaign" && adset ? nameOrId("Conjunto", adset) : null,
    level === "ad" && ad ? nameOrId("Anuncio", ad) : null,
  ].filter((p): p is string => !!p);

  const adId = level === "ad" ? (ad?.id ?? null) : null;
  const adsetId = level === "campaign" ? null : (adset?.id ?? null);
  const campaignId = campaign?.id ?? null;
  const own = level === "ad" ? adId : level === "adset" ? adsetId : campaignId;

  return { key: `${level}:${own ?? ""}`, level, adId, adsetId, campaignId, label: parts.join(" › ") || "Anuncio de Meta" };
}
