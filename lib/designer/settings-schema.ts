/**
 * Los ajustes del Diseñador IA de un negocio (`workspaces.design_settings`, §8.2).
 *
 * Estilos propios, fuentes agregadas de Google, fuentes subidas y una paleta
 * extra. Nace `'{}'` (nada propio). La base tiene su gemela de estructura
 * (`public.validate_design_settings`, D1, por trigger); los casos de
 * `settings.cases.json` corren contra las dos.
 *
 * Módulo puro.
 */

import { z } from "zod";
import { COLOR_RE } from "./doc/schema";
import { FONT_FAMILY_RE } from "./fonts";
import { styleSchema } from "./styles";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
/** La ruta de una fuente subida: siempre en la carpeta de fuentes del negocio. */
export const UPLOADED_FONT_PATH_RE = new RegExp(`^${UUID}/fonts/[A-Za-z0-9._-]{1,120}$`);

const uploadedFont = z.object({
  family: z.string().regex(FONT_FAMILY_RE, { message: "el nombre de la fuente no es válido" }),
  weight: z.number().int().min(100).max(900),
  style: z.enum(["normal", "italic"]),
  path: z.string().regex(UPLOADED_FONT_PATH_RE, { message: "la ruta de la fuente no es válida" }),
  format: z.enum(["woff2", "woff", "ttf", "otf"]),
});

export const designSettingsSchema = z.object({
  v: z.literal(1).optional(),
  palette: z.array(z.string().regex(COLOR_RE, { message: "un color de la paleta no es válido" })).max(24).optional(),
  fonts: z
    .object({
      google: z.array(z.string().regex(FONT_FAMILY_RE, { message: "una fuente de Google no es válida" })).max(50).optional(),
      uploaded: z.array(uploadedFont).max(30).optional(),
    })
    .optional(),
  styles: z
    .array(styleSchema.refine((s) => s.key.startsWith("c_"), { message: "un estilo propio empieza con c_" }))
    .max(30)
    .optional(),
});

export type DesignSettings = z.infer<typeof designSettingsSchema>;
export type UploadedFontEntry = z.infer<typeof uploadedFont>;

export type ParseSettingsResult = { ok: true; settings: Required<Pick<DesignSettings, "palette" | "styles">> & DesignSettings } | { ok: false; problems: string[] };

/**
 * Valida los ajustes y completa lo que falta con vacío. Si se pasa el
 * `workspaceId`, además exige que cada fuente subida esté en SU carpeta.
 */
export function parseDesignSettings(json: unknown, workspaceId?: string): ParseSettingsResult {
  const result = designSettingsSchema.safeParse(json ?? {});
  if (!result.success) return { ok: false, problems: [...new Set(result.error.issues.map((i) => i.message))] };
  const settings = result.data;
  if (workspaceId) {
    const foreign = (settings.fonts?.uploaded ?? []).filter((f) => !f.path.startsWith(`${workspaceId}/fonts/`));
    if (foreign.length) return { ok: false, problems: ["una fuente subida no es de este negocio"] };
  }
  const keys = (settings.styles ?? []).map((s) => s.key);
  if (new Set(keys).size !== keys.length) return { ok: false, problems: ["hay dos estilos propios con la misma clave"] };
  return { ok: true, settings: { v: 1, palette: settings.palette ?? [], styles: settings.styles ?? [], fonts: { google: settings.fonts?.google ?? [], uploaded: settings.fonts?.uploaded ?? [] } } };
}
