/**
 * Un analizador por tipo de reunion (00303). Puro.
 *
 * Una grabacion busca el perfil de su tipo, despues el de su area, y si no hay ninguno NO se
 * analiza. Lo que decide acá es el perfil, no una lista de tipos: asi renombrar un tipo o crear
 * uno nuevo no cambia nada por sorpresa.
 */
import { countPeople, normalizeText, type MeetingForRules } from "./classification";
import { DEFAULT_RUBRIC, activeWeight, normalizeRubric, type Rubric } from "./rubric";

export const PROFILE_SHAPES = ["sales", "general"] as const;
export type ProfileShape = (typeof PROFILE_SHAPES)[number];
export const PROFILE_SHAPE_LABELS: Record<ProfileShape, string> = { sales: "Ventas", general: "General" };

export const PROFILE_MODES = ["manual", "auto"] as const;
export type ProfileMode = (typeof PROFILE_MODES)[number];

/** Cuando corre solo. Vacio = todas las grabaciones de ese tipo. */
export interface ProfileRules {
  title_contains: string[];
  title_excludes: string[];
  min_duration_minutes: number | null;
  min_people: number | null;
}

export const EMPTY_RULES: ProfileRules = { title_contains: [], title_excludes: [], min_duration_minutes: null, min_people: null };

export interface CallAnalysisProfile {
  id: string;
  workspaceId: string;
  categoryId: string;
  shape: ProfileShape;
  mode: ProfileMode;
  rules: ProfileRules;
  rubric: Rubric;
  autoSummary: boolean;
  autoMemory: boolean;
  autoKnowledge: boolean;
  activePromptVersion: number | null;
}

/** La rubrica de arranque del formato general: lo que hizo quien atendio, sin nada de venta. */
export const DEFAULT_GENERAL_RUBRIC: Rubric = {
  version: 1,
  closer: [
    { clave: "preparacion", nombre: "Preparación y objetivo de la reunión", peso: 25, niveles: {} },
    { clave: "escucha", nombre: "Escucha y comprensión del problema", peso: 35, niveles: {} },
    { clave: "claridad", nombre: "Claridad en lo que explica", peso: 20, niveles: {} },
    { clave: "proximos_pasos", nombre: "Próximos pasos acordados", peso: 20, niveles: {} },
  ],
  lead: [],
};

export function defaultRubricFor(shape: ProfileShape): Rubric {
  return structuredClone(shape === "general" ? DEFAULT_GENERAL_RUBRIC : DEFAULT_RUBRIC);
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const stringList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim()).slice(0, 30) : [];
const positive = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
};

export function parseProfileRules(raw: unknown): ProfileRules {
  if (!isObj(raw)) return { ...EMPTY_RULES };
  return {
    title_contains: stringList(raw.title_contains),
    title_excludes: stringList(raw.title_excludes),
    min_duration_minutes: positive(raw.min_duration_minutes),
    min_people: positive(raw.min_people),
  };
}

function readRubric(raw: unknown, shape: ProfileShape): Rubric {
  if (!isObj(raw)) return defaultRubricFor(shape);
  if (shape === "sales") return normalizeRubric(raw);
  // En el formato general, una lista de lead vacia es lo normal: `normalizeRubric` caeria a la de ventas.
  const closer = Array.isArray(raw.closer) ? raw.closer : [];
  if (closer.length === 0) return { ...defaultRubricFor("general"), version: Number(raw.version) || 1 };
  return normalizeRubric({ ...raw, lead: [] });
}

/** Una fila de `call_analysis_profiles`. Lo que no se entiende cae a lo mas angosto: manual. */
export function parseProfile(row: Record<string, unknown>): CallAnalysisProfile {
  const shape: ProfileShape = row.shape === "sales" ? "sales" : "general";
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    categoryId: String(row.category_id),
    shape,
    mode: row.mode === "auto" ? "auto" : "manual",
    rules: parseProfileRules(row.rules),
    rubric: readRubric(row.rubric, shape),
    autoSummary: row.auto_summary !== false,
    autoMemory: row.auto_memory !== false,
    autoKnowledge: row.auto_knowledge === true,
    activePromptVersion: typeof row.active_prompt_version === "number" ? row.active_prompt_version : null,
  };
}

/** El perfil de una grabacion: el de su tipo y, si no tiene, el de su area. */
export function resolveProfile(
  profiles: readonly CallAnalysisProfile[],
  call: { categoryId?: string | null; areaId?: string | null },
): CallAnalysisProfile | null {
  const by = (id: string | null | undefined) => (id ? profiles.find((p) => p.categoryId === id) ?? null : null);
  return by(call.categoryId) ?? by(call.areaId);
}

const hasTerm = (title: string, terms: string[]) => {
  const t = normalizeText(title);
  return terms.some((term) => t.includes(normalizeText(term)));
};

/** La grabacion cumple las reglas de "corre solo". Un dato que falta no cumple un minimo. */
export function profileRulesMatch(rules: ProfileRules, call: MeetingForRules): boolean {
  const title = call.title ?? "";
  if (rules.title_contains.length > 0 && !hasTerm(title, rules.title_contains)) return false;
  if (rules.title_excludes.length > 0 && hasTerm(title, rules.title_excludes)) return false;
  if (rules.min_duration_minutes !== null) {
    if (typeof call.duration_seconds !== "number" || call.duration_seconds < rules.min_duration_minutes * 60) return false;
  }
  if (rules.min_people !== null && countPeople(call.attendees, call.transcript).people < rules.min_people) return false;
  return true;
}

export interface AfterClassification {
  status: "needs_review" | "pending" | "not_applicable";
  reason: string | null;
  enqueueAnalysis: boolean;
}

/**
 * En que estado queda una grabacion una vez clasificada. Sin perfil no se analiza; con un perfil
 * manual espera el boton; y lo importado del historial nunca corre solo, por mas automatico que sea.
 */
export function statusAfterClassification(
  profile: CallAnalysisProfile | null,
  call: MeetingForRules & { noShow?: boolean; lowConfidence?: boolean; importedFromHistory?: boolean; hasArea?: boolean },
): AfterClassification {
  if (call.lowConfidence) return { status: "needs_review", reason: "low_confidence", enqueueAnalysis: false };
  if (call.noShow) return { status: "not_applicable", reason: "no_show", enqueueAnalysis: false };
  if (!profile) return { status: "not_applicable", reason: "no_profile", enqueueAnalysis: false };
  if (!Array.isArray(call.transcript) || call.transcript.length === 0) return { status: "needs_review", reason: "no_transcript", enqueueAnalysis: false };
  if (profile.mode === "manual" || call.importedFromHistory) return { status: "pending", reason: "manual", enqueueAnalysis: false };
  if (!profileRulesMatch(profile.rules, call)) return { status: "pending", reason: "rules", enqueueAnalysis: false };
  return { status: "pending", reason: null, enqueueAnalysis: true };
}

export type ProfileState = "none" | "manual" | "auto";
export const PROFILE_STATE_LABELS: Record<ProfileState, string> = { none: "Sin configurar", manual: "Manual", auto: "Automático" };

export function profileState(profile: CallAnalysisProfile | null | undefined): ProfileState {
  return profile ? profile.mode : "none";
}

/** Motivos por los que no se puede guardar un perfil (vacio = se puede). */
export function validateProfileRubric(rubric: Rubric, shape: ProfileShape): string[] {
  const out: string[] = [];
  const side = (list: Rubric["closer"], label: string) => {
    if (list.filter((x) => !x.archivado).length < 3) out.push(`La rúbrica ${label} necesita al menos 3 criterios activos.`);
    const w = activeWeight(list);
    if (w !== 100) out.push(`Los pesos ${label} suman ${w}, no 100.`);
    if (list.some((x) => !x.nombre.trim())) out.push(`Hay un criterio ${label} sin nombre.`);
  };
  side(rubric.closer, shape === "sales" ? "del closer" : "de quien atendió");
  if (shape === "sales") side(rubric.lead, "del lead");
  return out;
}

/** Quien miraba un perfil sigue viendo lo mismo si pasa de formato: el general no tiene lead. */
export function rubricForShape(rubric: Rubric, shape: ProfileShape): Rubric {
  if (shape === "general") return { ...rubric, lead: [] };
  return rubric.lead.length > 0 ? rubric : { ...rubric, lead: structuredClone(DEFAULT_RUBRIC.lead) };
}
