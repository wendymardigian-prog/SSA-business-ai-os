import { describe, expect, it } from "vitest";
import { detailView, searchTranscript, transcriptStartLabel, type DetailViewInput } from "./detail-view";

const base: DetailViewInput = { status: "pending", reason: null, error: null, hasAnalysis: false, canEdit: true, canConfigure: true, analyze: { ok: true } };

describe("detailView: un estado, una pantalla", () => {
  it("sin analizar: las pestañas dicen que todavia no se analizo, con el motivo", () => {
    const v = detailView({ ...base, reason: "budget" });
    expect(v.analysisAvailable).toBe(false);
    expect(v.emptyMessage).toContain("Todavía no se analizó");
    expect(v.emptyMessage).toContain("tope de gasto");
    expect(v.banner).toMatchObject({ title: "Pendiente de análisis", action: "analyze" });
  });

  it("clasificando: banner con spinner y sin accion", () => {
    expect(detailView({ ...base, status: "classifying" }).banner).toMatchObject({ spinner: true, action: null });
  });

  it("por revisar: banner ambar con el selector de tipo (solo con permiso de editar)", () => {
    expect(detailView({ ...base, status: "needs_review", reason: "low_confidence" }).banner).toMatchObject({ tone: "warning", action: "choose_type" });
    expect(detailView({ ...base, status: "needs_review", canEdit: false }).banner?.action).toBeNull();
  });

  it("analizando: spinner", () => {
    expect(detailView({ ...base, status: "analyzing" }).banner).toMatchObject({ spinner: true });
  });

  it("error: el motivo en palabras y Reintentar", () => {
    const v = detailView({ ...base, status: "error", error: "La IA devolvió un análisis incompleto o mal formado" });
    expect(v.banner).toMatchObject({ tone: "error", action: "retry" });
    expect(v.banner?.message).toContain("incompleto");
  });

  it("no aplica: avisa y manda a la configuracion si se puede", () => {
    expect(detailView({ ...base, status: "not_applicable" }).banner).toMatchObject({ title: "Este tipo no se analiza", action: "config" });
    expect(detailView({ ...base, status: "not_applicable", canConfigure: false }).banner?.action).toBeNull();
  });

  it("analizada con analisis: pestañas con contenido y sin banner", () => {
    const v = detailView({ ...base, status: "analyzed", hasAnalysis: true });
    expect(v).toMatchObject({ analysisAvailable: true, banner: null, emptyMessage: null });
  });

  it("analizada pero sin analisis guardado: no inventa contenido", () => {
    expect(detailView({ ...base, status: "analyzed", hasAnalysis: false }).analysisAvailable).toBe(false);
  });

  it("si no se puede analizar, el boton sigue pero con su motivo", () => {
    const v = detailView({ ...base, analyze: { ok: false, reason: "La llamada no tiene transcripción" } });
    expect(v.banner?.actionDisabledReason).toBe("La llamada no tiene transcripción");
  });
});

describe("transcript helpers", () => {
  it("transcriptStartLabel", () => {
    expect(transcriptStartLabel("00:04:07")).toBe("4:07");
    expect(transcriptStartLabel("01:02:03")).toBe("1:02:03");
    expect(transcriptStartLabel("")).toBe("");
    expect(transcriptStartLabel("x")).toBe("");
  });
  it("searchTranscript ignora tildes y mayusculas y mira tambien al hablante", () => {
    const lines = [{ text: "La inversión es de 3 mil", speaker: { display_name: "Ana" } }, { text: "Ok", speaker: { display_name: "Lead" } }];
    expect(searchTranscript(lines, "INVERSION")).toEqual([0]);
    expect(searchTranscript(lines, "lead")).toEqual([1]);
    expect(searchTranscript(lines, "a")).toEqual([]); // muy corto
  });
});
