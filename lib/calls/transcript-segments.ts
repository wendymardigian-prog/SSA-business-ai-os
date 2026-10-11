/**
 * Convertir la transcripcion de una llamada en pedazos listos para vectorizar
 * (F31). Puro.
 *
 * Portado de prevxcrm (`transcript-segments.ts`). En la base conviven DOS formas,
 * segun de donde vino la llamada:
 *
 *   fathom  -> [{ text, speaker: { display_name }, timestamp }]  transcripcion real
 *   manual  -> [{ text }]                                        resumen pegado a mano
 *
 * Cortar una llamada por parrafos como si fuera un documento pierde lo que la
 * hace util: quien dijo que y en que minuto. Por eso se agrupa por TURNOS de
 * habla y cada pedazo arrastra su rango de tiempo.
 */

export interface Segment {
  content: string;
  /** El hablante, solo si TODO el pedazo es de una misma persona. */
  speaker: string | null;
  tsStart: string | null;
  tsEnd: string | null;
  heading: string | null;
}

const MAX_CHARS = 1200;
const MIN_CHARS = 40;

interface Entry {
  text?: string;
  speaker?: { display_name?: string | null } | string | null;
  timestamp?: string | null;
}

interface Turn {
  speaker: string | null;
  text: string;
  ts: string | null;
  tsEnd: string | null;
}

function speakerName(s: Entry["speaker"]): string | null {
  if (!s) return null;
  if (typeof s === "string") return s.trim() || null;
  return (s.display_name ?? "").trim() || null;
}

/** Une locuciones seguidas del mismo hablante en un turno. */
function groupTurns(entries: Entry[]): Turn[] {
  const turns: Turn[] = [];
  for (const e of entries) {
    const text = (e.text ?? "").trim();
    if (!text) continue;
    const speaker = speakerName(e.speaker);
    const ts = (e.timestamp ?? "") || null;
    const last = turns[turns.length - 1];

    // Solo se unen locuciones seguidas del MISMO hablante identificado. Sin
    // hablante cada entrada queda como linea propia: en los resumenes importados
    // esas lineas son los titulos y las viñetas, y unirlas destruye la estructura.
    if (speaker && last && last.speaker === speaker) {
      last.text += " " + text;
      last.tsEnd = ts ?? last.tsEnd;
    } else {
      turns.push({ speaker, text, ts, tsEnd: ts });
    }
  }
  return turns;
}

/**
 * Los pedazos de una transcripcion. `speaker` se completa solo cuando TODO el
 * pedazo es de una misma persona; si mezcla voces queda null, porque poner una
 * sola seria mentir sobre la mitad del texto. El contenido igual lleva el nombre
 * delante de cada turno, asi el modelo ve quien habla aunque la columna este vacia.
 */
export function segmentTranscript(raw: unknown): Segment[] {
  if (!Array.isArray(raw)) return [];
  const turns = groupTurns(raw as Entry[]);
  if (turns.length === 0) return [];

  const segments: Segment[] = [];
  let buffer: string[] = [];
  let speakers = new Set<string>();
  let tsStart: string | null = null;
  let tsEnd: string | null = null;
  let length = 0;

  const close = () => {
    const content = buffer.join("\n").trim();
    if (content.length >= MIN_CHARS) {
      segments.push({ content, speaker: speakers.size === 1 ? [...speakers][0] : null, tsStart, tsEnd, heading: null });
    }
    buffer = [];
    speakers = new Set();
    tsStart = null;
    tsEnd = null;
    length = 0;
  };

  const addLine = (line: string, speaker: string | null, ts: string | null, end: string | null) => {
    if (length > 0 && length + line.length + 1 > MAX_CHARS) close();
    if (tsStart === null) tsStart = ts;
    tsEnd = end ?? ts ?? tsEnd;
    if (speaker) speakers.add(speaker);
    buffer.push(line);
    length += line.length + 1;
  };

  for (const t of turns) {
    const prefix = t.speaker ? `${t.speaker}: ` : "";

    // Un turno mas largo que el tope se parte por oraciones, repitiendo el nombre
    // para que cada pedazo siga diciendo quien habla.
    if (prefix.length + t.text.length > MAX_CHARS) {
      let acc = "";
      for (const sentence of t.text.split(/(?<=[.!?])\s+/)) {
        if (acc && prefix.length + acc.length + sentence.length + 1 > MAX_CHARS) {
          addLine(prefix + acc, t.speaker, t.ts, t.tsEnd);
          acc = sentence;
        } else {
          acc = acc ? `${acc} ${sentence}` : sentence;
        }
      }
      if (acc) addLine(prefix + acc, t.speaker, t.ts, t.tsEnd);
      continue;
    }
    addLine(prefix + t.text, t.speaker, t.ts, t.tsEnd);
  }

  close();
  return segments;
}

/** El texto plano de la llamada, por turnos, para guardar como contenido del documento. */
export function transcriptToText(raw: unknown): string {
  if (!Array.isArray(raw)) return "";
  return groupTurns(raw as Entry[])
    .map((t) => (t.speaker ? `${t.speaker}: ${t.text}` : t.text))
    .join("\n")
    .trim();
}

/** true si la transcripcion trae hablantes: una llamada de verdad y no un resumen pegado. */
export function hasSpeakers(raw: unknown): boolean {
  if (!Array.isArray(raw)) return false;
  return (raw as Entry[]).some((e) => speakerName(e.speaker) !== null);
}
