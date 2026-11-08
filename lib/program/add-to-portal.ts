// @plantilla-quitar(servicios)
/**
 * «Agregar al portal» desde Grabaciones (F65), puro. `addToPortalPlan` dice qué hay que hacer (y qué falta) a partir
 * de lo que eligió la persona; la acción `addRecordingToPortal` solo ejecuta los pasos en orden.
 */
import { normalizeVideoUrl } from "@/lib/program/video-url";

export interface CallForPortal {
  id: string;
  title: string;
  recorded_at: string;
  transcript: Array<{ text: string; timestamp: string; speaker?: { display_name: string } }>;
}

export type PortalTarget =
  | { kind: "live"; sessionId: string; occursOn: string }
  | { kind: "lesson"; parentId: string }
  | { kind: "lesson"; newModuleTitle: string };

export interface AddToPortalChoice {
  productId: string;
  target: PortalTarget;
  title: string;
  description?: string;
  /** Link opcional de Drive, YouTube, Vimeo o Loom (Fathom no se aloja: decisión 331). */
  videoUrl?: string | null;
  active: boolean;
  saveTranscript: boolean;
}

export type PortalStep =
  | { op: "live_date"; sessionId: string; occursOn: string; callId: string; recordingUrl: string | null }
  | { op: "create_module"; title: string }
  | { op: "create_lesson"; parent: "new_module" | string; title: string }
  | { op: "update_lesson"; patch: Record<string, unknown> }
  | { op: "activate_lesson" }
  | { op: "index_transcript"; vtt: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function addToPortalPlan(call: CallForPortal, choice: AddToPortalChoice): { ok: true; steps: PortalStep[]; warning: string | null } | { ok: false; issues: string[] } {
  const issues: string[] = [];
  if (!UUID.test(choice.productId)) issues.push("Elegí el programa");
  const url = (choice.videoUrl ?? "").trim();
  let video: { embedUrl: string | null; thumbnailUrl: string | null; warning: string | null } | null = null;
  if (url) {
    const v = normalizeVideoUrl(url);
    if (!v.ok) issues.push(v.error);
    else video = { embedUrl: v.embedUrl, thumbnailUrl: v.thumbnailUrl, warning: v.warning };
  }
  const t = choice.target;
  if (t.kind === "live") {
    if (!UUID.test(t.sessionId) || !/^\d{4}-\d{2}-\d{2}$/.test(t.occursOn)) issues.push("Elegí la sesión y la fecha");
    if (issues.length) return { ok: false, issues };
    return { ok: true, steps: [{ op: "live_date", sessionId: t.sessionId, occursOn: t.occursOn, callId: call.id, recordingUrl: url || null }], warning: video?.warning ?? null };
  }
  const title = choice.title.trim();
  if (!title) issues.push("Escribí el título");
  if ("newModuleTitle" in t && !t.newModuleTitle.trim()) issues.push("Escribí el nombre del módulo nuevo");
  if ("parentId" in t && !UUID.test(t.parentId)) issues.push("Elegí el módulo");
  if (issues.length) return { ok: false, issues };
  const steps: PortalStep[] = [];
  if ("newModuleTitle" in t) steps.push({ op: "create_module", title: t.newModuleTitle.trim() });
  steps.push({ op: "create_lesson", parent: "newModuleTitle" in t ? "new_module" : t.parentId, title });
  const patch: Record<string, unknown> = { source_call_id: call.id };
  if ((choice.description ?? "").trim()) patch.description = choice.description!.trim();
  if (video) Object.assign(patch, { video_url: url, video_embed_url: video.embedUrl, thumbnail_url: video.thumbnailUrl });
  steps.push({ op: "update_lesson", patch });
  if (choice.active) steps.push({ op: "activate_lesson" });
  if (choice.saveTranscript) {
    const vtt = callTranscriptToVtt(call.transcript);
    if (vtt) steps.push({ op: "index_transcript", vtt });
  }
  return { ok: true, steps, warning: video?.warning ?? null };
}

/** «HH:MM:SS» o «MM:SS» a segundos; vacío = null. */
export function timestampSeconds(ts: string): number | null {
  const m = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/.exec((ts ?? "").trim());
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

const vttTime = (s: number) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}.000`;
};

/**
 * La transcripción de la grabación como .vtt, para guardarla en Conocimiento con el segundo de cada parte (el mismo
 * camino que una transcripción subida a mano). Sin tiempos, texto suelto. Vacía = "".
 */
export function callTranscriptToVtt(lines: CallForPortal["transcript"]): string {
  const clean = (lines ?? []).filter((l) => (l.text ?? "").trim());
  if (!clean.length) return "";
  const timed = clean.every((l) => timestampSeconds(l.timestamp) !== null);
  const text = (l: (typeof clean)[number]) => (l.speaker?.display_name ? `${l.speaker.display_name}: ${l.text.trim()}` : l.text.trim());
  if (!timed) return clean.map(text).join("\n");
  const out = ["WEBVTT", ""];
  clean.forEach((l, i) => {
    const start = timestampSeconds(l.timestamp) as number;
    const next = i + 1 < clean.length ? (timestampSeconds(clean[i + 1].timestamp) as number) : start + 5;
    out.push(`${vttTime(start)} --> ${vttTime(Math.max(next, start + 1))}`, text(l), "");
  });
  return out.join("\n");
}

/** La fecha de una sesión que mejor coincide con la grabación: la que empieza más cerca, a no más de 12 horas. */
export function suggestOccurrence<T extends { starts_at: string; status: string }>(recordedAt: string, occurrences: T[]): T | null {
  const at = Date.parse(recordedAt);
  let best: T | null = null;
  let bestGap = 12 * 3600_000;
  for (const o of occurrences) {
    if (o.status === "cancelled") continue;
    const gap = Math.abs(Date.parse(o.starts_at) - at);
    if (gap <= bestGap) {
      best = o;
      bestGap = gap;
    }
  }
  return best;
}
