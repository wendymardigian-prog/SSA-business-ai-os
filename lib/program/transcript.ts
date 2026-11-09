// @plantilla-quitar(servicios)
/**
 * La transcripción de una clase (F49), pura: de un .vtt, un .srt o texto suelto a fragmentos con el segundo en que
 * empiezan (con .vtt y .srt; con texto, sin minutos). Los fragmentos juntan líneas hasta ~1000 caracteres.
 */
export interface TranscriptChunk {
  text: string;
  startSecond: number | null;
}

const TIME = /(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})\s*-->/;

function toSeconds(m: RegExpMatchArray): number {
  return (Number(m[1] ?? 0) * 3600) + Number(m[2]) * 60 + Number(m[3]);
}

export function parseTimedLines(raw: string): Array<{ text: string; startSecond: number | null }> {
  const lines = raw.replace(/\r/g, "").split("\n");
  const out: Array<{ text: string; startSecond: number | null }> = [];
  let current: number | null = null;
  let timed = false;
  for (const line of lines) {
    const t = line.trim();
    const m = t.match(TIME);
    if (m) {
      current = toSeconds(m);
      timed = true;
      continue;
    }
    if (!t || t === "WEBVTT" || /^\d+$/.test(t) || t.startsWith("NOTE") || t.startsWith("STYLE")) continue;
    const text = t.replace(/<[^>]+>/g, "").trim();
    if (text) out.push({ text, startSecond: timed ? current : null });
  }
  return out;
}

export function chunkTranscript(raw: string, maxChars = 1000): TranscriptChunk[] {
  const lines = parseTimedLines(raw);
  const chunks: TranscriptChunk[] = [];
  let buf: string[] = [];
  let start: number | null = null;
  let size = 0;
  for (const l of lines) {
    if (buf.length === 0) start = l.startSecond;
    if (size + l.text.length > maxChars && buf.length) {
      chunks.push({ text: buf.join(" "), startSecond: start });
      buf = [];
      size = 0;
      start = l.startSecond;
    }
    buf.push(l.text);
    size += l.text.length + 1;
  }
  if (buf.length) chunks.push({ text: buf.join(" "), startSecond: start });
  return chunks;
}

/** El formato del archivo subido, por su nombre: .vtt, .srt o .txt. */
export function transcriptFormat(name: string): "vtt" | "srt" | "txt" | null {
  const ext = name.toLowerCase().split(".").pop();
  return ext === "vtt" || ext === "srt" || ext === "txt" ? ext : null;
}
