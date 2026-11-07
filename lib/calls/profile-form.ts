/**
 * El formulario de un analizador (Agentes IA → Análisis de llamadas). Puro: el componente solo lo
 * compone. Las palabras de las reglas se escriben separadas por coma y se guardan como lista.
 */
import { defaultRubricFor, parseProfileRules, rubricForShape, type CallAnalysisProfile, type ProfileMode, type ProfileRules, type ProfileShape } from "./profiles";
import type { Rubric } from "./rubric";

export interface ProfileForm {
  shape: ProfileShape;
  mode: ProfileMode;
  titleContains: string;
  titleExcludes: string;
  minDuration: string;
  minPeople: string;
  rubric: Rubric;
  autoSummary: boolean;
  autoMemory: boolean;
  autoKnowledge: boolean;
  instructions: string;
}

/** El texto de partida de cada formato, cuando el analizador no tiene instrucciones propias. */
export type DefaultInstructions = Record<ProfileShape, string>;

const terms = (list: string[]) => list.join(", ");
const numberText = (n: number | null) => (n === null ? "" : String(n));

export function parseTerms(text: string): string[] {
  return [...new Set(text.split(",").map((t) => t.trim()).filter(Boolean))].slice(0, 30);
}

export function formToRules(form: Pick<ProfileForm, "titleContains" | "titleExcludes" | "minDuration" | "minPeople">): ProfileRules {
  return parseProfileRules({
    title_contains: parseTerms(form.titleContains),
    title_excludes: parseTerms(form.titleExcludes),
    min_duration_minutes: form.minDuration,
    min_people: form.minPeople,
  });
}

function fromProfile(profile: CallAnalysisProfile, instructions: string): ProfileForm {
  return {
    shape: profile.shape,
    mode: profile.mode,
    titleContains: terms(profile.rules.title_contains),
    titleExcludes: terms(profile.rules.title_excludes),
    minDuration: numberText(profile.rules.min_duration_minutes),
    minPeople: numberText(profile.rules.min_people),
    rubric: structuredClone(profile.rubric),
    autoSummary: profile.autoSummary,
    autoMemory: profile.autoMemory,
    autoKnowledge: profile.autoKnowledge,
    instructions,
  };
}

/**
 * Lo que muestra el editor. Uno nuevo arranca en manual: nada corre solo ni gasta IA hasta que
 * una persona lo decida.
 */
export function initialProfileForm(
  profile: CallAnalysisProfile | null,
  instructions: string | null,
  shape: ProfileShape,
  defaults: DefaultInstructions,
): ProfileForm {
  if (profile) return fromProfile(profile, instructions ?? defaults[profile.shape]);
  return {
    shape,
    mode: "manual",
    titleContains: "",
    titleExcludes: "",
    minDuration: "",
    minPeople: "",
    rubric: defaultRubricFor(shape),
    autoSummary: true,
    autoMemory: true,
    autoKnowledge: false,
    instructions: defaults[shape],
  };
}

/** Cambiar de formato no pierde los criterios de quien atendio. Lo escrito a mano en las instrucciones se conserva. */
export function changeShape(form: ProfileForm, shape: ProfileShape, defaults: DefaultInstructions): ProfileForm {
  if (shape === form.shape) return form;
  const untouched = form.instructions.trim() === defaults[form.shape].trim();
  return { ...form, shape, rubric: rubricForShape(form.rubric, shape), instructions: untouched ? defaults[shape] : form.instructions };
}

/** "Copiar de otro tipo": todo menos cuando corre. Una copia no empieza a gastar IA sola. */
export function copyFromProfile(form: ProfileForm, source: CallAnalysisProfile, instructions: string | null, defaults: DefaultInstructions): ProfileForm {
  return { ...fromProfile(source, instructions ?? defaults[source.shape]), mode: form.mode };
}
