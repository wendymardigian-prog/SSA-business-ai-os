import { describe, expect, it } from "vitest";
import { createRequestBudget, DEFAULT_RETRY_AFTER_MS, MAX_RETRY_AFTER_MS, REQUEST_BUDGET, retryAfterMs } from "./rate-budget";

describe("createRequestBudget", () => {
  it("da 9 pedidos y despues dice que no", () => {
    const b = createRequestBudget();
    expect(REQUEST_BUDGET).toBe(9);
    for (let i = 0; i < 9; i++) expect(b.take()).toBe(true);
    expect(b.take()).toBe(false);
    expect(b.used).toBe(9);
    expect(b.remaining).toBe(0);
  });
  it("un pedido rechazado no cuenta", () => {
    const b = createRequestBudget(1);
    b.take(); b.take(); b.take();
    expect(b.used).toBe(1);
  });
});

describe("retryAfterMs", () => {
  it("segundos -> milisegundos", () => {
    expect(retryAfterMs("30")).toBe(30_000);
  });
  it("una fecha HTTP se mide contra ahora", () => {
    const now = Date.parse("2026-10-10T12:00:00Z");
    expect(retryAfterMs("Sat, 10 Oct 2026 12:02:00 GMT", now)).toBe(120_000);
  });
  it("sin valor o ilegible: 60 s", () => {
    expect(retryAfterMs(null)).toBe(DEFAULT_RETRY_AFTER_MS);
    expect(retryAfterMs("pronto")).toBe(DEFAULT_RETRY_AFTER_MS);
  });
  it("tiene piso de 1 s y techo de 10 min", () => {
    expect(retryAfterMs("0")).toBe(1_000);
    expect(retryAfterMs("999999")).toBe(MAX_RETRY_AFTER_MS);
  });
});
