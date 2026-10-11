import { describe, expect, it } from "vitest";
import {
  DEFAULT_ANALYSIS, DEFAULT_CLASSIFICATION, DEFAULT_RULES, isCallTaskKey, newCustomType, resolveCallTaskSettings, validateCallTaskSettings,
  validTypeKeys, type CallAnalysisSettings,
} from "./task-settings";
import { DEFAULT_RUBRIC } from "./rubric";

describe("resolveCallTaskSettings", () => {
  it("sin nada guardado devuelve los defaults de las dos tareas", () => {
    const s = resolveCallTaskSettings({});
    expect(s.call_classification).toEqual(DEFAULT_CLASSIFICATION);
    expect(s.call_analysis).toEqual(DEFAULT_ANALYSIS);
    expect(s.call_analysis.mode).toBe("off"); // el primer gasto lo decide una persona
    expect(s.call_classification.confidence_threshold).toBe(0.7);
  });
  it("las cinco reglas por defecto de F17, en orden", () => {
    expect(DEFAULT_RULES.map((r) => `${r.cond}→${r.type}`)).toEqual(["duration_lt→no_show", "people_gte→equipo", "title_contains→equipo", "only_team→equipo", "has_appointment→cierre"]);
  });
  it("un valor guardado invalido cae a su default SIN afectar a las otras", () => {
    const s = resolveCallTaskSettings({
      call_classification: { mode: "inventado" },
      call_analysis: { mode: "now", analyze_types: ["cierre"] },
      message_classification: { mode: "off" },
    });
    expect(s.call_classification).toEqual(DEFAULT_CLASSIFICATION);
    expect(s.call_analysis.mode).toBe("now");
    expect(s.call_analysis.analyze_types).toEqual(["cierre"]);
  });
  it("basura o undefined no rompe", () => {
    expect(resolveCallTaskSettings(null).call_analysis).toEqual(DEFAULT_ANALYSIS);
    expect(resolveCallTaskSettings("x").call_classification).toEqual(DEFAULT_CLASSIFICATION);
  });
  it("lee la rubrica guardada y las categorias", () => {
    const s = resolveCallTaskSettings({ call_analysis: { ...DEFAULT_ANALYSIS, rubric: { ...DEFAULT_RUBRIC, version: 7 }, categories: { accepted: { dolores: [{ clave: "deudas", nombre: "Deudas" }] } } } });
    expect(s.call_analysis.rubric.version).toBe(7);
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
    const rules = [...DEFAULT_RULES.slice(0, 4), { id: "x", on: true, cond: "has_appointment" as const, value: null, type: "fantasma" }];
    const r = validateCallTaskSettings("call_classification", { ...DEFAULT_CLASSIFICATION, rules });
    expect(r).toMatchObject({ ok: false });
  });
  it("una regla puede apuntar a un tipo propio (no archivado)", () => {
    const custom = [{ clave: "demo", nombre: "Demo", descripcion: "", archivado: false }];
    const rules = [{ id: "x", on: true, cond: "title_contains" as const, value: ["demo"], type: "demo" }];
    expect(validateCallTaskSettings("call_classification", { ...DEFAULT_CLASSIFICATION, custom_types: custom, rules }).ok).toBe(true);
  });
  it("newCustomType arma una clave unica sin acentos", () => {
    expect(newCustomType("Demo Técnica", "x", []).clave).toBe("demo_tecnica");
    expect(newCustomType("Cierre", "x", []).clave).toBe("cierre_2");
    expect(validTypeKeys([{ clave: "demo", nombre: "Demo", descripcion: "", archivado: true }])).not.toContain("demo");
  });
});

describe("validateCallTaskSettings: analisis y rubrica", () => {
  const ok = (over: Partial<CallAnalysisSettings> = {}) => ({ ...DEFAULT_ANALYSIS, ...over });

  it("acepta la configuracion por defecto, con la rubrica en su version", () => {
    const r = validateCallTaskSettings("call_analysis", ok(), DEFAULT_ANALYSIS);
    expect(r.ok && r.task === "call_analysis" && r.value.rubric.version).toBe(1);
  });
  it("pesos del closer que suman 95: rechaza con el motivo y no cambia nada", () => {
    const rubric = structuredClone(DEFAULT_RUBRIC); rubric.closer[0].peso = 5;
    const r = validateCallTaskSettings("call_analysis", ok({ rubric }), DEFAULT_ANALYSIS);
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.error).toMatch(/suman 95/);
  });
  it("cambiar un peso sube la version en 1; cambiar solo un nombre no", () => {
    const peso = structuredClone(DEFAULT_RUBRIC); peso.closer[0].peso = 15; peso.closer[1].peso = 15;
    const a = validateCallTaskSettings("call_analysis", ok({ rubric: peso }), DEFAULT_ANALYSIS);
    expect(a.ok && a.task === "call_analysis" && a.value.rubric.version).toBe(2);
    const nombre = structuredClone(DEFAULT_RUBRIC); nombre.closer[0].nombre = "Otro nombre";
    const b = validateCallTaskSettings("call_analysis", ok({ rubric: nombre }), DEFAULT_ANALYSIS);
    expect(b.ok && b.task === "call_analysis" && b.value.rubric.version).toBe(1);
  });
  it("la version sale de la rubrica GUARDADA, no de la que manda el navegador", () => {
    const guardada = { ...DEFAULT_ANALYSIS, rubric: { ...DEFAULT_RUBRIC, version: 5 } };
    const mandada = { ...structuredClone(DEFAULT_RUBRIC), version: 99 };
    const r = validateCallTaskSettings("call_analysis", ok({ rubric: mandada }), guardada);
    expect(r.ok && r.task === "call_analysis" && r.value.rubric.version).toBe(5);
  });
  it("el contexto del negocio tiene tope de 4.000 caracteres", () => {
    expect(validateCallTaskSettings("call_analysis", ok({ company_context: "x".repeat(4001) })).ok).toBe(false);
    expect(validateCallTaskSettings("call_analysis", ok({ company_context: "x".repeat(4000) })).ok).toBe(true);
  });
  it("no acepta cualquier cosa como configuracion", () => {
    expect(validateCallTaskSettings("call_analysis", null).ok).toBe(false);
    expect(validateCallTaskSettings("call_analysis", ok({ mode: "batch" as never })).ok).toBe(false);
  });
});
