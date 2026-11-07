/**
 * Que importa cada conexion de Fathom (00304). Puro.
 *
 * Tres modos: automatico (entra todo lo que graba), con reglas (entra lo que las cumple) y manual
 * (la consulta de cada 10 minutos no trae nada: entra con Importar). Lo que no cumple las reglas no
 * se guarda, y se mira ANTES de pedir la transcripcion, que es un pedido aparte a Fathom.
 *
 * Una conexion sin configurar es automatica y sin area: se comporta como antes de esta columna.
 */
import { externalEmailsOf } from "@/lib/calls/linking";
import { normalizeText } from "@/lib/calls/classification";
import type { CallAttendee } from "@/lib/types/database";

export const FATHOM_MODES = ["auto", "rules", "manual"] as const;
export type FathomMode = (typeof FATHOM_MODES)[number];
export const FATHOM_MODE_LABELS: Record<FathomMode, string> = { auto: "Automático", rules: "Con reglas", manual: "Manual" };

export interface FathomRules {
  title_contains: string[];
  title_excludes: string[];
  min_duration_minutes: number | null;
  with_external: boolean;
}

export interface FathomSettings {
  mode: FathomMode;
  rules: FathomRules;
  /** El area de lo que graba esta persona, si ni la reunion ni una regla la deciden. */
  default_area_id: string | null;
  /** Desde cuando corre sola, si antes estuvo en manual: lo anterior se trae con Importar. */
  auto_since: string | null;
}

export const EMPTY_FATHOM_RULES: FathomRules = { title_contains: [], title_excludes: [], min_duration_minutes: null, with_external: false };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const stringList = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean))].slice(0, 30) : [];
const positive = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
};

export function parseFathomRules(raw: unknown): FathomRules {
  if (!isObj(raw)) return { ...EMPTY_FATHOM_RULES };
  return {
    title_contains: stringList(raw.title_contains),
    title_excludes: stringList(raw.title_excludes),
    min_duration_minutes: positive(raw.min_duration_minutes),
    with_external: raw.with_external === true,
  };
}

/** Lo que no se entiende cae a como andaba antes: automatico y sin area. */
export function parseFathomSettings(raw: unknown): FathomSettings {
  const s = isObj(raw) ? raw : {};
  const mode = FATHOM_MODES.includes(s.mode as FathomMode) ? (s.mode as FathomMode) : "auto";
  const since = typeof s.auto_since === "string" && !Number.isNaN(new Date(s.auto_since).getTime()) ? s.auto_since : null;
  return {
    mode,
    rules: parseFathomRules(s.rules),
    default_area_id: typeof s.default_area_id === "string" && s.default_area_id ? s.default_area_id : null,
    auto_since: since,
  };
}

const hasTerm = (title: string, terms: string[]) => {
  const t = normalizeText(title);
  return terms.some((term) => t.includes(normalizeText(term)));
};

export interface MeetingForImport {
  title: string | null;
  durationSeconds: number | null;
  attendees: CallAttendee[];
  recorderEmail: string | null;
  teamEmails: string[];
}

/** Si la grabacion entra. Fuera del modo con reglas, entra todo. Un dato que falta no cumple una condicion. */
export function meetingPassesRules(settings: FathomSettings, meeting: MeetingForImport): boolean {
  if (settings.mode !== "rules") return true;
  const { rules } = settings;
  const title = meeting.title ?? "";
  if (rules.title_contains.length > 0 && !hasTerm(title, rules.title_contains)) return false;
  if (rules.title_excludes.length > 0 && hasTerm(title, rules.title_excludes)) return false;
  if (rules.min_duration_minutes !== null && (meeting.durationSeconds === null || meeting.durationSeconds < rules.min_duration_minutes * 60)) return false;
  if (rules.with_external && externalEmailsOf(meeting.attendees, { teamEmails: meeting.teamEmails, recorderEmail: meeting.recorderEmail }).length === 0) return false;
  return true;
}

/**
 * Desde donde mira la consulta de cada 10 minutos. Nunca antes de `auto_since`: quien salio de manual
 * arranca en ese momento, y lo anterior se trae con Importar para no disparar flujos de golpe.
 */
export function syncCreatedAfter(
  settings: FathomSettings,
  watermark: string | null,
  now: Date,
  windows: { overlapMs: number; initialMs: number },
): string {
  const base = watermark ? new Date(watermark).getTime() - windows.overlapMs : now.getTime() - windows.initialMs;
  const since = settings.auto_since ? new Date(settings.auto_since).getTime() : null;
  return new Date(since !== null && since > base ? since : base).toISOString();
}

export interface FathomSettingsInput {
  mode: FathomMode;
  rules: unknown;
  default_area_id: string | null;
}

export type FathomSettingsCheck = { ok: true; settings: FathomSettings } | { ok: false; error: string };

/** Valida lo que llega de la pantalla y arma lo que se guarda. `auto_since` no viene de afuera. */
export function nextFathomSettings(before: FathomSettings, input: FathomSettingsInput, areaIds: string[], now: Date): FathomSettingsCheck {
  if (!FATHOM_MODES.includes(input?.mode)) return { ok: false, error: "Elegí qué llamadas entran." };
  const rules = parseFathomRules(input.rules);
  if (input.mode === "rules" && !rules.title_contains.length && !rules.title_excludes.length && rules.min_duration_minutes === null && !rules.with_external) {
    return { ok: false, error: "Cargá al menos una regla, o elegí Automático." };
  }
  const area = input.default_area_id || null;
  if (area && !areaIds.includes(area)) return { ok: false, error: "Esa área ya no existe." };

  let autoSince = before.auto_since;
  if (input.mode === "manual") autoSince = null;
  else if (before.mode === "manual") autoSince = now.toISOString();
  return { ok: true, settings: { mode: input.mode, rules, default_area_id: area, auto_since: autoSince } };
}

/** El `?area=` del link de conectar, si es un area del negocio. */
export function connectAreaFrom(redirectTo: string | null | undefined): string | null {
  const query = (redirectTo ?? "").split("?")[1];
  const area = query ? new URLSearchParams(query).get("area") : null;
  return area && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(area) ? area : null;
}

// ── El formulario ─────────────────────────────────────────────────────────

export interface FathomSettingsForm {
  mode: FathomMode;
  titleContains: string;
  titleExcludes: string;
  minDuration: string;
  withExternal: boolean;
  areaId: string;
}

export function fathomSettingsForm(settings: FathomSettings, areaId?: string | null): FathomSettingsForm {
  return {
    mode: settings.mode,
    titleContains: settings.rules.title_contains.join(", "),
    titleExcludes: settings.rules.title_excludes.join(", "),
    minDuration: settings.rules.min_duration_minutes === null ? "" : String(settings.rules.min_duration_minutes),
    withExternal: settings.rules.with_external,
    areaId: areaId ?? settings.default_area_id ?? "",
  };
}

const terms = (text: string) => text.split(",").map((t) => t.trim()).filter(Boolean);

export function fathomSettingsFromForm(form: FathomSettingsForm): FathomSettingsInput {
  return {
    mode: form.mode,
    rules: { title_contains: terms(form.titleContains), title_excludes: terms(form.titleExcludes), min_duration_minutes: form.minDuration, with_external: form.withExternal },
    default_area_id: form.areaId || null,
  };
}
