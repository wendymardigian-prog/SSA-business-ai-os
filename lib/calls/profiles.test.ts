import { describe, expect, it } from "vitest";
import { changeShape, copyFromProfile, formToRules, initialProfileForm, parseTerms } from "./profile-form";
import {
  DEFAULT_GENERAL_RUBRIC,
  defaultRubricFor,
  parseProfile,
  parseProfileRules,
  profileRulesMatch,
  profileState,
  resolveProfile,
  rubricForShape,
  statusAfterClassification,
  validateProfileRubric,
  type CallAnalysisProfile,
} from "./profiles";

const profile = (over: Partial<CallAnalysisProfile> = {}): CallAnalysisProfile => ({
  id: "p1",
  workspaceId: "ws1",
  categoryId: "tipo-cierre",
  shape: "sales",
  mode: "auto",
  rules: { title_contains: [], title_excludes: [], min_duration_minutes: null, min_people: null },
  rubric: defaultRubricFor("sales"),
  autoSummary: true,
  autoMemory: true,
  autoKnowledge: false,
  activePromptVersion: null,
  ...over,
});

const transcript = [{ text: "hola", speaker: { display_name: "Ana" } }];
const call = { title: "Cierre con Ana", duration_seconds: 1800, attendees: [], transcript };

describe("resolveProfile", () => {
  const byType = profile({ id: "tipo", categoryId: "tipo-cierre" });
  const byArea = profile({ id: "area", categoryId: "area-ventas" });

  it("busca primero el de su tipo", () => {
    expect(resolveProfile([byArea, byType], { categoryId: "tipo-cierre", areaId: "area-ventas" })?.id).toBe("tipo");
  });
  it("sin analizador propio, usa el de su area", () => {
    expect(resolveProfile([byArea, byType], { categoryId: "tipo-triaje", areaId: "area-ventas" })?.id).toBe("area");
  });
  it("sin ninguno de los dos, no hay analizador", () => {
    expect(resolveProfile([byType], { categoryId: "otro", areaId: "otra-area" })).toBeNull();
    expect(resolveProfile([], { categoryId: null, areaId: null })).toBeNull();
  });
});

describe("statusAfterClassification", () => {
  it("sin analizador no se analiza, y lo dice", () => {
    expect(statusAfterClassification(null, call)).toEqual({ status: "not_applicable", reason: "no_profile", enqueueAnalysis: false });
  });
  it("un analizador manual no encola nada", () => {
    expect(statusAfterClassification(profile({ mode: "manual" }), call)).toEqual({ status: "pending", reason: "manual", enqueueAnalysis: false });
  });
  it("uno automatico encola lo que cumple las reglas", () => {
    expect(statusAfterClassification(profile(), call)).toEqual({ status: "pending", reason: null, enqueueAnalysis: true });
  });
  it("lo que no cumple las reglas queda pendiente, sin encolar", () => {
    const rules = { title_contains: ["demo"], title_excludes: [], min_duration_minutes: null, min_people: null };
    expect(statusAfterClassification(profile({ rules }), call)).toEqual({ status: "pending", reason: "rules", enqueueAnalysis: false });
  });
  it("lo importado del historial nunca corre solo", () => {
    expect(statusAfterClassification(profile(), { ...call, importedFromHistory: true }).enqueueAnalysis).toBe(false);
  });
  it("una reunion a la que nadie vino no se analiza, tenga o no analizador", () => {
    expect(statusAfterClassification(profile(), { ...call, noShow: true })).toEqual({ status: "not_applicable", reason: "no_show", enqueueAnalysis: false });
    expect(statusAfterClassification(null, { ...call, noShow: true }).reason).toBe("no_show");
  });
  it("con poca confianza o sin transcripcion, la revisa una persona", () => {
    expect(statusAfterClassification(profile(), { ...call, lowConfidence: true }).status).toBe("needs_review");
    expect(statusAfterClassification(profile(), { ...call, transcript: [] })).toEqual({ status: "needs_review", reason: "no_transcript", enqueueAnalysis: false });
  });
});

describe("profileRulesMatch", () => {
  const rules = (over = {}) => ({ title_contains: [], title_excludes: [], min_duration_minutes: null, min_people: null, ...over });

  it("vacio deja pasar todo", () => {
    expect(profileRulesMatch(rules(), { title: null, duration_seconds: null, attendees: [], transcript: [] })).toBe(true);
  });
  it("mira el nombre sin tildes ni mayusculas", () => {
    expect(profileRulesMatch(rules({ title_contains: ["DIAGNOSTICO"] }), { ...call, title: "Diagnóstico inicial" })).toBe(true);
    expect(profileRulesMatch(rules({ title_excludes: ["interno"] }), { ...call, title: "Reunión INTERNO" })).toBe(false);
  });
  it("un dato que falta no cumple un minimo", () => {
    expect(profileRulesMatch(rules({ min_duration_minutes: 10 }), { ...call, duration_seconds: null })).toBe(false);
    expect(profileRulesMatch(rules({ min_duration_minutes: 10 }), { ...call, duration_seconds: 599 })).toBe(false);
    expect(profileRulesMatch(rules({ min_duration_minutes: 10 }), { ...call, duration_seconds: 600 })).toBe(true);
  });
});

describe("parseProfile", () => {
  it("lo que no entiende cae a lo mas angosto: manual y general", () => {
    const p = parseProfile({ id: "x", workspace_id: "w", category_id: "c", shape: "raro", mode: "raro", rules: null, rubric: null });
    expect(p.mode).toBe("manual");
    expect(p.shape).toBe("general");
    expect(p.rubric.closer).toEqual(DEFAULT_GENERAL_RUBRIC.closer);
    expect(p.rubric.lead).toEqual([]);
  });
  it("el formato general no toma la rubrica de lead de ventas", () => {
    const p = parseProfile({ id: "x", workspace_id: "w", category_id: "c", shape: "general", rubric: { version: 4, closer: [{ clave: "a", nombre: "A", peso: 100 }], lead: [] } });
    expect(p.rubric.version).toBe(4);
    expect(p.rubric.lead).toEqual([]);
    expect(p.rubric.closer.map((c) => c.clave)).toEqual(["a"]);
  });
  it("las reglas ignoran lo que no sirve", () => {
    expect(parseProfileRules({ title_contains: ["  demo ", "", 3], min_duration_minutes: "15", min_people: -2 })).toEqual({
      title_contains: ["demo"],
      title_excludes: [],
      min_duration_minutes: 15,
      min_people: null,
    });
  });
});

describe("validateProfileRubric", () => {
  it("la rubrica de arranque de cada formato se puede guardar", () => {
    expect(validateProfileRubric(defaultRubricFor("sales"), "sales")).toEqual([]);
    expect(validateProfileRubric(defaultRubricFor("general"), "general")).toEqual([]);
  });
  it("el formato general no exige lead; el de ventas si", () => {
    const sinLead = { ...defaultRubricFor("sales"), lead: [] };
    expect(validateProfileRubric(sinLead, "general")).toEqual([]);
    expect(validateProfileRubric(sinLead, "sales").length).toBeGreaterThan(0);
  });
  it("los pesos tienen que sumar 100", () => {
    const r = defaultRubricFor("general");
    r.closer[0].peso += 1;
    expect(validateProfileRubric(r, "general")[0]).toContain("suman");
  });
  it("ya no exige a que tipo aplica cada criterio", () => {
    const r = defaultRubricFor("general");
    expect(r.closer.every((c) => !c.aplica_a)).toBe(true);
    expect(validateProfileRubric(r, "general")).toEqual([]);
  });
});

describe("rubricForShape", () => {
  it("pasar a general saca el lead y conserva los criterios", () => {
    const sales = defaultRubricFor("sales");
    const general = rubricForShape(sales, "general");
    expect(general.lead).toEqual([]);
    expect(general.closer).toEqual(sales.closer);
  });
  it("volver a ventas completa el lead", () => {
    const back = rubricForShape(defaultRubricFor("general"), "sales");
    expect(back.lead.length).toBeGreaterThan(0);
  });
});

describe("profileState", () => {
  it("dice Sin configurar, Manual o Automatico", () => {
    expect(profileState(null)).toBe("none");
    expect(profileState(profile({ mode: "manual" }))).toBe("manual");
    expect(profileState(profile())).toBe("auto");
  });
});

describe("el formulario del analizador", () => {
  const defaults = { sales: "texto ventas", general: "texto general" };

  it("uno nuevo arranca en manual: nada corre solo", () => {
    const form = initialProfileForm(null, null, "general", defaults);
    expect(form.mode).toBe("manual");
    expect(form.instructions).toBe("texto general");
    expect(form.rubric.lead).toEqual([]);
  });
  it("uno guardado muestra lo suyo", () => {
    const form = initialProfileForm(profile({ rules: { title_contains: ["a", "b"], title_excludes: [], min_duration_minutes: 10, min_people: null } }), "propias", "general", defaults);
    expect(form.titleContains).toBe("a, b");
    expect(form.minDuration).toBe("10");
    expect(form.instructions).toBe("propias");
  });
  it("cambiar de formato cambia el texto de partida, pero no lo escrito a mano", () => {
    const untouched = initialProfileForm(null, null, "general", defaults);
    expect(changeShape(untouched, "sales", defaults).instructions).toBe("texto ventas");
    const written = { ...untouched, instructions: "lo mio" };
    expect(changeShape(written, "sales", defaults).instructions).toBe("lo mio");
  });
  it("copiar de otro tipo trae todo menos cuando corre", () => {
    const form = initialProfileForm(null, null, "general", defaults);
    const copy = copyFromProfile(form, profile({ mode: "auto", shape: "sales" }), "de la otra", defaults);
    expect(copy.mode).toBe("manual");
    expect(copy.shape).toBe("sales");
    expect(copy.instructions).toBe("de la otra");
  });
  it("las palabras se separan por coma, sin repetir", () => {
    expect(parseTerms(" demo, demo ,, diagnóstico ")).toEqual(["demo", "diagnóstico"]);
    expect(formToRules({ titleContains: "demo", titleExcludes: "", minDuration: "15", minPeople: "" })).toEqual({
      title_contains: ["demo"],
      title_excludes: [],
      min_duration_minutes: 15,
      min_people: null,
    });
  });
});
