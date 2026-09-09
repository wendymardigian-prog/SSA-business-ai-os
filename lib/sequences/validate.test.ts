import { describe, it, expect } from "vitest";
import { canActivate, validateSequenceName, validateSequenceSteps } from "./validate";

describe("validateSequenceName", () => {
  it("rechaza el nombre vacio y el que es solo espacios", () => {
    expect(validateSequenceName("")).toMatchObject({ ok: false });
    expect(validateSequenceName("   ")).toMatchObject({ ok: false });
  });

  it("recorta los bordes", () => {
    expect(validateSequenceName("  Bienvenida  ")).toEqual({ ok: true, value: "Bienvenida" });
  });
});

describe("validateSequenceSteps", () => {
  it("rechaza un paso de mensaje sin texto: el procesador mandaria un DM en blanco", () => {
    const result = validateSequenceSteps([{ type: "message", content: "   " }]);
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.error).toContain("paso 1");
  });

  it("rechaza una espera de cero o negativa", () => {
    expect(validateSequenceSteps([{ type: "delay", delayMinutes: 0 }])).toMatchObject({ ok: false });
    expect(validateSequenceSteps([{ type: "delay", delayMinutes: -5 }])).toMatchObject({ ok: false });
  });

  it("rechaza un paso de IA sin consigna", () => {
    expect(validateSequenceSteps([{ type: "aiMessage", prompt: "" }])).toMatchObject({ ok: false });
  });

  it("limpia los campos que sobran de otro tipo de paso", () => {
    const result = validateSequenceSteps([
      { type: "message", content: "hola", delayMinutes: 99, prompt: "sobra" },
    ]);
    expect(result).toEqual({ ok: true, value: [{ type: "message", content: "hola" }] });
  });

  it("conserva proveedor y modelo del paso de IA cuando estan", () => {
    const result = validateSequenceSteps([
      { type: "aiMessage", prompt: "recordale la promo", provider: "anthropic", model: "claude-x" },
    ]);
    expect(result).toEqual({
      ok: true,
      value: [
        { type: "aiMessage", prompt: "recordale la promo", provider: "anthropic", model: "claude-x" },
      ],
    });
  });

  it("rechaza un tipo de paso desconocido en vez de guardarlo y romper en el cron", () => {
    expect(validateSequenceSteps([{ type: "webhook" }])).toMatchObject({ ok: false });
  });

  it("acepta una lista vacia: una secuencia en borrador todavia no tiene pasos", () => {
    expect(validateSequenceSteps([])).toEqual({ ok: true, value: [] });
  });
});

describe("canActivate", () => {
  it("no deja activar una secuencia sin pasos", () => {
    expect(canActivate([])).toMatchObject({ ok: false });
  });

  it("no deja activar una secuencia que solo espera", () => {
    expect(canActivate([{ type: "delay", delayMinutes: 60 }])).toMatchObject({ ok: false });
  });

  it("un paso de IA alcanza para activar, igual que uno de mensaje", () => {
    expect(canActivate([{ type: "aiMessage", prompt: "escribile" }])).toEqual({
      ok: true,
      value: true,
    });
  });
});
