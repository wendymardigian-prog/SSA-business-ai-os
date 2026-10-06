/**
 * El historial de una pieza (F22).
 *
 * La regla: **nada se pisa sin dejar version**. Pero no toda escritura merece
 * una: el editor autoguarda cada 10 segundos, y guardar una version en cada
 * autoguardado llenaria el historial de ruido y haria imposible encontrar el
 * cambio que importa.
 *
 * Se guarda version cuando pasa algo que alguien quiso: cambiar de estado,
 * apretar "Guardar version", volver despues de un rato, o una generacion con
 * IA. Restaurar tambien crea una version nueva: el historial no se reescribe.
 */

import { recordingNotesFromLegacyCopy, scriptFromLegacyCopy } from "./legacy";

export type VersionReason =
  | "status_change"
  | "manual_save"
  | "resume_after_idle"
  | "ai_generation"
  | "restore";

/** Cuantas versiones se conservan por pieza. */
export const MAX_VERSIONS_PER_POST = 50;

/** Cuanto silencio convierte al proximo guardado en una version. */
export const IDLE_MINUTES = 10;

export interface SaveContext {
  trigger: "autosave" | "manual_save" | "status_change" | "ai_generation" | "restore";
  /** Cuando fue la ultima edicion, para saber si hubo una pausa. */
  lastEditedAt?: string | null;
  now?: Date;
}

/** Si esta escritura tiene que dejar una version, y por que. */
export function versionReasonFor(context: SaveContext): VersionReason | null {
  switch (context.trigger) {
    case "manual_save":
      return "manual_save";
    case "status_change":
      return "status_change";
    case "ai_generation":
      return "ai_generation";
    case "restore":
      return "restore";
    case "autosave": {
      // Un autoguardado normal no deja version. Pero si la persona volvio
      // despues de un rato, lo que habia antes es "como estaba ayer" y vale
      // la pena poder volver ahi.
      if (!context.lastEditedAt) return null;
      const last = new Date(context.lastEditedAt).getTime();
      if (Number.isNaN(last)) return null;
      const minutes = ((context.now ?? new Date()).getTime() - last) / 60000;
      return minutes >= IDLE_MINUTES ? "resume_after_idle" : null;
    }
  }
}

export interface PostSnapshot {
  title: string;
  format: string | null;
  /** El guion (F90). */
  script: string | null;
  recording_notes: string | null;
  caption: string | null;
  networks: unknown[];
  media: unknown[];
}

/**
 * Una version guardada ANTES de la v3: el texto vive en `copy`
 * ({ hook, body, cta, recording_notes }). No se migra: el historial no se
 * reescribe. Se lee con `normalizeSnapshot`.
 */
export interface LegacyPostSnapshot {
  title: string;
  format: string | null;
  copy: Record<string, unknown>;
  caption: string | null;
  networks: unknown[];
  media: unknown[];
}

/** Lo que puede haber guardado en una version: la forma nueva o la vieja. */
export type StoredSnapshot = PostSnapshot | LegacyPostSnapshot;

/**
 * Lleva cualquier version guardada a la forma nueva (F90).
 *
 * Una version con `script` o `recording_notes` ya es nueva. Una sin ninguna
 * de las dos y con `copy` es vieja, y su guion se arma igual que lo hizo el
 * backfill de la 00117. Se usa al comparar (para no marcar como cambio algo
 * que es solo la forma) y al restaurar (para escribir `script` y NUNCA
 * `copy`).
 */
export function normalizeSnapshot(raw: StoredSnapshot): PostSnapshot {
  const base = {
    title: raw.title,
    format: raw.format ?? null,
    caption: raw.caption ?? null,
    networks: Array.isArray(raw.networks) ? raw.networks : [],
    media: Array.isArray(raw.media) ? raw.media : [],
  };

  const isNew = "script" in raw || "recording_notes" in raw;
  if (isNew) {
    const next = raw as PostSnapshot;
    return { ...base, script: next.script ?? null, recording_notes: next.recording_notes ?? null };
  }

  const legacy = raw as LegacyPostSnapshot;
  return {
    ...base,
    script: scriptFromLegacyCopy(legacy.copy),
    recording_notes: recordingNotesFromLegacyCopy(legacy.copy),
  };
}

export interface StoredVersion {
  id: string;
  version_no: number;
  snapshot: StoredSnapshot;
  author_kind: "human" | "ai" | "system";
  author_id: string | null;
  reason: VersionReason;
  created_at: string;
}

/** El numero de la version que se esta por crear. */
export function nextVersionNumber(current: number): number {
  return current + 1;
}

/**
 * Que versiones sobran cuando se pasa del tope.
 *
 * Se borran las mas viejas, nunca las ultimas: el historial util es el
 * reciente.
 */
export function versionsToPrune(
  versions: Array<{ id: string; version_no: number }>,
  max = MAX_VERSIONS_PER_POST,
): string[] {
  if (versions.length <= max) return [];
  return [...versions]
    .sort((a, b) => a.version_no - b.version_no)
    .slice(0, versions.length - max)
    .map((v) => v.id);
}

export interface FieldDiff {
  field: string;
  label: string;
  before: string;
  after: string;
}

const FIELD_LABELS: Record<string, string> = {
  title: "Titulo",
  format: "Formato",
  script: "Guion",
  recording_notes: "Notas de grabacion",
  caption: "Caption",
};

const text = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
};

/**
 * Que cambio entre dos versiones, campo por campo.
 *
 * Solo los campos de texto: comparar `networks` o `media` linea a linea daria
 * un diff de JSON que no le dice nada a nadie. Para esos alcanza con decir
 * que cambiaron.
 */
export function compareVersions(rawBefore: StoredSnapshot, rawAfter: StoredSnapshot): FieldDiff[] {
  const diffs: FieldDiff[] = [];

  // Las dos a la forma nueva: comparar una vieja contra una nueva no puede
  // marcar "cambio" solo porque una guarda `copy` y la otra `script`.
  const before = normalizeSnapshot(rawBefore);
  const after = normalizeSnapshot(rawAfter);

  const pairs: Array<[string, unknown, unknown]> = [
    ["title", before.title, after.title],
    ["format", before.format, after.format],
    ["script", before.script, after.script],
    ["recording_notes", before.recording_notes, after.recording_notes],
    ["caption", before.caption, after.caption],
  ];

  for (const [field, a, b] of pairs) {
    const previous = text(a);
    const next = text(b);
    if (previous !== next) {
      diffs.push({ field, label: FIELD_LABELS[field] ?? field, before: previous, after: next });
    }
  }

  const countChange = (field: string, label: string, a: unknown[], b: unknown[]) => {
    if (a.length !== b.length) {
      diffs.push({
        field,
        label,
        before: `${a.length} elemento(s)`,
        after: `${b.length} elemento(s)`,
      });
    }
  };
  countChange("networks", "Redes", before.networks ?? [], after.networks ?? []);
  countChange("media", "Media", before.media ?? [], after.media ?? []);

  return diffs;
}

/** Como se describe una version en la lista del historial. */
export function describeVersion(version: StoredVersion, authorName?: string | null): string {
  const who =
    version.author_kind === "ai"
      ? "IA"
      : version.author_kind === "system"
        ? "el sistema"
        : authorName || "alguien del equipo";

  switch (version.reason) {
    case "manual_save":
      return `Guardada por ${who}`;
    case "status_change":
      return `Cambio de estado, por ${who}`;
    case "resume_after_idle":
      return `Antes de retomar la edicion (${who})`;
    case "ai_generation":
      return "Generada con IA";
    case "restore":
      return `Restaurada por ${who}`;
  }
}
