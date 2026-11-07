import { describe, expect, it } from "vitest";
import { parseConfirmType, safeNextPath } from "./password-reset";

describe("safeNextPath", () => {
  it("solo rutas propias", () => {
    expect(safeNextPath("/restablecer")).toBe("/restablecer");
    expect(safeNextPath("//evil.com")).toBe("/dashboard");
    expect(safeNextPath("/\\evil.com")).toBe("/dashboard");
    expect(safeNextPath("https://evil.com")).toBe("/dashboard");
    expect(safeNextPath(null)).toBe("/dashboard");
  });

  it("lo que el navegador lleva a otro dominio aunque empiece con una sola barra", () => {
    expect(safeNextPath("/\t/evil.com")).toBe("/dashboard");
    expect(safeNextPath("/\n/evil.com")).toBe("/dashboard");
    expect(safeNextPath("/.//evil.com")).toBe("/dashboard");
    expect(safeNextPath("/a/..//evil.com")).toBe("/dashboard");
    expect(safeNextPath("\\evil.com")).toBe("/dashboard");
  });

  it("conserva la consulta y el ancla de una ruta propia", () => {
    expect(safeNextPath("/dashboard/inbox?c=1#fin")).toBe("/dashboard/inbox?c=1#fin");
    expect(safeNextPath("/%2F%2Fevil.com")).toBe("/%2F%2Fevil.com");
  });
});

describe("parseConfirmType", () => {
  it("solo los tipos de Supabase Auth", () => {
    expect(parseConfirmType("recovery")).toBe("recovery");
    expect(parseConfirmType("otra")).toBeNull();
    expect(parseConfirmType(null)).toBeNull();
  });
});
