/**
 * La forma de lo que devuelve la IA del Diseñador (F32).
 *
 * Dos salidas, las dos validadas con Zod antes de tocar nada (regla 7 del
 * plano: la IA nunca escribe directo en la base):
 *   - un DOCUMENTO completo (primera versión): `aiDocOutputSchema`;
 *   - un PARCHE (`{pages:[{index, ops:[add|update|remove|reorder]}]}`) para los
 *     cambios, los estilos y las propuestas: `aiPatchOutputSchema`.
 *
 * Los elementos son los del `DesignDoc` con dos diferencias a propósito: el
 * `id` es opcional (lo asigna el servidor) y no hay elementos `html` (la IA no
 * edita HTML cargado). Todo lo demás —porcentajes, colores, variables— lo
 * valida el esquema del documento una vez armado (`parseDesignDoc`).
 *
 * Módulo puro.
 */

import { z } from "zod";
import { designDocSchema, elementSchema } from "../doc/schema";

const [textOption, imageOption, shapeOption] = elementSchema.options;

const looseId = z.string().max(40).optional();

/** Un elemento como lo escribe la IA: sin id obligatorio y sin HTML. */
export const aiElementSchema = z.discriminatedUnion("type", [
  textOption.extend({ id: looseId }),
  imageOption.extend({ id: looseId }),
  shapeOption.extend({ id: looseId }),
]);
export type AiElement = z.infer<typeof aiElementSchema>;

/** El fondo de una página: el mismo del documento. */
const backgroundSchema = designDocSchema.shape.pages.element.shape.background;

export const aiPageSchema = z.object({
  id: looseId,
  name: z.string().max(120).optional(),
  background: backgroundSchema,
  elements: z.array(aiElementSchema).max(60),
  height: z.number().int().min(400).max(20_000).optional(),
});
export type AiPage = z.infer<typeof aiPageSchema>;

/** Qué tipo de documento cree la IA que es (para proponer la verificación, F47). */
export const DOCUMENT_KINDS = ["certificado", "constancia", "diploma", "otro", "ninguno"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/** Primera versión: el documento completo. */
export const aiDocOutputSchema = z.object({
  /** Lo que la IA le dice a la persona: qué hizo, en pocas líneas. */
  message: z.string().min(1).max(1200),
  doc: z.object({
    style: z.string().max(40).optional(),
    pages: z.array(aiPageSchema).min(1).max(20),
  }),
  /** ¿Es un certificado, una constancia o un diploma? Solo si el pedido o la imagen lo dicen claro. */
  documentKind: z.enum(DOCUMENT_KINDS).optional(),
});
export type AiDocOutput = z.infer<typeof aiDocOutputSchema>;

const opSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add"), element: aiElementSchema, at: z.number().int().min(0).max(200).optional() }),
  z.object({ op: z.literal("update"), id: z.string().min(1).max(40), set: z.record(z.string(), z.unknown()) }),
  z.object({ op: z.literal("remove"), id: z.string().min(1).max(40) }),
  z.object({ op: z.literal("reorder"), ids: z.array(z.string().min(1).max(40)).max(200) }),
  /** Cambia el TEXTO de un nodo marcado (`tx`) de un bloque HTML cargado (`id` = el elemento html). Texto plano, nunca HTML. */
  z.object({ op: z.literal("updateText"), id: z.string().min(1).max(40), tx: z.string().min(1).max(20), text: z.string().max(2000) }),
]);
export type PatchOp = z.infer<typeof opSchema>;

/** Los cambios sobre UNA página que ya existe (`index` empieza en 0). */
export const pagePatchSchema = z.object({
  index: z.number().int().min(0).max(34),
  name: z.string().max(120).optional(),
  background: backgroundSchema.optional(),
  height: z.number().int().min(400).max(20_000).optional(),
  ops: z.array(opSchema).max(120),
});
export type PagePatch = z.infer<typeof pagePatchSchema>;

export const patchSchema = z.object({
  pages: z.array(pagePatchSchema).max(35),
  /** Páginas nuevas. Sin `after`, van antes de la última si ésta es el llamado a la acción. */
  newPages: z.array(z.object({ after: z.number().int().min(-1).max(34).optional(), page: aiPageSchema })).max(10).optional(),
  /** Páginas que se quitan (por índice). */
  removePages: z.array(z.number().int().min(0).max(34)).max(20).optional(),
});
export type DesignPatch = z.infer<typeof patchSchema>;

/** Cambios: un parche más el mensaje para la persona. */
export const aiPatchOutputSchema = z.object({
  message: z.string().min(1).max(1200),
  patch: patchSchema,
  documentKind: z.enum(DOCUMENT_KINDS).optional(),
});
export type AiPatchOutput = z.infer<typeof aiPatchOutputSchema>;

export type ParsedAi<T> = { ok: true; value: T } | { ok: false; problems: string[] };

function problemsOf(error: z.ZodError): string[] {
  const out = error.issues.map((issue) => {
    const path = issue.path.length ? issue.path.join(" › ") : "";
    return path ? `${path}: ${issue.message}` : issue.message;
  });
  return [...new Set(out)].slice(0, 12);
}

/** Valida un parche que vino de la IA. Un parche inválido se rechaza con su motivo. */
export function parseAiPatch(json: unknown): ParsedAi<DesignPatch> {
  const result = patchSchema.safeParse(json);
  return result.success ? { ok: true, value: result.data } : { ok: false, problems: problemsOf(result.error) };
}

export function parseAiPatchOutput(json: unknown): ParsedAi<AiPatchOutput> {
  const result = aiPatchOutputSchema.safeParse(json);
  return result.success ? { ok: true, value: result.data } : { ok: false, problems: problemsOf(result.error) };
}

export function parseAiDocOutput(json: unknown): ParsedAi<AiDocOutput> {
  const result = aiDocOutputSchema.safeParse(json);
  return result.success ? { ok: true, value: result.data } : { ok: false, problems: problemsOf(result.error) };
}
