import { describe, expect, it } from "vitest";
import { DEFAULT_CHANNELS_RETURN, returnTargetOrDefault, safeReturnTo } from "./return-to";

describe("safeReturnTo", () => {
  it("acepta una ruta interna del panel, con su query", () => {
    expect(safeReturnTo("/dashboard/channels")).toBe("/dashboard/channels");
    expect(safeReturnTo("/dashboard/settings/integrations/zernio?tab=cuentas")).toBe(
      "/dashboard/settings/integrations/zernio?tab=cuentas",
    );
  });

  it("rechaza todo lo que lleve a otro sitio (seria una redireccion abierta)", () => {
    for (const bad of [
      "https://malo.example/dashboard/x",
      "//malo.example/dashboard/x",
      "/\\malo.example",
      "javascript:alert(1)",
      "/otra-cosa",
      "dashboard/channels",
      "",
      "/dashboard/\u0000x",
    ]) {
      expect(safeReturnTo(bad)).toBeNull();
    }
  });

  it("rechaza lo que no es texto y lo desmedido", () => {
    expect(safeReturnTo(null)).toBeNull();
    expect(safeReturnTo(undefined)).toBeNull();
    expect(safeReturnTo(42)).toBeNull();
    expect(safeReturnTo(`/dashboard/${"a".repeat(400)}`)).toBeNull();
  });

  it("sin un destino valido, vuelve a la pagina de canales", () => {
    expect(returnTargetOrDefault(null)).toBe(DEFAULT_CHANNELS_RETURN);
    expect(returnTargetOrDefault("https://malo.example")).toBe(DEFAULT_CHANNELS_RETURN);
    expect(returnTargetOrDefault("/dashboard/settings/integrations/zernio?tab=cuentas")).toBe(
      "/dashboard/settings/integrations/zernio?tab=cuentas",
    );
  });
});
