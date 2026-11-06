import { describe, expect, it, vi } from "vitest";
import { classifyCallWithAi, decideClassification } from "./classify-ai";

const options = [
  { label: "Ventas · Cierre", categoryId: "t-cierre", description: null },
  { label: "Ventas · Seguimiento", categoryId: "t-seguimiento", description: null },
  { label: "Otros", categoryId: "a-otros", description: null },
];
const out = (o: Record<string, unknown> = {}) => ({ tipo: "Ventas · Cierre", confianza: 0.9, alternativa: null, motivo: "Se hablo de precio", ...o }) as never;

describe("decideClassification", () => {
  it("acepta una opcion de la lista con confianza suficiente", () => {
    expect(decideClassification(out(), options, 0.7)).toMatchObject({ categoryId: "t-cierre", confidence: 0.9, lowConfidence: false, invalidType: false });
  });

  it("la confianza bajo el umbral deja la llamada por revisar", () => {
    expect(decideClassification(out({ confianza: 0.5 }), options, 0.7).lowConfidence).toBe(true);
    expect(decideClassification(out({ confianza: 0.7 }), options, 0.7).lowConfidence).toBe(false);
  });

  it("lo que no esta en la lista no se acepta: queda sin clasificar y por revisar", () => {
    const d = decideClassification(out({ tipo: "Venta magica", confianza: 0.95 }), options, 0.7);
    expect(d).toMatchObject({ categoryId: null, invalidType: true, lowConfidence: true });
    expect(d.confidence).toBeLessThanOrEqual(0.3);
  });

  it("una opcion que no se ofrecio tampoco, aunque exista en otra area", () => {
    expect(decideClassification(out({ tipo: "Servicio · Onboarding" }), options, 0.7).categoryId).toBeNull();
  });

  it("descarta una alternativa que no existe o que es la misma", () => {
    expect(decideClassification(out({ alternativa: "fantasma" }), options, 0.7).alternative).toBeNull();
    expect(decideClassification(out({ alternativa: "Ventas · Cierre" }), options, 0.7).alternative).toBeNull();
    expect(decideClassification(out({ alternativa: "Ventas · Seguimiento" }), options, 0.7).alternative).toBe("Ventas · Seguimiento");
  });
});

describe("classifyCallWithAi", () => {
  const call = { title: "Llamada", attendees: [], transcript: [{ timestamp: "0", speaker: { display_name: "Ana" }, text: "hola" }] };

  it("arma el pedido con la transcripcion como dato y usa lo que devuelve generate", async () => {
    const generate = vi.fn().mockResolvedValue({ object: { tipo: "Ventas · Seguimiento", confianza: 0.8, motivo: "corta" }, usage: { inputTokens: 10, outputTokens: 5 } });
    const r = await classifyCallWithAi({ call, options, confidenceThreshold: 0.7, instructions: "Tipos: {{tipos}}", generate, nonce: "n1" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.decision.categoryId).toBe("t-seguimiento");
      expect(r.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    }
    const arg = generate.mock.calls[0][0];
    expect(arg.system).toContain("Tipos: Ventas · Cierre,");
    expect(arg.prompt).toContain("<<<llamada n1>>>");
  });

  it("si generate falla, devuelve el error sin lanzar", async () => {
    const generate = vi.fn().mockRejectedValue(new Error("429 rate limit"));
    const r = await classifyCallWithAi({ call, options, confidenceThreshold: 0.7, instructions: "x", generate });
    expect(r).toMatchObject({ ok: false, error: "429 rate limit" });
  });
});
