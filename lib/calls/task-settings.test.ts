import { describe, expect, it } from "vitest";
import {
  DEFAULT_ANALYSIS, DEFAULT_CLASSIFICATION, DEFAULT_RULES, isCallTaskKey, resolveCallTaskSettings, validateCallTaskSettings,
  validTypeKeys, type CallAnalysisSettings,
} from "./task-settings";

describe("resolveCallTaskSettings", () => {
  it("sin nada guardado devuelve los defaults de las dos tareas", () => {
    const s = resolveCallTaskSettings({});
    expect(s.call_classification).toEqual(DEFAULT_CLASSIFICATION);
    expect(s.call_analysis).toEqual(DEFAULT_ANALYSIS);
    expect(s.call_classification.confidence_threshold).toBe(0.7);
  });
  it("las cuatro reglas por defecto, en orden: la reunion vinculada ya no es una regla", () => {
    expect(DEFAULT_RULES.map((r) => `${r.cond}→${r.type}`)).toEqual(["duration_lt→no_show", "people_gte→equipo", "title_contains→equipo", "only_team→equipo"]);
  });
  it("un valor guardado invalido cae a su default SIN afectar a las otras", () => {
    const s = resolveCallTaskSettings({
      call_classification: { mode: "inventado" },
      call_analysis: { company_context: "Agencia" },
      message_classification: { mode: "off" },
    });
    expect(s.call_classification).toEqual(DEFAULT_CLASSIFICATION);
    expect(s.call_analysis.company_context).toBe("Agencia");
  });
  it("las claves viejas que quedaron guardadas no vuelven: lo decide cada analizador", () => {
    const s = resolveCallTaskSettings({ call_analysis: { mode: "now", analyze_types: ["cierre"], rubric: { version: 7 }, auto_summary: false, company_context: "Agencia" } });
    expect(s.call_analysis).toEqual({ ...DEFAULT_ANALYSIS, company_context: "Agencia" });
  });
  it("basura o undefined no rompe", () => {
    expect(resolveCallTaskSettings(null).call_analysis).toEqual(DEFAULT_ANALYSIS);
    expect(resolveCallTaskSettings("x").call_classification).toEqual(DEFAULT_CLASSIFICATION);
  });
  it("lee las categorias guardadas", () => {
    const s = resolveCallTaskSettings({ call_analysis: { ...DEFAULT_ANALYSIS, categories: { accepted: { dolores: [{ clave: "deudas", nombre: "Deudas" }] } } } });
    expect(s.call_analysis.categories.accepted.dolores[0].clave).toBe("deudas");
  });
  it("isCallTaskKey", () => {
    expect(isCallTaskKey("call_analysis")).toBe(true);
    expect(isCallTaskKey("message_classification")).toBe(false);
  });
});

describe("validateCallTaskSettings: clasificacion", () => {
  it("acepta la configuracion por defecto", () => {
    expect(validateCallTaskSettings("call_classification", DEFAULT_CLASSIFICATION).ok).toBe(true);
  });
  it("rechaza un umbral fuera de 0..1 y un modo inventado", () => {
    expect(validateCallTaskSettings("call_classification", { ...DEFAULT_CLASSIFICATION, confidence_threshold: 1.5 }).ok).toBe(false);
    expect(validateCallTaskSettings("call_classification", { ...DEFAULT_CLASSIFICATION, mode: "batch" }).ok).toBe(false);
  });
  it("un tipo propio no puede llamarse como uno del sistema ni repetirse", () => {
    const base = { clave: "cierre", nombre: "Cierre", descripcion: "", archivado: false };
    expect(validateCallTaskSettings("call_classification", { ...DEFAULT_CLASSIFICATION, custom_types: [base] }).ok).toBe(false);
    const a = { clave: "demo", nombre: "Demo", descripcion: "", archivado: false };
    expect(validateCallTaskSettings("call_classification", { ...DEFAULT_CLASSIFICATION, custom_types: [a, a] }).ok).toBe(false);
  });
  it("una regla no puede apuntar a un tipo que no existe", () => {
    const rules = [...DEFAULT_RULES.slice(0, 4), { id: "x", on: true, cond: "only_team" as const, value: null, type: "fantasma" }];
    const r = validateCallTaskSettings("call_classification", { ...DEFAULT_CLASSIFICATION, rules });
    expect(r).toMatchObject({ ok: false });
  });
  it("una regla puede apuntar a un tipo propio (no archivado)", () => {
    const custom = [{ clave: "demo", nombre: "Demo", descripcion: "", archivado: false }];
    const rules = [{ id: "x", on: true, cond: "title_contains" as const, value: ["demo"], type: "demo" }];
    expect(validateCallTaskSettings("call_classification", { ...DEFAULT_CLASSIFICATION, custom_types: custom, rules }).ok).toBe(true);
  });
  it("un tipo propio archivado ya no es un destino valido", () => {
    expect(validTypeKeys([{ clave: "demo", nombre: "Demo", descripcion: "", archivado: true }])).not.toContain("demo");
  });
});

describe("reglas que apuntan a la lista de la agenda", () => {
  const ID = "11111111-1111-4111-8111-111111111111";
  it("una regla puede apuntar a un area o tipo por su id", () => {
    const rules = [{ id: "x", on: true, cond: "title_contains" as const, value: ["demo"], type: ID }];
    expect(validateCallTaskSettings("call_classification", { ...DEFAULT_CLASSIFICATION, rules }).ok).toBe(true);
  });
  it("una regla guardada con la condicion de agenda se descarta al leer", () => {
    const old = { ...DEFAULT_CLASSIFICATION, rules: [{ id: "r5", on: true, cond: "has_appointment", value: null, type: "cierre" }] };
    expect(resolveCallTaskSettings({ call_classification: old }).call_classification.rules).toEqual([]);
  });
});

describe("validateCallTaskSettings: lo que comparten los analizadores", () => {
  const ok = (over: Partial<CallAnalysisSettings> = {}) => ({ ...DEFAULT_ANALYSIS, ...over });

  it("acepta la configuracion por defecto", () => {
    expect(validateCallTaskSettings("call_analysis", ok()).ok).toBe(true);
  });
  it("el contexto del negocio tiene tope de 4.000 caracteres", () => {
    expect(validateCallTaskSettings("call_analysis", ok({ company_context: "x".repeat(4001) })).ok).toBe(false);
    expect(validateCallTaskSettings("call_analysis", ok({ company_context: "x".repeat(4000) })).ok).toBe(true);
  });
  it("una clave vieja que llegue no se guarda", () => {
    const r = validateCallTaskSettings("call_analysis", { ...ok(), mode: "now", rubric: {} });
    expect(r.ok && r.task === "call_analysis" && r.value).toEqual(DEFAULT_ANALYSIS);
  });
  it("no acepta cualquier cosa como configuracion", () => {
    expect(validateCallTaskSettings("call_analysis", null).ok).toBe(false);
    expect(validateCallTaskSettings("call_analysis", ok({ allow_new_categories: "si" as never })).ok).toBe(false);
  });
});
