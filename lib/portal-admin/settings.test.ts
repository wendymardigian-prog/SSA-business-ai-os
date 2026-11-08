// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import cases from "./portal-settings.cases.json";
import { keepExtensions, validateProgramPortalSettings, validateVariantPortalSettings, validateWorkspacePortalSettings } from "./settings";

const run = { variant: validateVariantPortalSettings, program: validateProgramPortalSettings, workspace: validateWorkspacePortalSettings };

describe("validadores del portal (gemelos de app_servicio.validate_*_portal_settings)", () => {
  for (const c of cases.cases) {
    it(`${c.kind}: ${c.name}`, () => {
      expect(run[c.kind as keyof typeof run](c.settings)).toEqual(c.expected);
    });
  }
});

describe("keepExtensions", () => {
  it("guardar desde la pantalla con otras extensiones no las cambia", () => {
    expect(keepExtensions({ host: "a.com", extensions: { projects: true } }, { host: "b.com", extensions: { projects: false } })).toEqual({
      host: "b.com",
      extensions: { projects: true },
    });
  });
  it("sin extensiones previas no inventa ninguna", () => {
    expect(keepExtensions({}, { host: "b.com", extensions: { projects: true } })).toEqual({ host: "b.com" });
  });
});
