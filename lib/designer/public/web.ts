/**
 * El HTML de una página web publicada (F43), para el iframe `srcdoc` del link público. Solo servidor.
 *
 * Es el MISMO render de todo el módulo (`renderPageHTML` en modo `public`): nunca produce `<script>`. Las
 * imágenes y fuentes del negocio están en un bucket privado, así que se firman acá (una hora) y van dentro del
 * HTML; una ruta que no es de ESTE negocio no se firma. El iframe lleva `sandbox` SIN `allow-scripts`: aunque el
 * HTML trajera algo activo, no corre.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { parseDesignDoc } from "../doc/schema";
import { FORMATS } from "../formats";
import { renderPageHTML } from "../render/page-html";
import { parseDesignSettings } from "../settings-schema";
import { assetUrlFrom, collectAssetPaths, signAssetUrls } from "../storage";
import type { PublicRecord } from "./load";
import { withBaseTarget } from "./model";

export { WEB_IFRAME_SANDBOX } from "./sandbox";

/** Cuánto duran los links firmados de las imágenes dentro de la página (una hora). */
export const WEB_ASSET_SECONDS = 3600;

/** El HTML completo de la página web, o null si el documento no se puede leer. */
export async function webPageHtml(service: SupabaseClient<Database>, record: PublicRecord): Promise<{ html: string; height: number } | null> {
  const parsed = parseDesignDoc(record.pub.doc);
  if (!parsed.ok || parsed.doc.format !== "web") return null;
  const doc = parsed.doc;
  const settings = parseDesignSettings(record.workspace.design_settings ?? {}, record.workspaceId);
  const uploadedFonts = settings.ok ? (settings.settings.fonts?.uploaded ?? []) : [];
  const signed = await signAssetUrls(service, record.workspaceId, collectAssetPaths(doc, uploadedFonts), WEB_ASSET_SECONDS);
  const html = renderPageHTML(doc, 0, { mode: "public", values: {}, assetUrl: assetUrlFrom(signed), uploadedFonts });
  return { html: withBaseTarget(html), height: doc.pages[0].height ?? FORMATS.web.height };
}

