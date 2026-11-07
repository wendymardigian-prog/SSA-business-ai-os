import { describe, expect, it } from "vitest";
import { TruncatedOutputError } from "./provider";
import { AI_RETRY_DELAYS_MS, decideAiFailure, isTruncated } from "./retry";

describe("ai/retry: qué hacer cuando falla el proveedor", () => {
  it("un fallo pasajero espera 1, 5 y 15 minutos y después se da por vencido", () => {
    const boom = new Error("503 Service Unavailable");
    expect(decideAiFailure(boom, 0)).toEqual({ action: "retry", delayMs: 60_000, nextRetry: 1 });
    expect(decideAiFailure(boom, 1)).toEqual({ action: "retry", delayMs: 300_000, nextRetry: 2 });
    expect(decideAiFailure(boom, 2)).toEqual({ action: "retry", delayMs: 900_000, nextRetry: 3 });
    expect(decideAiFailure(boom, 3)).toMatchObject({ action: "give_up", permanent: false });
    expect(AI_RETRY_DELAYS_MS).toEqual([60_000, 300_000, 900_000]);
  });

  it("una clave inválida (401) no se reintenta", () => {
    expect(decideAiFailure(Object.assign(new Error("invalid x-api-key"), { statusCode: 401 }), 0)).toMatchObject({ action: "give_up", permanent: true });
  });

  it("una respuesta cortada por largo no se reintenta", () => {
    const error = new TruncatedOutputError();
    expect(isTruncated(error)).toBe(true);
    expect(decideAiFailure(error, 0)).toMatchObject({ action: "give_up", permanent: true });
    expect(isTruncated(new Error("x"))).toBe(false);
  });
});
