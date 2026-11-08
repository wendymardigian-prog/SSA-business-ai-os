/**
 * Medir un diseño con el servicio de render (F36).
 *
 * Arma el HTML de cada página con el MISMO render de siempre (`renderPageHTML`,
 * modo export), lo manda con `measure: true` y devuelve, por página, la caja de
 * cada texto, si se desborda y la luminancia medida del fondo detrás de él,
 * más el PNG de cada página (para mostrárselo a la IA en la pasada de
 * corrección).
 *
 * Nunca lanza: sin servicio (o con el render simulado) o si falla, devuelve
 * «no disponible» con el motivo y la revisión hace solo los chequeos que no lo
 * necesitan. Los archivos del negocio se firman por 10 minutos.
 *
 * Solo servidor.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { DesignDoc } from "../doc/schema";
import { FORMATS } from "../formats";
import type { UploadedFont } from "../fonts";
import { renderPageHTML } from "../render/page-html";
import { isFakeRender, isRenderConfigured, renderDesign, RenderNotConfigured, type MeasuredPage, type RenderRequest, type RenderResult } from "../render-client";
import { assetUrlFrom, collectAssetPaths, signAssetUrls } from "../storage";

type Db = SupabaseClient<Database>;

export type MeasureOutcome =
  | { status: "ok"; measure: MeasuredPage[]; images: Uint8Array[] }
  | { status: "unavailable"; reason: "not_configured" | "failed" | "fake" };

export type MeasureFn = (doc: DesignDoc) => Promise<MeasureOutcome>;

export interface MeasureDeps {
  db: Pick<Db, "storage">;
  workspaceId: string;
  uploadedFonts?: readonly UploadedFont[];
  /** Valores para las variables (en plantillas, los de muestra: así los textos miden como se van a ver). */
  values?: Record<string, string>;
  /** Para los tests: el servicio de render simulado. Con esto no se mira si el servicio está configurado. */
  render?: (req: RenderRequest) => Promise<RenderResult>;
}

export function makeMeasure(deps: MeasureDeps): MeasureFn {
  return async (doc) => {
    if (!deps.render) {
      if (isFakeRender()) return { status: "unavailable", reason: "fake" };
      if (!isRenderConfigured()) return { status: "unavailable", reason: "not_configured" };
    }
    try {
      const fonts = deps.uploadedFonts ?? [];
      const signed = await signAssetUrls(deps.db, deps.workspaceId, collectAssetPaths(doc, fonts));
      const assetUrl = assetUrlFrom(signed);
      const def = FORMATS[doc.format];
      const height = doc.format === "web" ? (doc.pages[0]?.height ?? def.height) : def.height;
      const pages = doc.pages.map((_p, i) => ({ html: renderPageHTML(doc, i, { mode: "export", values: deps.values ?? {}, assetUrl, uploadedFonts: fonts }) }));
      const result = await (deps.render ?? renderDesign)({ pages, width: def.width, height, format: "png", scale: 0.5, measure: true });
      if (!result.measure) return { status: "unavailable", reason: "failed" };
      const images = result.files
        .filter((f) => f.contentType === "image/png")
        .sort((a, b) => a.page - b.page)
        .map((f) => f.bytes);
      return { status: "ok", measure: result.measure, images };
    } catch (error) {
      if (error instanceof RenderNotConfigured) return { status: "unavailable", reason: "not_configured" };
      console.error("[designer-ai] no pude medir el diseño:", error instanceof Error ? error.name : "error");
      return { status: "unavailable", reason: "failed" };
    }
  };
}

/** Lo que se le avisa a la persona cuando no se pudo medir (nada si el render está simulado). */
export function unavailableNotice(reason: "not_configured" | "failed" | "fake"): string | null {
  if (reason === "fake") return null;
  const why = reason === "not_configured" ? "falta conectar el servicio de render" : "el servicio de render no respondió";
  return `No pude revisar el contraste ni el desborde de los textos: ${why}.`;
}
