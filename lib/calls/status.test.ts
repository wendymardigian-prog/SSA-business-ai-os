import { describe, expect, it } from "vitest";
import { canAnalyze, nextStatusAfterClassify, statusLabel, statusReasonText } from "./status";

const base = { status: "pending" as const, callType: "cierre", analyzeTypes: ["cierre", "seguimiento"], hasTranscript: true, canEdit: true };

describe("statusLabel / statusReasonText", () => {
  it("cada estado tiene su etiqueta en castellano", () => {
    expect(statusLabel("classifying")).toBe("Clasificando…");
    expect(statusLabel("needs_review")).toBe("Por revisar");
    expect(statusLabel("analyzed")).toBe("Analizada");
    expect(statusLabel("not_applicable")).toBe("No aplica");
    expect(statusLabel("error")).toBe("Error");
    expect(statusLabel(null)).toBe("Pendiente");
  });
  it("el motivo se dice en palabras; uno desconocido no se inventa", () => {
    expect(statusReasonText("pending", "manual")).toBe("Esperando que alguien la analice");
    expect(statusReasonText("pending", "budget")).toContain("tope");
    expect(statusReasonText("pending", "raro")).toBeNull();
    expect(statusReasonText("pending", null)).toBeNull();
  });
});

describe("canAnalyze", () => {
  it("una llamada de cierre pendiente se puede analizar", () => {
    expect(canAnalyze(base)).toEqual({ ok: true });
  });
  it("el tipo triaje no se analiza: el boton no aparece", () => {
    const r = canAnalyze({ ...base, callType: "triaje" });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("no se analiza");
  });
  it("sin permiso, sin transcripcion, ya analizandose o sin clasificar: no, con su motivo", () => {
    expect(canAnalyze({ ...base, canEdit: false }).ok).toBe(false);
    expect(canAnalyze({ ...base, hasTranscript: false }).reason).toContain("transcripción");
    expect(canAnalyze({ ...base, status: "analyzing" }).reason).toContain("analizando");
    expect(canAnalyze({ ...base, status: "classifying" }).ok).toBe(false);
    expect(canAnalyze({ ...base, callType: null }).reason).toContain("tipo");
  });
  it("una ya analizada o con error se puede volver a analizar (regenerar es otra accion)", () => {
    expect(canAnalyze({ ...base, status: "error" }).ok).toBe(true);
    expect(canAnalyze({ ...base, status: "analyzed" }).ok).toBe(true);
  });
});

describe("nextStatusAfterClassify", () => {
  const o = { analyzeTypes: ["cierre", "seguimiento"], auto: false };
  it("con el automatico apagado, una de cierre queda pendiente con motivo manual y NO se encola", () => {
    expect(nextStatusAfterClassify("cierre", o)).toEqual({ status: "pending", reason: "manual", enqueueAnalysis: false });
  });
  it("con el automatico encendido se encola el analisis", () => {
    expect(nextStatusAfterClassify("cierre", { ...o, auto: true })).toEqual({ status: "pending", reason: null, enqueueAnalysis: true });
  });
  it("un tipo que no se analiza no aplica", () => {
    expect(nextStatusAfterClassify("equipo", { ...o, auto: true })).toEqual({ status: "not_applicable", reason: null, enqueueAnalysis: false });
  });
  it("confianza baja gana sobre todo: por revisar", () => {
    expect(nextStatusAfterClassify("cierre", { ...o, auto: true, lowConfidence: true }).status).toBe("needs_review");
  });
  it("sin transcripcion no se analiza solo: por revisar", () => {
    expect(nextStatusAfterClassify("cierre", { ...o, auto: true, hasTranscript: false })).toMatchObject({ status: "needs_review", reason: "no_transcript" });
  });
});
