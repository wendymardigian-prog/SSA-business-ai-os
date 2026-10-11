/**
 * Que muestra la ficha de una llamada segun su estado (F13). Puro: el
 * componente solo lo compone.
 *
 * Seis estados del analisis, un banner para cada uno que lo necesita, y
 * mientras no haya analisis las pestañas Resumen / Closer / Lead / Tecnico
 * dicen "Todavia no se analizo" con el motivo.
 */

import type { CallAnalysisStatus } from "@/lib/types/database";
import { statusReasonText } from "./status";

export type DetailTab = "resumen" | "closer" | "lead" | "tecnico";
export const DETAIL_TABS: ReadonlyArray<{ key: DetailTab; label: string }> = [
  { key: "resumen", label: "Resumen" },
  { key: "closer", label: "Closer" },
  { key: "lead", label: "Lead" },
  { key: "tecnico", label: "Técnico" },
];

export type BannerTone = "info" | "warning" | "error" | "neutral";
export type BannerAction = "choose_type" | "analyze" | "retry" | "config" | null;

export interface DetailBanner {
  tone: BannerTone;
  title: string;
  message: string;
  /** Que boton acompaña al banner (si quien mira puede usarlo). */
  action: BannerAction;
  /** El boton esta, pero deshabilitado: por que (para el tooltip). */
  actionDisabledReason?: string | null;
  spinner?: boolean;
}

export interface DetailViewInput {
  status: CallAnalysisStatus;
  reason: string | null;
  error: string | null;
  hasAnalysis: boolean;
  canEdit: boolean;
  canConfigure: boolean;
  /** Resultado de `canAnalyze` para el boton Analizar. */
  analyze: { ok: boolean; reason?: string };
}

export interface DetailView {
  /** Las pestañas del analisis tienen contenido. */
  analysisAvailable: boolean;
  banner: DetailBanner | null;
  /** Lo que dicen las pestañas cuando no hay analisis. */
  emptyMessage: string | null;
}

export function detailView(input: DetailViewInput): DetailView {
  const analysisAvailable = input.status === "analyzed" && input.hasAnalysis;
  const reasonText = statusReasonText(input.status, input.reason);

  const none = (message: string): DetailView => ({ analysisAvailable: false, banner: null, emptyMessage: message });

  switch (input.status) {
    case "classifying":
      return {
        analysisAvailable: false,
        emptyMessage: "Todavía no se analizó: se está clasificando la llamada.",
        banner: { tone: "info", title: "Clasificando…", message: "Se está decidiendo qué tipo de llamada es.", action: null, spinner: true },
      };
    case "needs_review":
      return {
        analysisAvailable: false,
        emptyMessage: "Todavía no se analizó: falta confirmar el tipo de llamada.",
        banner: {
          tone: "warning",
          title: "Confirmá el tipo de llamada",
          message: reasonText ?? "No se pudo decidir el tipo con seguridad.",
          action: input.canEdit ? "choose_type" : null,
        },
      };
    case "pending":
      return {
        analysisAvailable: false,
        emptyMessage: `Todavía no se analizó${reasonText ? `: ${reasonText.charAt(0).toLowerCase()}${reasonText.slice(1)}` : ""}.`,
        banner: {
          tone: "neutral",
          title: "Pendiente de análisis",
          message: reasonText ?? "Está en la fila para analizarse.",
          action: input.canEdit ? "analyze" : null,
          actionDisabledReason: input.canEdit && !input.analyze.ok ? input.analyze.reason ?? null : null,
        },
      };
    case "analyzing":
      return {
        analysisAvailable: false,
        emptyMessage: "Todavía no se analizó: se está analizando ahora.",
        banner: { tone: "info", title: "Analizando…", message: "Puede tardar un minuto. La pantalla se actualiza sola.", action: null, spinner: true },
      };
    case "error":
      return {
        analysisAvailable: false,
        emptyMessage: "No se pudo analizar la llamada.",
        banner: {
          tone: "error",
          title: "No se pudo analizar",
          message: input.error || reasonText || "Hubo un problema al analizar la llamada.",
          action: input.canEdit ? "retry" : null,
          actionDisabledReason: input.canEdit && !input.analyze.ok ? input.analyze.reason ?? null : null,
        },
      };
    case "not_applicable":
      return {
        analysisAvailable: false,
        emptyMessage: "Este tipo de llamada no se analiza.",
        banner: {
          tone: "neutral",
          title: "Este tipo no se analiza",
          message: "Podés cambiar el tipo de llamada, o elegir qué tipos se analizan en la configuración del análisis.",
          action: input.canConfigure ? "config" : null,
        },
      };
    case "analyzed":
      return analysisAvailable ? { analysisAvailable: true, banner: null, emptyMessage: null } : none("La llamada figura como analizada pero no tiene análisis guardado.");
    default:
      return none("Todavía no se analizó.");
  }
}

/** Una linea de transcripcion con minuto, para mostrar. */
export function transcriptStartLabel(timestamp: string | undefined): string {
  if (!timestamp) return "";
  const parts = timestamp.split(":").map(Number);
  if (parts.some((n) => Number.isNaN(n))) return "";
  const [h, m, s] = parts.length === 3 ? parts : [0, parts[0], parts[1] ?? 0];
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

/** Filtra las lineas de la transcripcion por una busqueda (sin tildes ni mayusculas). */
export function searchTranscript<T extends { text?: string; speaker?: { display_name?: string } }>(lines: T[], query: string): number[] {
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const q = norm(query.trim());
  if (q.length < 2) return [];
  const hits: number[] = [];
  lines.forEach((l, i) => {
    if (norm(`${l.speaker?.display_name ?? ""} ${l.text ?? ""}`).includes(q)) hits.push(i);
  });
  return hits;
}
