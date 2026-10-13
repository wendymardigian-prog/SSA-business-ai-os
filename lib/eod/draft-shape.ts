/**
 * La forma de un borrador que llega del navegador. El borrador se guarda incompleto
 * (las reglas completas se exigen al enviar), pero con FORMA: claves válidas, valores
 * simples y un tope de tamaño. Puro.
 */
import { z } from "zod";
import type { EodDraftData } from "./draft";

const KEY = z.string().regex(/^[a-z][a-z0-9_]{0,59}$/);
const VALUE = z.union([z.string().max(5_000), z.number().finite(), z.array(z.string().max(200)).max(50), z.null()]);
const ANSWERS = z.record(KEY, VALUE).refine((r) => Object.keys(r).length <= 200, "Demasiadas respuestas");

const draftSchema = z.object({
  answers: ANSWERS,
  channels: z
    .record(KEY, z.object({ selected: z.boolean(), answers: ANSWERS }))
    .refine((r) => Object.keys(r).length <= 40, "Demasiados canales"),
});

export const MAX_DRAFT_BYTES = 200_000;

export function parseDraftData(input: unknown): EodDraftData | null {
  const parsed = draftSchema.safeParse(input);
  if (!parsed.success) return null;
  if (JSON.stringify(parsed.data).length > MAX_DRAFT_BYTES) return null;
  return parsed.data as EodDraftData;
}

/** El borrador guardado en la base (columnas `answers`/`channels` o `pending_edit`): nunca lanza. */
export function storedDraft(answers: unknown, channels: unknown): EodDraftData {
  return parseDraftData({ answers: answers ?? {}, channels: channels ?? {} }) ?? { answers: {}, channels: {} };
}
