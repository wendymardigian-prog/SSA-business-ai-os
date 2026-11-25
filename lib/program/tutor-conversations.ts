// @plantilla-quitar(servicios)
/**
 * La pantalla «Conversaciones» del Asistente IA (Portal › un programa › Asistente IA): cada respuesta del tutor con su
 * pregunta, lo que marcó el estudiante y si citó alguna clase. Lo lee `tutor_conversations` (00513); acá solo se decide
 * qué mostrar. La pantalla no decide nada.
 */

export const CONVERSATION_FILTERS = ["todas", "abajo", "arriba", "sin-clases"] as const;
export type ConversationFilter = (typeof CONVERSATION_FILTERS)[number];

export const CONVERSATION_FILTER_LABELS: Record<ConversationFilter, string> = {
  todas: "Todas",
  abajo: "No le sirvió",
  arriba: "Le sirvió",
  "sin-clases": "Sin clases",
};

export function parseConversationFilter(raw: string | null | undefined): ConversationFilter {
  return (CONVERSATION_FILTERS as readonly string[]).includes(raw ?? "") ? (raw as ConversationFilter) : "todas";
}

export interface ConversationCitation {
  item_id: string;
  title: string;
  second: number | null;
}

export interface ConversationItem {
  id: string;
  thread_id: string;
  created_at: string;
  contact_id: string;
  student: string | null;
  question: string | null;
  answer: string;
  citations: ConversationCitation[];
  feedback: "up" | "down" | null;
  /** Lo que guardó el tutor al responder (desde el 24/11/2026): cuántos trozos encontró y cuántas clases citó. */
  result: { fragments?: number; cited?: number } | null;
  run_status: string | null;
}

export interface ConversationsPage {
  items: ConversationItem[];
  has_more: boolean;
}

/**
 * Cómo terminó la respuesta: `failed` (no se pudo responder: se le mostró el aviso), `no_classes` (respondió sin citar
 * ninguna clase) o `with_classes`.
 */
export type AnswerState = "failed" | "no_classes" | "with_classes";

export function answerState(item: Pick<ConversationItem, "run_status" | "citations">): AnswerState {
  if (item.run_status !== "responded") return "failed";
  return item.citations.length > 0 ? "with_classes" : "no_classes";
}

export const ANSWER_STATE_LABELS: Record<AnswerState, string | null> = {
  failed: "No pudo responder",
  no_classes: "Sin clases",
  with_classes: null,
};

/** Lo que encontró la búsqueda, en palabras. Una respuesta vieja (sin el dato) no dice nada. */
export function searchSummary(result: ConversationItem["result"]): string | null {
  const n = typeof result?.fragments === "number" ? result.fragments : null;
  if (n === null) return null;
  if (n === 0) return "No encontró material relacionado";
  return n === 1 ? "Encontró 1 pedazo de clase" : `Encontró ${n} pedazos de clases`;
}

/** El inicio de un texto para la fila (sin saltos de línea ni marcas de formato). */
export function preview(text: string | null | undefined, max = 160): string {
  const flat = (text ?? "").replace(/[*_`#>]+/g, "").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** «12:05» o «1:02:03», para el minuto de una cita. */
export function citationClock(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds)) return null;
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** Lo que devuelve la base, sin confiar en su forma: lo que no encaja se descarta o queda vacío. */
export function readConversationsPage(raw: unknown): ConversationsPage {
  const r = (raw ?? {}) as { items?: unknown; has_more?: unknown };
  const items = Array.isArray(r.items) ? r.items : [];
  return {
    has_more: r.has_more === true,
    items: items
      .filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && typeof (x as { id?: unknown }).id === "string")
      .map((x) => ({
        id: x.id as string,
        thread_id: String(x.thread_id ?? ""),
        created_at: String(x.created_at ?? ""),
        contact_id: String(x.contact_id ?? ""),
        student: typeof x.student === "string" ? x.student : null,
        question: typeof x.question === "string" ? x.question : null,
        answer: typeof x.answer === "string" ? x.answer : "",
        citations: (Array.isArray(x.citations) ? x.citations : [])
          .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
          .map((c) => ({ item_id: String(c.item_id ?? ""), title: String(c.title ?? "Clase"), second: typeof c.second === "number" ? c.second : null })),
        feedback: x.feedback === "up" || x.feedback === "down" ? x.feedback : null,
        result: x.result && typeof x.result === "object" ? (x.result as ConversationItem["result"]) : null,
        run_status: typeof x.run_status === "string" ? x.run_status : null,
      })),
  };
}
