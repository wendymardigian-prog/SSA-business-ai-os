import { describe, it, expect } from "vitest";
import { buildUsage, USAGE_ATTENTION_RATIO } from "./usage";
import { getProvider, type ProviderDefinition } from "./providers";

const zernio = getProvider("zernio")!;
const postproxy = getProvider("postproxy")!;
const anthropic = getProvider("anthropic")!;

describe("barra de uso (F6)", () => {
  it("una integracion que no cuenta nada no tiene barra", () => {
    expect(buildUsage(anthropic, 3)).toBeNull();
  });

  it("Zernio con una cuenta usada muestra 1 de 2 y no avisa nada", () => {
    const usage = buildUsage(zernio, 1)!;

    expect(usage.text).toBe("1 de 2 cuentas conectadas");
    expect(usage.ratio).toBe(0.5);
    expect(usage.atLimit).toBe(false);
    expect(usage.needsAttention).toBe(false);
    expect(usage.hint).toBeUndefined();
  });

  it("Zernio con las 2 cuentas avisa que la siguiente se paga", () => {
    const usage = buildUsage(zernio, 2)!;

    expect(usage.text).toBe("2 de 2 cuentas conectadas");
    expect(usage.atLimit).toBe(true);
    expect(usage.needsAttention).toBe(true);
    expect(usage.hint).toContain("6");
  });

  it("pasarse del tope no dibuja una barra mas larga que el tope", () => {
    // Puede pasar si alguien conecta cuentas fuera del sistema.
    const usage = buildUsage(zernio, 5)!;

    expect(usage.used).toBe(5);
    expect(usage.ratio).toBe(1);
    expect(usage.atLimit).toBe(true);
  });

  it("el aviso de atencion entra justo en el 90 %", () => {
    // Postproxy: 10 por mes. 9 es el 90 % exacto.
    expect(buildUsage(postproxy, 8)!.needsAttention).toBe(false);
    expect(buildUsage(postproxy, 9)!.needsAttention).toBe(true);
    expect(9 / 10).toBeGreaterThanOrEqual(USAGE_ATTENTION_RATIO);
  });

  it("sin uso todavia muestra cero, no una barra vacia sin texto", () => {
    const usage = buildUsage(zernio, 0)!;

    expect(usage.text).toBe("0 de 2 cuentas conectadas");
    expect(usage.ratio).toBe(0);
  });

  it("un numero roto se trata como cero en vez de romper la pantalla", () => {
    expect(buildUsage(zernio, Number.NaN)!.used).toBe(0);
    expect(buildUsage(zernio, -3)!.used).toBe(0);
  });

  it("sin tope conocido se muestra el numero y no hay barra", () => {
    const sinTope: ProviderDefinition = {
      ...zernio,
      usage: { label: "envios este mes", limit: null },
    };
    const usage = buildUsage(sinTope, 42)!;

    expect(usage.text).toBe("42 envios este mes");
    expect(usage.ratio).toBeNull();
    expect(usage.needsAttention).toBe(false);
  });
});
