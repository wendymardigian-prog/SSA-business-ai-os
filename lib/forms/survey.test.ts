import { describe, it, expect } from "vitest";
import { npsCategory, validateSurveyConfig, parseStoredSurveyConfig, scoreCandidates, scoreOfAnswers, scaleOf } from "./survey";
import { newField } from "./fields";

const nps = (required = true) => ({ ...newField("nps", "nps", "NPS"), required });
const rating = (required = true) => ({ ...newField("rating", "estrellas", "Estrellas"), required });
const text = () => newField("short_text", "texto", "Texto");

describe("npsCategory", () => {
  it("9-10 promotor, 7-8 pasivo, 0-6 detractor", () => {
    expect(npsCategory(10)).toBe("promoter");
    expect(npsCategory(9)).toBe("promoter");
    expect(npsCategory(8)).toBe("passive");
    expect(npsCategory(7)).toBe("passive");
    expect(npsCategory(6)).toBe("detractor");
    expect(npsCategory(0)).toBe("detractor");
  });
});

describe("validateSurveyConfig", () => {
  const config = (over = {}) => ({ scoreFieldKey: "nps", category: "servicio", oncePerContact: false, ...over });

  it("acepta un campo NPS obligatorio", () => {
    expect(validateSurveyConfig(config(), [nps(), text()]).ok).toBe(true);
  });
  it("acepta uno de estrellas", () => {
    expect(validateSurveyConfig(config({ scoreFieldKey: "estrellas" }), [rating()]).ok).toBe(true);
  });
  it("rechaza un campo que no existe, que no es de puntaje o que es opcional", () => {
    expect(validateSurveyConfig(config({ scoreFieldKey: "otro" }), [nps()]).ok).toBe(false);
    expect(validateSurveyConfig(config({ scoreFieldKey: "texto" }), [text()]).ok).toBe(false);
    expect(validateSurveyConfig(config(), [nps(false)]).ok).toBe(false);
  });
  it("rechaza una categoría desconocida", () => {
    expect(validateSurveyConfig(config({ category: "inventada" }), [nps()]).ok).toBe(false);
  });
});

describe("helpers", () => {
  it("parseStoredSurveyConfig no lanza con basura", () => {
    expect(parseStoredSurveyConfig(null)).toBeNull();
    expect(parseStoredSurveyConfig({ scoreFieldKey: 3 })).toBeNull();
    expect(parseStoredSurveyConfig({ scoreFieldKey: "nps", category: "cierre", oncePerContact: true })).toEqual({ scoreFieldKey: "nps", category: "cierre", oncePerContact: true });
  });
  it("scoreCandidates ofrece solo estrellas o NPS obligatorios", () => {
    expect(scoreCandidates([nps(), rating(false), text()]).map((f) => f.key)).toEqual(["nps"]);
  });
  it("scaleOf distingue estrellas de NPS", () => {
    expect(scaleOf(rating())).toBe("stars");
    expect(scaleOf(nps())).toBe("nps");
    expect(scaleOf(undefined)).toBe("nps");
  });
  it("scoreOfAnswers: un NPS da puntaje y categoría; estrellas, solo puntaje; sin valor, nada", () => {
    expect(scoreOfAnswers("nps", { nps: { type: "nps", value: 9 } })).toEqual({ score: 9, category: "promoter" });
    expect(scoreOfAnswers("e", { e: { type: "rating", value: 4 } })).toEqual({ score: 4, category: null });
    expect(scoreOfAnswers("nps", { nps: { type: "nps", value: "9" } })).toEqual({ score: null, category: null });
    expect(scoreOfAnswers("x", {})).toEqual({ score: null, category: null });
    expect(scoreOfAnswers(null, { nps: { type: "nps", value: 9 } })).toEqual({ score: null, category: null });
    expect(scoreOfAnswers("nps", { nps: { type: "nps", value: 6.6 } })).toEqual({ score: 7, category: "passive" });
  });
});
