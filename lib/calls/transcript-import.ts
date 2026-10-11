/**
 * Importar una transcripcion externa (Zoom, TurboScribe, subtitulos, texto
 * pegado) al formato de `calls.transcript` (F11).
 *
 * Portado de prevxcrm (`transcript-import.ts`) y mejorado: conserva el
 * HABLANTE (`Nombre: texto` y `<v Nombre>texto` de VTT) y el TIEMPO de VTT/SRT.
 * Descarta marcas de agua, cabeceras, indices y lineas de tiempo.
 *
 * Funciones puras: el tamano y el tipo de archivo se validan en la accion.
 */

import type { CallTranscriptLine } from "@/lib/types/database";

/** Tamano maximo de lo que se importa (texto o archivo). */
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
/** Importaciones por hora y por persona. */
export const IMPORT_LIMIT_PER_HOUR = 20;
export const IMPORT_EXTENSIONS = [".vtt", ".srt", ".txt"] as const;

const WATERMARK_RE = /turboscribe/i;
const CUE_RE = /^\s*((?:\d{1,2}:)?\d{1,2}:\d{2})(?:[.,]\d{1,3})?\s*-->\s*(?:(?:\d{1,2}:)?\d{1,2}:\d{2})(?:[.,]\d{1,3})?/;
const BLOCK_HEADER_RE = /^(WEBVTT|NOTE|STYLE|REGION)\b/i;
const VOICE_RE = /^<v(?:\.[^\s>]+)*\s+([^>]+)>/i;
const SPEAKER_RE = /^(\p{L}[\p{L}\p{N} .'_-]{0,39}):\s+(\S.*)$/u;
const NOT_A_SPEAKER = /^(https?|ftp|mailto)$/i;

/** "1:05" / "01:05" / "0:01:05" -> "00:01:05" (HH:MM:SS). */
export function normalizeClock(raw: string): string {
  const parts = raw.split(":").map((p) => Number(p));
  if (parts.some((n) => !Number.isFinite(n))) return "";
  const [h, m, s] = parts.length === 3 ? parts : [0, parts[0], parts[1]];
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function stripTags(text: string): string {
  return text.replace(/<\/?[a-zA-Z][^>]*>/g, "").replace(/\s+/g, " ").trim();
}

/** Separa el hablante del texto de una linea, si lo trae. */
function splitSpeaker(line: string): { speaker: string; text: string } {
  const voice = VOICE_RE.exec(line);
  if (voice) return { speaker: voice[1].trim(), text: stripTags(line.slice(voice[0].length)) };
  const clean = stripTags(line);
  const m = SPEAKER_RE.exec(clean);
  if (m && !NOT_A_SPEAKER.test(m[1].trim())) return { speaker: m[1].trim(), text: m[2].trim() };
  return { speaker: "", text: clean };
}

/**
 * Convierte texto plano, VTT o SRT en lineas de transcripcion.
 * Un bloque con linea de tiempo (`-->`) es un subtitulo: su tiempo de inicio
 * pasa a `timestamp`. Cada linea de texto suelta es un parrafo sin tiempo.
 */
export function parseTranscriptText(raw: string): CallTranscriptLine[] {
  const blocks = (raw ?? "").replace(/^﻿/, "").split(/\r?\n\s*\r?\n/);
  const out: CallTranscriptLine[] = [];
  let lastSpeaker = "";

  for (const block of blocks) {
    const lines = block.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0 && !WATERMARK_RE.test(l));
    if (lines.length === 0) continue;
    if (BLOCK_HEADER_RE.test(lines[0])) continue;

    const cueIndex = lines.findIndex((l) => CUE_RE.test(l));
    if (cueIndex >= 0) {
      const timestamp = normalizeClock(CUE_RE.exec(lines[cueIndex])![1]);
      for (const l of lines.slice(cueIndex + 1)) {
        const { speaker, text } = splitSpeaker(l);
        if (!text) continue;
        // En subtitulos el hablante solo aparece al cambiar: el resto sigue con el anterior.
        if (speaker) lastSpeaker = speaker;
        out.push({ speaker: { display_name: speaker || lastSpeaker }, text, timestamp });
      }
      continue;
    }

    for (const l of lines) {
      if (/^\d+$/.test(l)) continue; // indice suelto de SRT
      const { speaker, text } = splitSpeaker(l);
      if (!text) continue;
      out.push({ speaker: { display_name: speaker }, text, timestamp: "" });
    }
  }
  return out;
}

export function transcriptWordCount(lines: Array<{ text: string }>): number {
  return lines.reduce((n, u) => n + (u.text ? u.text.split(/\s+/).filter(Boolean).length : 0), 0);
}

/** Un titulo legible desde el nombre de archivo (sin extension, capitalizado). */
export function titleFromFilename(name: string): string {
  const base = name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
  if (!base) return "Llamada importada";
  return base.replace(/\b\w/g, (c) => c.toUpperCase());
}

export type ImportCheck = { ok: true } | { ok: false; error: string };

/** Valida tamano y tipo. Se llama en el navegador Y en el servidor. */
export function validateImportFile(file: { name: string; size: number }): ImportCheck {
  const lower = file.name.toLowerCase();
  if (!IMPORT_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
    return { ok: false, error: "Subí un archivo .vtt, .srt o .txt" };
  }
  if (file.size > MAX_IMPORT_BYTES) {
    return { ok: false, error: "El archivo pesa más de 2 MB" };
  }
  return { ok: true };
}

/** El texto pegado tambien tiene tope. */
export function validateImportText(text: string): ImportCheck {
  if (!text.trim()) return { ok: false, error: "No hay texto para importar" };
  if (new TextEncoder().encode(text).length > MAX_IMPORT_BYTES) {
    return { ok: false, error: "El texto pesa más de 2 MB" };
  }
  return { ok: true };
}
