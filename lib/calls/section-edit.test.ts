import { describe, expect, it } from "vitest";
import { applySectionEdits, deriveColumns, validateSectionValue } from "./section-edit";
import type { ScoringRubric } from "./scoring";

const rubric: ScoringRubric = {
  closer: [
    { clave: "rapport", peso: 50 },
    { clave: "cierre", peso: 50 },
  ],
  lead: [{ clave: "urgencia", peso: 100 }],
};
const transcript = "[0] Ana: no me llegan clientes y estoy desesperada";
const base = () => ({
  resultado: { categoria: "seguimiento_con_fecha", fecha: "2026-10-20" },
  resumen: "Resumen",
  objecion: { dijo: "caro", categoria: "precio", cita: "no me llegan clientes" },
  rubrica: [
    { codigo: "rapport", nombre: "Rapport", puntaje: 5, justificacion: "ok" },
    { codigo: "cierre", nombre: "Cierre", puntaje: 1, justificacion: "flojo" },
  ],
  lead: { perfil: "p", creencias: [{ codigo: "urgencia", nombre: "Urgencia", estado: "Débil" }] },
  feedback: { foco: "f", funciono: ["a"], mejorar: [{ texto: "m" }] },
  closer_score: 50,
  lead_score: 0,
});
const ctx = { rubric, callType: "cierre", transcript };

describe("validateSectionValue", () => {
  it("rechaza secciones que no existen o vacias", () => {
    expect(validateSectionValue("alertas", [])).toBeTruthy();
    expect(validateSectionValue("resumen", "")).toBeTruthy();
    expect(validateSectionValue("resumen", null)).toBeTruthy();
    expect(validateSectionValue("resumen", "Un resumen")).toBeNull();
  });
  it("la rubrica pide puntajes enteros de 1 a 5", () => {
    expect(validateSectionValue("rubrica", [{ codigo: "a", puntaje: 6 }])).toBeTruthy();
    expect(validateSectionValue("rubrica", [{ codigo: "a", puntaje: 3.5 }])).toBeTruthy();
    expect(validateSectionValue("rubrica", [{ codigo: "a", puntaje: 4 }])).toBeNull();
  });
  it("el resultado necesita categoria; el feedback, textos", () => {
    expect(validateSectionValue("resultado", { fecha: "x" })).toBeTruthy();
    expect(validateSectionValue("resultado", { categoria: "venta" })).toBeNull();
    expect(validateSectionValue("feedback.funciono", [1])).toBeTruthy();
    expect(validateSectionValue("feedback.mejorar", [{ texto: "" }])).toBeTruthy();
    expect(validateSectionValue("lead.creencias", [{ codigo: "a" }])).toBeTruthy();
    expect(validateSectionValue("lead.creencias", [{ codigo: "a", estado: "Quizás" }])).toBeTruthy();
    expect(validateSectionValue("lead.creencias", [{ codigo: "a", estado: "No explorado" }])).toBeNull();
    expect(validateSectionValue("resultado", { categoria: "inventada" })).toBeTruthy();
  });
  it("un contenido gigante se rechaza", () => {
    expect(validateSectionValue("resumen", "x".repeat(60_000))).toBeTruthy();
  });
});

describe("applySectionEdits", () => {
  it("cambia la seccion y recalcula los puntajes con la rubrica de la llamada", () => {
    const edited = [{ codigo: "rapport", nombre: "Rapport", puntaje: 5, justificacion: "ok" }, { codigo: "cierre", nombre: "Cierre", puntaje: 5, justificacion: "bien" }];
    const r = applySectionEdits(base(), [{ section: "rubrica", value: edited }], ctx);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.columns.closer_score).toBe(100);
      expect((r.analysis as { closer_score: number }).closer_score).toBe(100);
      expect(r.changes[0]).toMatchObject({ section: "rubrica" });
    }
  });

  it("el estado de una creencia cambia el puntaje del lead y la calificacion", () => {
    const r = applySectionEdits(base(), [{ section: "lead.creencias", value: [{ codigo: "urgencia", nombre: "Urgencia", estado: "Firme" }] }], ctx);
    expect(r.ok && r.columns.lead_score).toBe(100);
    expect(r.ok && r.columns.lead_qualification).toBe("calificado");
  });

  it("cambiar el resultado a no_calificaba descalifica al lead aunque sus creencias esten firmes", () => {
    const r = applySectionEdits(base(), [{ section: "resultado", value: { categoria: "no_calificaba" } }, { section: "lead.creencias", value: [{ codigo: "urgencia", nombre: "u", estado: "Firme" }] }], ctx);
    expect(r.ok && r.columns.lead_qualification).toBe("no_calificado");
    expect(r.ok && r.columns.outcome).toBe("no_calificaba");
  });

  it("no toca el objeto original (analysis_ai queda como estaba)", () => {
    const original = base();
    const snapshot = JSON.stringify(original);
    applySectionEdits(original, [{ section: "resumen", value: "Otro resumen" }], ctx);
    expect(JSON.stringify(original)).toBe(snapshot);
  });

  it("si una edicion no vale, no se aplica ninguna", () => {
    const r = applySectionEdits(base(), [{ section: "resumen", value: "ok" }, { section: "rubrica", value: [{ codigo: "a", puntaje: 9 }] }], ctx);
    expect(r.ok).toBe(false);
  });

  it("rechaza secciones repetidas, listas vacias y analisis inexistente", () => {
    expect(applySectionEdits(base(), [{ section: "resumen", value: "a" }, { section: "resumen", value: "b" }], ctx).ok).toBe(false);
    expect(applySectionEdits(base(), [], ctx).ok).toBe(false);
    expect(applySectionEdits(null, [{ section: "resumen", value: "a" }], ctx).ok).toBe(false);
  });

  it("recalcula las citas verificadas contra la transcripcion", () => {
    const r = applySectionEdits(base(), [{ section: "objecion", value: { dijo: "x", categoria: "precio", cita: "esto no se dijo nunca" } }], ctx);
    expect(r.ok && r.columns.quotes_total).toBe(1);
    expect(r.ok && r.columns.quotes_verified).toBe(0);
  });
});

describe("deriveColumns", () => {
  it("sin rubrica usa el promedio simple y la fecha de seguimiento valida", () => {
    const c = deriveColumns(base(), null, "cierre", transcript);
    expect(c.closer_score).toBe(50);
    expect(c.followup_at).toContain("2026-10-20");
    expect(c.main_objection).toBe("precio");
  });
});
