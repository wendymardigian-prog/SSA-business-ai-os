/**
 * Por donde salen las metricas de cada red (G7).
 *
 * Reemplaza al "selector de fuente de metricas" que no tenia sentido: no hay
 * nada que elegir, Postproxy no lee metricas de nada. Esto es informativo, un
 * espejo en palabras del `switch` de `readAccount()` en
 * lib/jobs/handlers/metrics-sync.ts. El test de este archivo lee ese switch y
 * falla si aparece una plataforma sin su linea.
 */

export type MetricsPlatform = "instagram" | "tiktok" | "threads" | "youtube" | "linkedin";

export const METRICS_SOURCE_LINES: Record<MetricsPlatform, string> = {
  instagram: "Las metricas de Instagram salen de Zernio.",
  tiktok: "Las metricas de TikTok salen de Zernio.",
  threads: "Las metricas de Threads salen de su propia API.",
  youtube: "Las metricas de YouTube salen de Google.",
  linkedin: "LinkedIn no permite leer metricas de publicaciones desde afuera.",
};

/** `null` si la plataforma no es una de las cinco que publican (no hay metricas que leer). */
export function metricsSourceLine(platform: string): string | null {
  return METRICS_SOURCE_LINES[platform as MetricsPlatform] ?? null;
}
