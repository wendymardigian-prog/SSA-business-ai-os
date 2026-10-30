import { describe, expect, it } from "vitest";
import { bellRecipientFilter, mutedTypesList } from "./bell-filter";

describe("bellRecipientFilter", () => {
  it("lo propio o lo general", () => {
    expect(bellRecipientFilter("0b8f2f8e-1c2d-4e5f-8a9b-0c1d2e3f4a5b")).toBe(
      "recipient_id.eq.0b8f2f8e-1c2d-4e5f-8a9b-0c1d2e3f4a5b,recipient_id.is.null",
    );
  });
  it("nunca arma un filtro con algo que no es un uuid", () => {
    expect(() => bellRecipientFilter("x,recipient_id.neq.null")).toThrow();
  });
});

describe("mutedTypesList", () => {
  it("nada silenciado, nada que filtrar", () => {
    expect(mutedTypesList([])).toBeNull();
  });
  it("lista sin repetidos y sin nada raro", () => {
    expect(mutedTypesList(["task_due_today", "task_due_today", "a)b"])).toBe("(task_due_today)");
  });
});
