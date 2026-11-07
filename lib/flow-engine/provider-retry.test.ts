import { describe, expect, it } from "vitest";
import { clearProviderRetry, nextProviderRetry, PROVIDER_RETRY_VAR } from "./provider-retry";
import type { FlowExecutionContext } from "./types";

const ctx = () => ({ variables: { comment_id: "c1" } }) as unknown as FlowExecutionContext;

describe("reintentos automaticos ante un problema pasajero", () => {
  it("espera 1, 5 y 15 minutos y despues se rinde", () => {
    const context = ctx();
    const now = new Date("2026-11-07T12:00:00Z");
    expect(nextProviderRetry(context, "step-1", now)?.toISOString()).toBe("2026-11-07T12:01:00.000Z");
    expect(nextProviderRetry(context, "step-1", now)?.toISOString()).toBe("2026-11-07T12:05:00.000Z");
    expect(nextProviderRetry(context, "step-1", now)?.toISOString()).toBe("2026-11-07T12:15:00.000Z");
    expect(nextProviderRetry(context, "step-1", now)).toBeNull();
  });

  it("cuenta por paso y se olvida cuando el paso sale o se rinde", () => {
    const context = ctx();
    nextProviderRetry(context, "a");
    nextProviderRetry(context, "b");
    clearProviderRetry(context, "a");
    expect((context.variables as Record<string, unknown>)[PROVIDER_RETRY_VAR]).toEqual({ b: 1 });
    clearProviderRetry(context, "b");
    expect(PROVIDER_RETRY_VAR in (context.variables as Record<string, unknown>)).toBe(false);
    expect((context.variables as Record<string, unknown>).comment_id).toBe("c1");
  });
});
