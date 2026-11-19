import { describe, expect, it } from "vitest";
import { aiKeyProviderStates, aiKeyRejectedMessage, isAiKeyRejection, rejectionStatusFromAttempt } from "./provider-states";

const NOW = new Date("2026-11-15T12:00:00Z");

describe("aiKeyProviderStates", () => {
  it("siempre devuelve los tres proveedores, en orden, sin conectar si no hay fila", () => {
    const states = aiKeyProviderStates([], NOW);
    expect(states.map((s) => s.id)).toEqual(["openai", "anthropic", "google_ai"]);
    expect(states.every((s) => s.state === "not_connected")).toBe(true);
  });

  it("activa sin error = conectada; desactivada = sin conectar aunque tenga un error viejo", () => {
    const states = aiKeyProviderStates(
      [
        { provider: "openai", is_active: true, last_error: null, updated_at: NOW.toISOString() },
        { provider: "anthropic", is_active: false, last_error: "rechazada", updated_at: NOW.toISOString() },
      ],
      NOW,
    );
    expect(states[0]).toMatchObject({ id: "openai", state: "connected", reason: null });
    expect(states[1]).toMatchObject({ id: "anthropic", state: "not_connected" });
  });

  it("activa con un error reciente = con error y su motivo", () => {
    const msg = aiKeyRejectedMessage("Google", 401);
    const [, , google] = aiKeyProviderStates([{ provider: "google_ai", is_active: true, last_error: msg, updated_at: NOW.toISOString() }], NOW);
    expect(google).toMatchObject({ state: "error", reason: msg });
  });

  it("un error de hace más de 7 días ya no la deja en rojo", () => {
    const old = new Date(NOW.getTime() - 8 * 86_400_000).toISOString();
    const [openai] = aiKeyProviderStates([{ provider: "openai", is_active: true, last_error: "x", updated_at: old }], NOW);
    expect(openai.state).toBe("connected");
  });

  it("ignora otros proveedores (Groq, Voyage)", () => {
    const states = aiKeyProviderStates([{ provider: "groq", is_active: true }], NOW);
    expect(states).toHaveLength(3);
    expect(states.every((s) => s.state === "not_connected")).toBe(true);
  });

  it("el texto del error nunca lleva la clave y está en español de España", () => {
    const msg = aiKeyRejectedMessage("OpenAI", 403);
    expect(msg).toBe("OpenAI rechazó la clave (HTTP 403). Reemplazala en Ajustes › Integraciones.");
  });
});

describe("rechazo de la clave", () => {
  it("solo 401 y 403", () => {
    expect(isAiKeyRejection(401)).toBe(true);
    expect(isAiKeyRejection(403)).toBe(true);
    expect(isAiKeyRejection(429)).toBe(false);
    expect(isAiKeyRejection(null)).toBe(false);
  });

  it("lee el estado del código de intento de las tareas", () => {
    expect(rejectionStatusFromAttempt("api_401:authentication_error")).toBe(401);
    expect(rejectionStatusFromAttempt("api_403")).toBe(403);
    expect(rejectionStatusFromAttempt("api_500")).toBeNull();
    expect(rejectionStatusFromAttempt("timeout")).toBeNull();
    expect(rejectionStatusFromAttempt("api_4010")).toBeNull();
  });
});
