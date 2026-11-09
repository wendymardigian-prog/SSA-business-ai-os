import { describe, expect, it } from "vitest";
import { tabCountLabel } from "./topbar-tabs";

describe("tabCountLabel", () => {
  it("no dibuja nada sin algo que contar", () => {
    expect(tabCountLabel(0)).toBeNull();
    expect(tabCountLabel(null)).toBeNull();
    expect(tabCountLabel(undefined)).toBeNull();
    expect(tabCountLabel(-3)).toBeNull();
    expect(tabCountLabel(Number.NaN)).toBeNull();
  });

  it("muestra el número y corta en 99+", () => {
    expect(tabCountLabel(1)).toBe("1");
    expect(tabCountLabel(99)).toBe("99");
    expect(tabCountLabel(100)).toBe("99+");
  });
});
