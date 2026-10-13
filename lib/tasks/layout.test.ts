import { describe, it, expect } from "vitest";
import { LIST_BREAKPOINT, selectLayout } from "./layout";

describe("selectLayout (F21)", () => {
  it("menos de 768 px: lista de tarjetas; desde 768: tabla", () => {
    expect(selectLayout(390)).toBe("list");
    expect(selectLayout(767)).toBe("list");
    expect(selectLayout(768)).toBe("table");
    expect(selectLayout(1440)).toBe("table");
    expect(LIST_BREAKPOINT).toBe(768);
  });
});
