/**
 * La seccion Patrones: categorias, variantes y que le responden.
 *
 * Lo que arregla: la funcion no devolvia el `text_id` de cada variante, asi que
 * "Mover a…" no se podia conectar con `moveTextAction` y los controles de
 * correccion eran de adorno.
 *
 * La confianza del modelo se muestra, pero nunca como garantia: abajo de 70 % va
 * en ambar (§16).
 */

export const LOW_CONFIDENCE = 0.7;

/** Una variante del jsonb `top_variants`. */
export interface PatternVariant {
  textId: string;
  text: string;
  count: number;
  confidence: number | null;
  source: string | null;
  isButton: boolean;
  replyRate: number | null;
  /** Otras escrituras que la normalizacion junto en esta misma fila. */
  alsoSpellings: string[];
  /** La confianza del modelo es baja: se marca, no se esconde. */
  lowConfidence: boolean;
}

export interface PatternCategory {
  categoryId: string;
  name: string;
  description: string | null;
  isFallback: boolean;
  messageCount: number;
  textCount: number;
  topAuthor: string | null;
  replyRate: number | null;
  rank: number;
  variants: PatternVariant[];
}

/** Una fila de `chat_dashboard_patterns`. */
export interface PatternSqlRow {
  category_id: string;
  category_name: string;
  description: string | null;
  is_fallback: boolean;
  message_count: number;
  text_count: number;
  top_author: string | null;
  reply_rate: number | null;
  rank: number;
  top_variants: unknown;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Lee el jsonb de variantes con tolerancia, y descarta las que no tienen id. */
export function parseVariants(raw: unknown): PatternVariant[] {
  if (!Array.isArray(raw)) return [];
  const out: PatternVariant[] = [];
  for (const entry of raw) {
    const v = entry as Record<string, unknown>;
    const textId = typeof v?.text_id === "string" ? v.text_id : null;
    // Sin id no se puede mover de categoria: mostrar un control que no puede
    // funcionar es peor que no mostrarlo.
    if (!textId) continue;
    const confidence = num(v.confidence);
    out.push({
      textId,
      text: typeof v.text === "string" ? v.text : "",
      count: num(v.count) ?? 0,
      confidence,
      source: typeof v.source === "string" ? v.source : null,
      isButton: Boolean(v.is_button),
      replyRate: num(v.reply_rate),
      alsoSpellings: Array.isArray(v.also_spellings)
        ? v.also_spellings.filter((s): s is string => typeof s === "string" && s.trim().length > 0)
        : [],
      lowConfidence: confidence !== null && confidence < LOW_CONFIDENCE,
    });
  }
  return out;
}

/** Las categorias listas para la lista, ya ordenadas por volumen. */
export function patternCategories(rows: PatternSqlRow[]): PatternCategory[] {
  return rows
    .map((r) => ({
      categoryId: r.category_id,
      name: r.category_name,
      description: r.description,
      isFallback: Boolean(r.is_fallback),
      messageCount: num(r.message_count) ?? 0,
      textCount: num(r.text_count) ?? 0,
      topAuthor: r.top_author,
      replyRate: num(r.reply_rate),
      rank: num(r.rank) ?? 0,
      variants: parseVariants(r.top_variants),
    }))
    .filter((c) => c.messageCount > 0 || c.variants.length > 0);
}

/** "También: hola que negocio tenes, holaa" para una variante. */
export function alsoLabel(variant: PatternVariant): string | null {
  if (variant.alsoSpellings.length === 0) return null;
  return `También: ${variant.alsoSpellings.join(", ")}`;
}

/** Una fila de `chat_dashboard_replies`. */
export interface ReplySqlRow {
  reply_category_id: string | null;
  reply_category_name: string;
  reply_is_fallback: boolean;
  replies: number;
  pct_of_replies: number | null;
  outbound_total: number;
  outbound_with_reply: number;
}

export interface RepliesPanel {
  rows: Array<{ categoryId: string | null; name: string; replies: number; pct: number | null }>;
  outboundTotal: number;
  outboundWithReply: number;
  /** El % que no contesto nada. Exacto, calculado sobre el total. */
  noReplyPct: number | null;
}

/**
 * "Qué le responden" a una categoria.
 *
 * El "% no respondió" se calcula sobre los salientes, no como 100 menos la suma
 * de los porcentajes: los porcentajes son sobre las respuestas, y sumar dos
 * bases distintas da un numero que no significa nada.
 */
export function repliesPanel(rows: ReplySqlRow[]): RepliesPanel {
  const total = num(rows[0]?.outbound_total) ?? 0;
  const withReply = num(rows[0]?.outbound_with_reply) ?? 0;
  return {
    rows: rows.map((r) => ({
      categoryId: r.reply_category_id,
      name: r.reply_category_name,
      replies: num(r.replies) ?? 0,
      pct: num(r.pct_of_replies),
    })),
    outboundTotal: total,
    outboundWithReply: withReply,
    noReplyPct: total > 0 ? Math.round(((total - withReply) / total) * 100) : null,
  };
}
