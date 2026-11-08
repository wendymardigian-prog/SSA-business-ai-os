/**
 * Lo que la IA del Diseñador sabe del negocio (F32): su marca, su tono, sus
 * estilos propios y sus fuentes. Se lee con el cliente de servicio filtrando
 * por el negocio que ya validó quien llama.
 *
 * Nunca lanza por un ajuste mal guardado: sin estilos ni fuentes propias el
 * Diseñador sigue andando con los de fábrica.
 *
 * Solo servidor.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveBrand } from "@/lib/brand";
import { aiLanguageStyle } from "@/lib/ai/language-style";
import type { Database } from "@/lib/types/database";
import { CURATED_FONTS, type UploadedFont } from "../fonts";
import { parseDesignSettings } from "../settings-schema";
import { DEFAULT_STYLE_KEY, FACTORY_STYLES, findStyle, type DesignStyle } from "../styles";
import { allowedFontFamilies, type PromptBrand } from "./prompt";
import type { DesignDoc } from "../doc/schema";

type Db = SupabaseClient<Database>;

export interface DesignerWorkspaceContext {
  workspaceId: string;
  brand: PromptBrand;
  languageStyle: string;
  timezone: string;
  customStyles: DesignStyle[];
  googleFonts: string[];
  uploadedFonts: UploadedFont[];
  palette: string[];
}

export async function loadWorkspaceContext(db: Db, workspaceId: string): Promise<DesignerWorkspaceContext | null> {
  const { data, error } = await db
    .from("workspaces")
    .select("id, name, brand_name, brand_logo_path, brand_color, ai_language_style, design_settings, timezone")
    .eq("id", workspaceId)
    .maybeSingle();
  if (error || !data) {
    if (error) console.error("[designer-ai] no pude leer el negocio:", error.message);
    return null;
  }
  const parsed = parseDesignSettings(data.design_settings, workspaceId);
  const settings = parsed.ok ? parsed.settings : null;
  const brand = resolveBrand(data);
  return {
    workspaceId,
    brand: { name: brand.name, colorHex: brand.colorHex, palette: settings?.palette ?? [] },
    languageStyle: aiLanguageStyle(data.ai_language_style),
    timezone: data.timezone || "UTC",
    customStyles: settings?.styles ?? [],
    googleFonts: settings?.fonts?.google ?? [],
    uploadedFonts: settings?.fonts?.uploaded ?? [],
    palette: settings?.palette ?? [],
  };
}

/** El estilo de una clave (de fábrica o propio); sin clave o con una desconocida, el Automático. */
export function resolveStyle(key: string | null | undefined, custom: readonly DesignStyle[]): DesignStyle {
  return findStyle(key, custom) ?? findStyle(DEFAULT_STYLE_KEY) ?? FACTORY_STYLES[0];
}

/** Las fuentes que la IA puede usar en este negocio con este estilo y este documento. */
export function allowedFontsFor(ctx: Pick<DesignerWorkspaceContext, "googleFonts" | "uploadedFonts">, style: DesignStyle, doc?: DesignDoc): string[] {
  return allowedFontFamilies({ curated: CURATED_FONTS.map((f) => f.family), google: ctx.googleFonts, uploaded: ctx.uploadedFonts.map((f) => f.family), style, doc });
}
