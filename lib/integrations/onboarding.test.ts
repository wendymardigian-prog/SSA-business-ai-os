import { describe, it, expect } from "vitest";
import { missingEssentials, shouldShowBanner, ONBOARDING_DISMISS_DAYS } from "./onboarding";
import type { IntegrationStatus } from "./status";

function statusOf(statuses: Record<string, IntegrationStatus>) {
  return (id: string) => statuses[id];
}

describe("missingEssentials", () => {
  it("workspace nuevo: faltan los tres", () => {
    const missing = missingEssentials(statusOf({}));
    expect(missing.map((m) => m.key)).toEqual(["messaging", "ai_text", "email"]);
  });

  it("con Evolution conectado, mensajeria ya no falta", () => {
    const missing = missingEssentials(statusOf({ evolution: "connected" }));
    expect(missing.map((m) => m.key)).toEqual(["ai_text", "email"]);
  });

  it("zernio en atencion (no not_connected) ya cuenta como empezado", () => {
    const missing = missingEssentials(statusOf({ zernio: "attention" }));
    expect(missing.map((m) => m.key)).not.toContain("messaging");
  });

  it("cualquier proveedor de IA de texto resuelve ai_text, Voyage (embeddings) no", () => {
    const soloVoyage = missingEssentials(statusOf({ voyage: "connected" }));
    expect(soloVoyage.map((m) => m.key)).toContain("ai_text");

    const conOpenAi = missingEssentials(statusOf({ openai: "connected" }));
    expect(conOpenAi.map((m) => m.key)).not.toContain("ai_text");
  });

  it("con los tres minimos, no falta nada", () => {
    const missing = missingEssentials(
      statusOf({ zernio: "connected", anthropic: "connected", resend: "connected" }),
    );
    expect(missing).toEqual([]);
  });
});

describe("shouldShowBanner", () => {
  const NOW = new Date("2026-10-01T12:00:00.000Z");

  it("nunca se descarto: se muestra", () => {
    expect(shouldShowBanner(null, NOW)).toBe(true);
  });

  it("descartada hoy: no se muestra", () => {
    expect(shouldShowBanner(NOW.toISOString(), NOW)).toBe(false);
  });

  it(`pasados los ${ONBOARDING_DISMISS_DAYS} dias, vuelve`, () => {
    const haceUnaSemana = new Date(NOW.getTime() - ONBOARDING_DISMISS_DAYS * 24 * 60 * 60 * 1000);
    expect(shouldShowBanner(haceUnaSemana.toISOString(), NOW)).toBe(true);
  });

  it("una fecha invalida no bloquea la franja", () => {
    expect(shouldShowBanner("no es una fecha", NOW)).toBe(true);
  });
});
