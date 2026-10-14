/**
 * Cómo se muestra la atribución de una respuesta (F13, F33): agrupada, con
 * nombres legibles y en este orden — primero los UTM, después el anuncio, el
 * navegador, de dónde vino y la primera visita si es distinta. Puro.
 */
import { AD_KEYS, CLICK_ID_KEYS, UTM_KEYS } from "@/lib/attribution/keys";

export interface AttributionItem {
  key: string;
  label: string;
  value: string;
}

export interface AttributionSection {
  title: string;
  items: AttributionItem[];
}

const LABELS: Record<string, string> = {
  utm_source: "Fuente (utm_source)",
  utm_medium: "Medio (utm_medium)",
  utm_campaign: "Campaña (utm_campaign)",
  utm_term: "Término (utm_term)",
  utm_content: "Contenido (utm_content)",
  utm_id: "Id de campaña (utm_id)",
  fbclid: "Clic de Meta (fbclid)",
  gclid: "Clic de Google (gclid)",
  gbraid: "Clic de Google iOS (gbraid)",
  wbraid: "Clic de Google web a app (wbraid)",
  msclkid: "Clic de Microsoft (msclkid)",
  ttclid: "Clic de TikTok (ttclid)",
  li_fat_id: "Clic de LinkedIn (li_fat_id)",
  twclid: "Clic de X (twclid)",
  sccid: "Clic de Snapchat (sccid)",
  epik: "Clic de Pinterest (epik)",
  rdt_cid: "Clic de Reddit (rdt_cid)",
  ad_id: "Id del anuncio",
  adset_id: "Id del conjunto de anuncios",
  campaign_id: "Id de la campaña",
  placement: "Ubicación",
  fbp: "Navegador de Meta (fbp)",
  fbc: "Clic de Meta guardado (fbc)",
  ga_client_id: "Cliente de Google Analytics",
  landing_page: "Página de llegada",
  page_url: "Página del envío",
  referrer_url: "De dónde vino",
};

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function itemsOf(attribution: Record<string, unknown>, keys: readonly string[]): AttributionItem[] {
  return keys.flatMap((key) => {
    const value = str(attribution[key]);
    return value ? [{ key, label: LABELS[key] ?? key, value }] : [];
  });
}

export function attributionSections(attribution: Record<string, unknown> | null | undefined): AttributionSection[] {
  const a = attribution ?? {};
  const sections: AttributionSection[] = [
    { title: "Campaña", items: itemsOf(a, UTM_KEYS) },
    { title: "Anuncio", items: itemsOf(a, [...CLICK_ID_KEYS, ...AD_KEYS]) },
    { title: "Navegador", items: itemsOf(a, ["fbp", "fbc", "ga_client_id"]) },
    { title: "Páginas", items: itemsOf(a, ["landing_page", "page_url", "referrer_url"]) },
  ];

  const first = a.first_visit;
  if (first && typeof first === "object" && !Array.isArray(first)) {
    const visit = first as Record<string, unknown>;
    const items = itemsOf(visit, [...UTM_KEYS, ...CLICK_ID_KEYS, ...AD_KEYS, "landing_page", "referrer_url"]);
    // Solo se muestra si aporta algo distinto de la visita actual.
    const different = items.filter((i) => str(a[i.key]) !== i.value);
    if (different.length > 0) sections.push({ title: "Primera visita", items: different });
  }
  return sections.filter((s) => s.items.length > 0);
}

/**
 * La URL de entrada completa de la respuesta (plano formularios-ui, F19), o null. Va APARTE de las secciones:
 * no reemplaza nada de lo que ya se muestra (UTM, anuncio, navegador, de donde vino).
 */
export function entryUrlOf(attribution: Record<string, unknown> | null | undefined): string | null {
  const value = attribution?.entry_url;
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}
