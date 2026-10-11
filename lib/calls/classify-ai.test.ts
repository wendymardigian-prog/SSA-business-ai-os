import { describe, expect, it, vi } from "vitest";
import { classifyCallWithAi, decideClassification } from "./classify-ai";
import { DEFAULT_CLASSIFICATION, type CallClassificationSettings } from "./task-settings";

const settings = (over: Partial<CallClassificationSettings> = {}): CallClassificationSettings => ({
  ...structuredClone(DEFAULT_CLASSIFICATION),
  confidence_threshold: 0.7,
  ...over,
});
const out = (o: Record<string, unknown> = {}) => ({ tipo: "cierre", confianza: 0.9, alternativa: null, motivo: "Se hablo de precio", tipo_propuesto: null, ...o }) as never;

describe("decideClassification", () => {
  it("acepta un tipo valido con confianza suficiente", () => {
    const d = decideClassification(out(), settings());
    expect(d).toMatchObject({ type: "cierre", confidence: 0.9, lowConfidence: false, invalidType: false, proposed: null });
  });

  it("la confianza bajo el umbral deja la llamada por revisar", () => {
    expect(decideClassification(out({ confianza: 0.5 }), settings()).lowConfidence).toBe(true);
    expect(decideClassification(out({ confianza: 0.7 }), settings()).lowConfidence).toBe(false);
  });

  it("un tipo inventado se trata como otra, por revisar y con confianza baja", () => {
    const d = decideClassification(out({ tipo: "venta_magica", confianza: 0.95 }), settings());
    expect(d).toMatchObject({ type: "otra", invalidType: true, lowConfidence: true });
    expect(d.confidence).toBeLessThanOrEqual(0.3);
  });

  it("acepta un tipo propio y descarta una alternativa que no existe", () => {
    const s = settings({ custom_types: [{ clave: "demo", nombre: "Demo", descripcion: "", archivado: false }] });
    const d = decideClassification(out({ tipo: "demo", alternativa: "fantasma" }), s);
    expect(d.type).toBe("demo");
    expect(d.alternative).toBeNull();
  });

  it("un tipo propio archivado ya no es valido", () => {
    const s = settings({ custom_types: [{ clave: "demo", nombre: "Demo", descripcion: "", archivado: true }] });
    expect(decideClassification(out({ tipo: "demo" }), s).invalidType).toBe(true);
  });

  it("la alternativa igual al tipo se ignora", () => {
    expect(decideClassification(out({ alternativa: "cierre" }), settings()).alternative).toBeNull();
    expect(decideClassification(out({ alternativa: "seguimiento" }), settings()).alternative).toBe("seguimiento");
  });

  describe("tipo propuesto", () => {
    it("solo cuando esta permitido y el tipo es otra", () => {
      const o = out({ tipo: "otra", tipo_propuesto: "Webinar" });
      expect(decideClassification(o, settings({ allow_ai_types: true })).proposed).toBe("Webinar");
      expect(decideClassification(o, settings({ allow_ai_types: false })).proposed).toBeNull();
      expect(decideClassification(out({ tipo: "cierre", tipo_propuesto: "Webinar" }), settings({ allow_ai_types: true })).proposed).toBeNull();
    });
    it("no propone uno descartado ni uno que ya existe", () => {
      const s = settings({ allow_ai_types: true, discarded_types: ["Webinar"] });
      expect(decideClassification(out({ tipo: "otra", tipo_propuesto: "webinar" }), s).proposed).toBeNull();
      expect(decideClassification(out({ tipo: "otra", tipo_propuesto: "Cierre" }), s).proposed).toBeNull();
    });
  });
});

describe("classifyCallWithAi", () => {
  const call = { title: "Llamada", attendees: [], transcript: [{ timestamp: "0", speaker: { display_name: "Ana" }, text: "hola" }] };

  it("arma el pedido con la transcripcion como dato y usa lo que devuelve generate", async () => {
    const generate = vi.fn().mockResolvedValue({ object: { tipo: "triaje", confianza: 0.8, motivo: "corta" }, usage: { inputTokens: 10, outputTokens: 5 } });
    const r = await classifyCallWithAi({ call, settings: settings(), instructions: "Tipos: {{tipos}}", generate, nonce: "n1" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.decision.type).toBe("triaje");
      expect(r.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    }
    const arg = generate.mock.calls[0][0];
    expect(arg.system).toContain("Tipos: cierre,");
    expect(arg.prompt).toContain("<<<llamada n1>>>");
  });

  it("si generate falla, devuelve el error sin lanzar", async () => {
    const generate = vi.fn().mockRejectedValue(new Error("429 rate limit"));
    const r = await classifyCallWithAi({ call, settings: settings(), instructions: "x", generate });
    expect(r).toMatchObject({ ok: false, error: "429 rate limit" });
  });
});
