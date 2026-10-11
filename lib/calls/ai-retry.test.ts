import { describe, expect, it } from "vitest";
import { AI_RETRY_DELAYS_MS, decideAiFailure, isTruncated } from "./ai-retry";
import { TruncatedOutputError } from "./ai-generate";

const status = (code: number) => Object.assign(new Error(`HTTP ${code}`), { statusCode: code });

describe("decideAiFailure", () => {
  it("un 429 se reintenta al minuto, despues a los 5 y a los 15", () => {
    expect(decideAiFailure(status(429), 0)).toEqual({ action: "retry", delayMs: 60_000, nextRetry: 1 });
    expect(decideAiFailure(status(429), 1)).toEqual({ action: "retry", delayMs: 300_000, nextRetry: 2 });
    expect(decideAiFailure(status(503), 2)).toEqual({ action: "retry", delayMs: 900_000, nextRetry: 3 });
  });

  it("agotados los intentos, se rinde (pero no es permanente)", () => {
    const d = decideAiFailure(status(429), AI_RETRY_DELAYS_MS.length);
    expect(d).toMatchObject({ action: "give_up", permanent: false });
  });

  it("una key invalida no se reintenta", () => {
    expect(decideAiFailure(status(401), 0)).toMatchObject({ action: "give_up", permanent: true });
    expect(decideAiFailure(status(400), 0)).toMatchObject({ action: "give_up", permanent: true });
  });

  it("un corte de red sin status se reintenta", () => {
    expect(decideAiFailure(new Error("fetch failed"), 0).action).toBe("retry");
  });

  it("el mensaje se recorta y nunca viene vacio", () => {
    const d = decideAiFailure(status(401), 0);
    expect(d.action === "give_up" && d.message.length).toBeGreaterThan(0);
  });
});

describe("isTruncated", () => {
  it("reconoce la respuesta cortada por largo", () => {
    expect(isTruncated(new TruncatedOutputError())).toBe(true);
    expect(isTruncated(new Error("x"))).toBe(false);
  });
});
