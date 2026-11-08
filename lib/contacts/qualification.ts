/**
 * El NIVEL DE CALIFICACIÓN del lead: de 1 a 5, o «Sin calificar» (null).
 * Convive con la temperatura (`lead_temperature`).
 *
 *  - Los 5 niveles son fijos. Cada negocio edita el NOMBRE y la DESCRIPCIÓN (la
 *    rúbrica: qué tiene que cumplir un lead para estar ahí) en Ajustes → Estados.
 *    Se guardan en `workspaces.qualification_settings` (00329).
 *  - El nivel solo cambia por `set_contact_qualification` (00329). La regla de
 *    recorte (`nextQualificationLevel`) es GEMELA de
 *    `private.qualification_next_level`, con los casos de `qualification.cases.json`.
 *
 * Puro: sin base ni React.
 */
import { z } from "zod";

export const QUALIFICATION_LEVELS = [1, 2, 3, 4, 5] as const;
export type QualificationLevel = (typeof QUALIFICATION_LEVELS)[number];

export const QUALIFICATION_MIN = 1;
export const QUALIFICATION_MAX = 5;
export const QUALIFICATION_NAME_MAX = 40;
export const QUALIFICATION_DESCRIPTION_MAX = 300;
export const UNQUALIFIED_LABEL = "Sin calificar";

export interface QualificationLevelDef {
  level: QualificationLevel;
  name: string;
  description: string;
}

export interface QualificationSettings {
  /** Siempre los 5, en orden. */
  levels: QualificationLevelDef[];
}

/**
 * Con lo que arranca un negocio. Es el MISMO literal que el DEFAULT de
 * `workspaces.qualification_settings` (00329; `qualification.test.ts` los compara).
 */
export const DEFAULT_QUALIFICATION_SETTINGS: Readonly<QualificationSettings> = {
  levels: [
    { level: 1, name: "No califica", description: "No encaja con lo que ofrecemos o no tiene un interés real." },
    { level: 2, name: "Bajo", description: "Muestra algo de interés, pero le faltan varias condiciones: necesidad, presupuesto o momento." },
    { level: 3, name: "Medio", description: "Tiene la necesidad y el interés, pero falta confirmar el presupuesto o quién decide." },
    { level: 4, name: "Bueno", description: "Cumple casi todo: necesidad clara, presupuesto y decide; falta dar el siguiente paso." },
    { level: 5, name: "Ideal", description: "Cliente ideal: cumple todo y está listo para avanzar." },
  ],
};

/** El color de cada nivel (de frío a cálido). Fijo: no se configura. */
export const QUALIFICATION_COLORS: Record<QualificationLevel, string> = {
  1: "#e11d48",
  2: "#ea580c",
  3: "#ca8a04",
  4: "#16a34a",
  5: "#7c3aed",
};

export function isQualificationLevel(value: unknown): value is QualificationLevel {
  return typeof value === "number" && Number.isInteger(value) && value >= QUALIFICATION_MIN && value <= QUALIFICATION_MAX;
}

/** Un nivel que llega de afuera (la base, la URL, un CSV): 1-5 o null. Acepta "3" y 3. */
export function parseQualificationLevel(value: unknown): QualificationLevel | null {
  const n = typeof value === "string" && /^\s*[1-5]\s*$/.test(value) ? Number(value) : value;
  return isQualificationLevel(n) ? n : null;
}

const levelDefSchema = z.object({
  level: z.number().int().min(1).max(5),
  name: z.string().trim().min(1).max(QUALIFICATION_NAME_MAX),
  description: z.string().max(QUALIFICATION_DESCRIPTION_MAX).optional().default(""),
});

/**
 * Lee lo guardado. Nunca lanza: un nivel que falta o es inválido toma el nombre
 * y la descripción por defecto; siempre devuelve los 5 en orden.
 */
export function parseQualificationSettings(json: unknown): QualificationSettings {
  const obj = json && typeof json === "object" && !Array.isArray(json) ? (json as Record<string, unknown>) : {};
  const saved = new Map<number, { name: string; description: string }>();
  if (Array.isArray(obj.levels)) {
    for (const raw of obj.levels) {
      const parsed = levelDefSchema.safeParse(raw);
      if (!parsed.success || saved.has(parsed.data.level)) continue;
      saved.set(parsed.data.level, { name: parsed.data.name, description: parsed.data.description.trim() });
    }
  }
  return {
    levels: DEFAULT_QUALIFICATION_SETTINGS.levels.map((d) => {
      const s = saved.get(d.level);
      return s ? { level: d.level, name: s.name, description: s.description } : { ...d };
    }),
  };
}

/** El nombre de un nivel, o «Sin calificar». */
export function qualificationName(settings: QualificationSettings, level: number | null | undefined): string {
  if (!isQualificationLevel(level)) return UNQUALIFIED_LABEL;
  return settings.levels.find((l) => l.level === level)?.name ?? String(level);
}

/** «4 · Bueno», o «Sin calificar». */
export function qualificationLabel(settings: QualificationSettings, level: number | null | undefined): string {
  if (!isQualificationLevel(level)) return UNQUALIFIED_LABEL;
  return `${level} · ${qualificationName(settings, level)}`;
}

/** La rúbrica en texto, para el agente: una línea por nivel. */
export function qualificationRubricText(settings: QualificationSettings): string {
  return settings.levels
    .map((l) => `${l.level} = ${l.name}${l.description ? `: ${l.description}` : ""}`)
    .join("\n");
}

export type QualificationMode = "set" | "add" | "clear";

/**
 * GEMELA de `private.qualification_next_level` (00329).
 *  - `set`: el valor tiene que ser 1-5.
 *  - `add`: suma (negativo resta) y recorta entre 1 y 5. Desde «Sin calificar» se
 *    cuenta desde 0: +1 da 1 y restar no hace nada.
 *  - `clear`: lo quita.
 * Devuelve el nivel nuevo (null = sin calificar) o "invalid".
 */
export function nextQualificationLevel(
  old: number | null,
  mode: QualificationMode,
  value: number | null,
): QualificationLevel | null | "invalid" {
  if (mode === "clear") return null;
  if (mode === "set") return isQualificationLevel(value) ? value : "invalid";
  if (mode === "add") {
    if (typeof value !== "number" || !Number.isInteger(value)) return "invalid";
    const base = old ?? 0;
    const v = base + value;
    if (old === null && v < 1) return null;
    return Math.max(QUALIFICATION_MIN, Math.min(QUALIFICATION_MAX, v)) as QualificationLevel;
  }
  return "invalid";
}

/** De dónde vino un cambio (`contact_qualification_changes.source`). */
export const QUALIFICATION_SOURCES = ["person", "agent", "automation", "import", "merge", "seed"] as const;
export type QualificationSource = (typeof QUALIFICATION_SOURCES)[number];

export const QUALIFICATION_SOURCE_LABELS: Record<QualificationSource, string> = {
  person: "una persona",
  agent: "el agente de IA",
  automation: "una automatización",
  import: "una importación",
  merge: "la fusión de contactos",
  seed: "la conversión desde la temperatura",
};

/** Lo que manda la pantalla de Ajustes: los 5 niveles con su nombre y descripción. */
export const qualificationSettingsInputSchema = z
  .array(
    z.object({
      level: z.number().int().min(1).max(5),
      name: z.string().max(400),
      description: z.string().max(2000),
    }),
  )
  .length(5);

export type QualificationSettingsInput = z.infer<typeof qualificationSettingsInputSchema>;

/** Valida y normaliza lo que manda la pantalla. */
export function validateQualificationSettings(
  input: QualificationSettingsInput,
): { ok: true; settings: QualificationSettings } | { ok: false; error: string } {
  const byLevel = new Map(input.map((i) => [i.level, i]));
  if (byLevel.size !== 5) return { ok: false, error: "Faltan niveles" };
  const levels: QualificationLevelDef[] = [];
  for (const level of QUALIFICATION_LEVELS) {
    const item = byLevel.get(level)!;
    const name = item.name.trim().replace(/\s+/g, " ");
    if (!name) return { ok: false, error: `Poné un nombre al nivel ${level}` };
    if (name.length > QUALIFICATION_NAME_MAX) {
      return { ok: false, error: `El nombre puede tener hasta ${QUALIFICATION_NAME_MAX} caracteres` };
    }
    const description = item.description.trim();
    if (description.length > QUALIFICATION_DESCRIPTION_MAX) {
      return { ok: false, error: `La descripción puede tener hasta ${QUALIFICATION_DESCRIPTION_MAX} caracteres` };
    }
    levels.push({ level, name, description });
  }
  return { ok: true, settings: { levels } };
}

/** El filtro de la lista: `?calif=4,5,none` → niveles y «sin calificar». */
export const UNQUALIFIED_FILTER_VALUE = "none";
