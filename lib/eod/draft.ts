/**
 * El borrador de un reporte de fin de día (E7): lo que hace que nada de lo cargado se
 * pierda en todo el día. Puro: el hook del navegador (`components/eod/use-eod-draft.ts`)
 * solo lo compone.
 *
 * Dónde vive el borrador:
 *  - en el servidor (`eod_reports`, con un número de revisión `rev`);
 *  - y una copia en el navegador (`localStorage`), escrita en CADA cambio, de forma
 *    sincrónica: si se corta internet o se cierra la pestaña, lo último está ahí.
 *
 * Al abrir la página se juntan los dos (`mergeDrafts`). Cuando otra pestaña o el celular
 * guardaron en el medio, los números se fusionan por diferencia contra la última versión
 * del servidor que conocía este navegador (`rebaseCounters`): ningún "+1" se pierde en
 * silencio. Los textos: gana el último que se escribió.
 */
import { todayInputValue } from "@/lib/dates";

export type DraftValue = string | number | string[] | null;

export interface EodDraftChannel {
  selected: boolean;
  answers: Record<string, DraftValue>;
}

export interface EodDraftData {
  answers: Record<string, DraftValue>;
  channels: Record<string, EodDraftChannel>;
}

export function emptyDraft(): EodDraftData {
  return { answers: {}, channels: {} };
}

/** Lo que el servidor tiene: el borrador, su revisión y cuándo se guardó. */
export interface ServerDraft {
  data: EodDraftData;
  rev: number;
  savedAt: string | null;
}

/**
 * La copia del navegador.
 *  - `base`/`baseRev`: la última versión del servidor que este navegador conoce.
 *  - `pending`: hay cambios que el servidor todavía no confirmó.
 *  - `sent`: lo que se mandó y no tuvo respuesta (para saber, al volver, si llegó).
 */
export interface LocalDraft {
  v: 1;
  data: EodDraftData;
  base: EodDraftData;
  baseRev: number;
  savedAt: string;
  pending: boolean;
  sent?: { data: EodDraftData; baseRev: number } | null;
}

export function draftStorageKey(workspaceId: string, formId: string, userId: string, reportDate: string): string {
  return `eod:${workspaceId}:${formId}:${userId}:${reportDate}`;
}

// ── Comparar ─────────────────────────────────────────────────────────────────

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || a === null || a === "") return b === undefined || b === null || b === "";
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => x === b[i]);
  return false;
}

export function sameDraft(a: EodDraftData, b: EodDraftData): boolean {
  const keysA = new Set([...Object.keys(a.answers), ...Object.keys(b.answers)]);
  for (const key of keysA) if (!sameValue(a.answers[key], b.answers[key])) return false;
  const channels = new Set([...Object.keys(a.channels), ...Object.keys(b.channels)]);
  for (const key of channels) {
    const ca = a.channels[key];
    const cb = b.channels[key];
    if ((ca?.selected ?? false) !== (cb?.selected ?? false)) return false;
    const inner = new Set([...Object.keys(ca?.answers ?? {}), ...Object.keys(cb?.answers ?? {})]);
    for (const k of inner) if (!sameValue(ca?.answers[k], cb?.answers[k])) return false;
  }
  return true;
}

// ── Fusionar ─────────────────────────────────────────────────────────────────

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Un valor: si no lo toqué, queda el de ellos. Si es un número que yo cambié, se suma mi
 * diferencia sobre el de ellos (10 → yo 13, ellos 12 → 15). Si no es número, gana el mío
 * (es el último que se escribió).
 */
function mergeValue(base: DraftValue | undefined, mine: DraftValue | undefined, theirs: DraftValue | undefined): DraftValue | undefined {
  if (sameValue(mine, base)) return theirs;
  if (isNum(mine) && (isNum(base) || base === null || base === undefined || base === "") && (isNum(theirs) || theirs === null || theirs === undefined || theirs === "")) {
    const delta = mine - (isNum(base) ? base : 0);
    return (isNum(theirs) ? theirs : 0) + delta;
  }
  return mine;
}

function mergeAnswers(base: Record<string, DraftValue>, mine: Record<string, DraftValue>, theirs: Record<string, DraftValue>): Record<string, DraftValue> {
  const out: Record<string, DraftValue> = { ...theirs };
  for (const key of new Set([...Object.keys(mine), ...Object.keys(base)])) {
    const value = mergeValue(base[key], mine[key], theirs[key]);
    if (value === undefined) delete out[key];
    else out[key] = value;
  }
  return out;
}

/**
 * Los "+1" de este navegador sobre lo que guardó otra pestaña o dispositivo.
 * `base` es la última versión del servidor que conocía este navegador; `mine`, lo que
 * cargó acá; `theirs`, lo que hay ahora en el servidor.
 */
export function rebaseCounters(base: EodDraftData, mine: EodDraftData, theirs: EodDraftData): EodDraftData {
  const channels: Record<string, EodDraftChannel> = {};
  const keys = new Set([...Object.keys(theirs.channels), ...Object.keys(mine.channels), ...Object.keys(base.channels)]);
  for (const key of keys) {
    const b = base.channels[key] ?? { selected: false, answers: {} };
    const m = mine.channels[key] ?? b;
    const t = theirs.channels[key] ?? { selected: false, answers: {} };
    channels[key] = {
      selected: m.selected !== b.selected ? m.selected : t.selected,
      answers: mergeAnswers(b.answers, m.answers, t.answers),
    };
  }
  return { answers: mergeAnswers(base.answers, mine.answers, theirs.answers), channels };
}

export interface MergedDraft {
  data: EodDraftData;
  /** La versión del servidor sobre la que queda parado este navegador. */
  base: EodDraftData;
  baseRev: number;
  /** Hay que subir `data` enseguida. */
  upload: boolean;
  /** Se fusionó con lo que guardó otra pestaña o dispositivo: avisar. */
  rebased: boolean;
}

/**
 * Al abrir la página: el borrador del servidor y el del navegador. Si el del navegador
 * tiene cambios sin confirmar (se cortó internet, se cerró la pestaña), gana y se sube;
 * si el servidor avanzó mientras tanto, se fusiona. Si no, gana el del servidor.
 */
export function mergeDrafts(server: ServerDraft | null, local: LocalDraft | null): MergedDraft {
  const serverData = server?.data ?? emptyDraft();
  const serverRev = server?.rev ?? 0;
  if (!local || !local.pending) {
    return { data: serverData, base: serverData, baseRev: serverRev, upload: false, rebased: false };
  }

  let base = local.base;
  let baseRev = local.baseRev;
  // Lo último que se mandó llegó aunque no hubo respuesta: el servidor avanzó UNA revisión
  // y tiene exactamente eso. Entonces la base es eso (sino se sumaría dos veces).
  if (local.sent && server && server.rev === local.sent.baseRev + 1 && sameDraft(server.data, local.sent.data)) {
    base = local.sent.data;
    baseRev = server.rev;
  }

  if (!server || server.rev === baseRev) {
    return { data: local.data, base: serverData, baseRev: serverRev, upload: !sameDraft(local.data, serverData), rebased: false };
  }

  const data = rebaseCounters(base, local.data, serverData);
  return { data, base: serverData, baseRev: serverRev, upload: !sameDraft(data, serverData), rebased: true };
}

// ── Reintentos y medianoche ──────────────────────────────────────────────────

const RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000];

/** Espera creciente: 2, 5, 15, 30 s y después cada 30 s. */
export function nextRetryDelay(attempt: number): number {
  return RETRY_DELAYS_MS[Math.min(Math.max(0, Math.floor(attempt)), RETRY_DELAYS_MS.length - 1)];
}

/**
 * ¿Ya es otro día para esta persona? El reporte NUNCA cambia de fecha solo: esto solo
 * decide si se muestra el aviso "Este reporte es del 12/10".
 */
export function crossedMidnight(reportDate: string, now: Date, timeZone: string): boolean {
  return todayInputValue(now, timeZone) > reportDate;
}

// ── Lectura ──────────────────────────────────────────────────────────────────

function filled(value: DraftValue | undefined): boolean {
  if (value === null || value === undefined || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/** "En curso · 14 cargados": las respuestas con algo, de las generales y los canales prendidos. */
export function countLoaded(data: EodDraftData): number {
  let n = Object.values(data.answers).filter(filled).length;
  for (const channel of Object.values(data.channels)) {
    if (channel.selected) n += Object.values(channel.answers).filter(filled).length;
  }
  return n;
}

export function selectedChannelKeys(data: EodDraftData): string[] {
  return Object.entries(data.channels)
    .filter(([, c]) => c.selected)
    .map(([key]) => key);
}

// ── El ciclo del navegador ───────────────────────────────────────────────────
// Las transiciones de la copia local. El hook las llama en orden: cada cambio
// (`applyLocalChange`, que se escribe en localStorage enseguida), el envío agrupado
// (`beginSend`), y la respuesta (`onSaveOk` o `onSaveConflict`).

export function initialLocal(merged: MergedDraft, now: string): LocalDraft {
  return { v: 1, data: merged.data, base: merged.base, baseRev: merged.baseRev, savedAt: now, pending: merged.upload, sent: null };
}

export function applyLocalChange(local: LocalDraft, data: EodDraftData, now: string): LocalDraft {
  return { ...local, data, savedAt: now, pending: !sameDraft(data, local.base) || local.pending };
}

/** Lo que se manda al servidor: los datos y la revisión sobre la que se apoyan. */
export function beginSend(local: LocalDraft): { local: LocalDraft; payload: { data: EodDraftData; rev: number } } {
  const sent = { data: local.data, baseRev: local.baseRev };
  return { local: { ...local, sent }, payload: { data: local.data, rev: local.baseRev } };
}

/** El servidor guardó `sentData` con la revisión `rev`. Lo que se cargó después sigue pendiente. */
export function onSaveOk(local: LocalDraft, sentData: EodDraftData, rev: number): LocalDraft {
  return { ...local, base: sentData, baseRev: rev, sent: null, pending: !sameDraft(local.data, sentData) };
}

/** Otra pestaña o dispositivo guardó en el medio: se fusiona y queda pendiente de subir. */
export function onSaveConflict(local: LocalDraft, server: ServerDraft): LocalDraft {
  // Lo que mandamos ya estaba en el servidor (lo subió otra pestaña de este navegador, o el
  // guardado al cerrar): la base pasa a ser eso y lo cargado después queda pendiente. Sin
  // esto, se sumaría dos veces.
  if (local.sent && sameDraft(server.data, local.sent.data)) {
    return { ...local, base: server.data, baseRev: server.rev, sent: null, pending: !sameDraft(local.data, server.data) };
  }
  const data = rebaseCounters(local.base, local.data, server.data);
  return { ...local, data, base: server.data, baseRev: server.rev, sent: null, pending: !sameDraft(data, server.data) };
}

/** Lee la copia del navegador; si no es válida (otra versión, JSON roto), null. */
export function parseLocalDraft(raw: string | null): LocalDraft | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as LocalDraft;
    if (value?.v !== 1 || typeof value.baseRev !== "number" || !value.data || !value.base) return null;
    return value;
  } catch {
    return null;
  }
}

// ── Leer y escribir un valor ─────────────────────────────────────────────────
// `channel` null = una pregunta general. Devuelven un borrador NUEVO (nunca mutan).

export function getDraftValue(data: EodDraftData, channel: string | null, key: string): DraftValue | undefined {
  return channel === null ? data.answers[key] : data.channels[channel]?.answers[key];
}

export function setDraftValue(data: EodDraftData, channel: string | null, key: string, value: DraftValue | undefined): EodDraftData {
  const put = (answers: Record<string, DraftValue>) => {
    const next = { ...answers };
    if (value === undefined) delete next[key];
    else next[key] = value;
    return next;
  };
  if (channel === null) return { ...data, answers: put(data.answers) };
  const current = data.channels[channel] ?? { selected: true, answers: {} };
  return { ...data, channels: { ...data.channels, [channel]: { ...current, answers: put(current.answers) } } };
}

/** Prender o apagar un canal. Apagarlo NO borra lo cargado: vuelve si se lo prende de nuevo. */
export function setChannelSelected(data: EodDraftData, channel: string, selected: boolean): EodDraftData {
  const current = data.channels[channel] ?? { selected: false, answers: {} };
  return { ...data, channels: { ...data.channels, [channel]: { ...current, selected } } };
}
