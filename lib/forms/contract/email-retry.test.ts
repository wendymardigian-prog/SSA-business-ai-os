import { describe, it, expect } from "vitest";
import { classifyEmailError, nextEmailRetryAt, emailJobKey, EMAIL_RETRY_MINUTES } from "./email-retry";

describe("classifyEmailError", () => {
  it("429 y 5xx son transitorios", () => {
    expect(classifyEmailError(429, "")).toBe("transient");
    expect(classifyEmailError(500, "boom")).toBe("transient");
    expect(classifyEmailError(503, "")).toBe("transient");
  });
  it("un 4xx que no es 429 es permanente", () => {
    expect(classifyEmailError(422, "invalid to")).toBe("permanent");
    expect(classifyEmailError(401, "api key")).toBe("permanent");
    expect(classifyEmailError(400, "")).toBe("permanent");
  });
  it("sin estado: la red o un mensaje desconocido se reintentan", () => {
    expect(classifyEmailError(0, "fetch failed")).toBe("transient");
    expect(classifyEmailError(0, "ECONNRESET")).toBe("transient");
    expect(classifyEmailError(0, "algo raro")).toBe("transient");
  });
});

describe("nextEmailRetryAt", () => {
  const now = new Date("2026-10-11T12:00:00Z");
  it("0 → +5 min, 1 → +15, 2 → +30, 3 → null", () => {
    expect(nextEmailRetryAt(0, now)?.toISOString()).toBe("2026-10-11T12:05:00.000Z");
    expect(nextEmailRetryAt(1, now)?.toISOString()).toBe("2026-10-11T12:15:00.000Z");
    expect(nextEmailRetryAt(2, now)?.toISOString()).toBe("2026-10-11T12:30:00.000Z");
    expect(nextEmailRetryAt(3, now)).toBeNull();
  });
  it("valores raros no devuelven una fecha", () => {
    expect(nextEmailRetryAt(-1, now)).toBeNull();
    expect(nextEmailRetryAt(1.5, now)).toBeNull();
    expect(nextEmailRetryAt(Number.NaN, now)).toBeNull();
  });
  it("los minutos son 5, 15 y 30", () => {
    expect([...EMAIL_RETRY_MINUTES]).toEqual([5, 15, 30]);
  });
  it("la clave del job lleva la firma y el intento", () => {
    expect(emailJobKey("sig-1", 0)).toBe("contract_email:sig-1:0");
    expect(emailJobKey("sig-1", "manual:123")).toBe("contract_email:sig-1:manual:123");
  });
});
