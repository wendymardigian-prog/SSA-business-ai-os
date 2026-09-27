import { describe, it, expect } from "vitest";
import { validateAgentConfig, validateSystemPrompt, promptLengthState } from "./validate";
import { guardrailsSchema, outputFormatSchema } from "./schemas";

const valid = {
  name: "Asistente",
  provider: "anthropic",
  model: "claude-sonnet-5",
  fallbackProvider: null,
  fallbackModel: null,
  temperature: 0.7,
  maxOutputTokens: 500,
  modelTimeoutSeconds: 120,
  bundleWindowSeconds: 60,
  responseDelaySeconds: 20,
  maxWaitSeconds: 300,
  externalReplyCooldownMinutes: 10,
  maxRepliesPerConversation: 12,
  burstMaxAgeHours: 6,
  closeAfterInactiveHours: 12,
  summaryOnClose: true,
  classifyOnClose: true,
  outputFormat: outputFormatSchema.parse({}),
  guardrails: guardrailsSchema.parse({}),
  dailyCostLimitUsd: 5,
  dailyCostLimitAction: "notify",
  monthlyCostLimitUsd: 100,
  monthlyCostLimitAction: "disable",
};

describe("validacion server-side de la configuracion del agente", () => {
  it("los defaults son validos", () => {
    expect(validateAgentConfig(valid).ok).toBe(true);
  });

  it("demora + timeout que no entran en la invocacion se rechazan (no solo el timeout)", () => {
    // 120 + 150 + 30 = 300: no entra en maxDuration 300.
    const r = validateAgentConfig({ ...valid, responseDelaySeconds: 150, modelTimeoutSeconds: 120 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("demora");
    // Y el timeout solo, dentro de su rango, con poca demora, si entra.
    expect(validateAgentConfig({ ...valid, responseDelaySeconds: 0, modelTimeoutSeconds: 240 }).ok).toBe(true);
  });

  it("el tope de espera no puede ser menor que la ventana", () => {
    expect(validateAgentConfig({ ...valid, bundleWindowSeconds: 120, maxWaitSeconds: 60 }).ok).toBe(false);
  });

  it("el respaldo no puede ser el mismo modelo que el principal", () => {
    expect(
      validateAgentConfig({ ...valid, fallbackProvider: "anthropic", fallbackModel: "claude-sonnet-5" }).ok,
    ).toBe(false);
  });

  it("un tema vedado vacio en la lista no pasa", () => {
    const guardrails = { ...valid.guardrails, blockedTopics: { enabled: true, phrases: [""] } };
    expect(validateAgentConfig({ ...valid, guardrails }).ok).toBe(false);
  });

  it("un horario con inicio posterior al fin no pasa", () => {
    const guardrails = {
      ...valid.guardrails,
      businessHours: { ...valid.guardrails.businessHours, enabled: true, slots: [{ day: 1, start: "18:00", end: "09:00" }] },
    };
    expect(validateAgentConfig({ ...valid, guardrails }).ok).toBe(false);
  });
});

describe("system prompt", () => {
  it("normaliza saltos de linea y rechaza uno vacio", () => {
    expect(validateSystemPrompt("   ").ok).toBe(false);
    expect(validateSystemPrompt("Sos el asistente del negocio.\r\nRespondé breve.")).toEqual({
      ok: true,
      value: "Sos el asistente del negocio.\nRespondé breve.",
    });
  });

  it("acepta hasta 32.000 caracteres y rechaza 32.001 con mensaje claro", () => {
    expect(validateSystemPrompt("a".repeat(31_999)).ok).toBe(true);
    expect(validateSystemPrompt("a".repeat(32_000)).ok).toBe(true);
    const over = validateSystemPrompt("a".repeat(32_001));
    expect(over.ok).toBe(false);
    expect(over.ok === false && over.error).toContain("32000");
  });
});

describe("promptLengthState", () => {
  it("gris por debajo del aviso, ambar al acercarse, rojo por encima del tope", () => {
    expect(promptLengthState(1_000).tone).toBe("ok");
    expect(promptLengthState(1_000).message).toBeNull();
    expect(promptLengthState(29_000).tone).toBe("warning");
    expect(promptLengthState(29_000).message).toContain("caracteres");
    expect(promptLengthState(32_000).tone).toBe("warning");
    const over = promptLengthState(32_100);
    expect(over.tone).toBe("over");
    expect(over.message).toContain("100");
  });
});
