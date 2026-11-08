/**
 * Conversaciones con una IA fuera de la bandeja (`ai_threads` / `ai_messages`, D2).
 *
 * Tablas GENÉRICAS de BAIOS: las usa el Diseñador IA (`designer`, ahora), el
 * tutor del portal (`portal`, Servicios) y el asistente del sistema
 * (`assistant`, después). No reemplazan `conversations` / `messages` de la
 * bandeja, que son canales con leads.
 *
 * La base guarda `context` y `result` como `jsonb`; su forma la valida este
 * módulo, con un esquema POR CANAL, en el servidor antes de escribir. Un canal
 * nuevo suma su esquema acá (y su valor en el CHECK de `ai_threads.channel`).
 *
 * Módulo puro.
 */

import { z } from "zod";

export const AI_THREAD_CHANNELS = ["designer", "portal", "assistant"] as const;
export type AiThreadChannel = (typeof AI_THREAD_CHANNELS)[number];

export const AI_THREAD_SUBJECT_TYPES = ["design", "design_template", "product"] as const;
export type AiThreadSubjectType = (typeof AI_THREAD_SUBJECT_TYPES)[number];

export const AI_MESSAGE_ROLES = ["user", "assistant"] as const;
export type AiMessageRole = (typeof AI_MESSAGE_ROLES)[number];

/** Un adjunto de un mensaje: un archivo del bucket del canal (`design-assets` en el Diseñador). */
export const attachmentSchema = z.object({
  asset_path: z.string().min(1).max(500),
  name: z.string().max(200),
  mime: z.string().max(100),
});
export type AiAttachment = z.infer<typeof attachmentSchema>;

/** Diseñador IA: sobre qué se pidió (todo o una página) y qué cambió la respuesta. */
const designerContext = z.object({ scope: z.object({ page: z.number().int().min(0).max(34).optional() }).strict() }).strict();
const designerResult = z
  .object({
    changed_pages: z.array(z.number().int().min(0).max(34)).max(35),
    summary: z.string().max(2000),
    /** Una propuesta con "Hacerlo / No" (F30, F47): qué se haría si la persona acepta. */
    proposal: z
      .object({
        kind: z.enum(["template_texts", "enable_verification"]),
        status: z.enum(["pending", "accepted", "declined"]),
        payload: z.record(z.string(), z.unknown()).optional(),
      })
      .optional(),
    /** Avisos de la revisión automática que no se pudieron resolver (F36). */
    warnings: z.array(z.string().max(300)).max(40).optional(),
    /** Si una corrección manual le ganó a un cambio de la IA (F31). */
    kept_manual: z.array(z.string().max(60)).max(200).optional(),
    error: z.string().max(500).optional(),
  })
  .strict();

/** Portal y asistente: esquemas mínimos; los completa su módulo cuando llegue. */
const genericContext = z.record(z.string(), z.unknown());
const genericResult = z.record(z.string(), z.unknown());

const SCHEMAS: Record<AiThreadChannel, { context: z.ZodType; result: z.ZodType }> = {
  designer: { context: designerContext, result: designerResult },
  portal: { context: genericContext, result: genericResult },
  assistant: { context: genericContext, result: genericResult },
};

export type DesignerMessageContext = z.infer<typeof designerContext>;
export type DesignerMessageResult = z.infer<typeof designerResult>;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

function parseWith<T>(schema: z.ZodType, value: unknown): ParseResult<T> {
  const r = schema.safeParse(value);
  return r.success ? { ok: true, value: r.data as T } : { ok: false, error: r.error.issues.map((i) => i.message).join("; ") };
}

export function parseMessageContext(channel: AiThreadChannel, value: unknown): ParseResult<Record<string, unknown>> {
  return parseWith(SCHEMAS[channel].context, value ?? {});
}

export function parseMessageResult(channel: AiThreadChannel, value: unknown): ParseResult<Record<string, unknown>> {
  return parseWith(SCHEMAS[channel].result, value);
}

export function parseAttachments(value: unknown): ParseResult<AiAttachment[]> {
  return parseWith(z.array(attachmentSchema).max(10), value ?? []);
}

/** Un hilo del Diseñador IA es uno por diseño o plantilla (índice único parcial en D2). */
export function designerSubjectType(kind: "design" | "template"): AiThreadSubjectType {
  return kind === "design" ? "design" : "design_template";
}
