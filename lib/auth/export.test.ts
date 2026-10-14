import { describe, expect, it } from "vitest";
import { SYSTEM_ROLE_PERMISSIONS } from "./permissions";
import { canExport, EXPORT_KEY } from "./export";

const canOf = (keys: string[]) => (key: string) => keys.includes(key);

describe("canExport (F24)", () => {
  it("Owner y Admin exportan; el Member de sistema no (cambio aprobado, plano §9.3)", () => {
    expect(canExport(canOf(SYSTEM_ROLE_PERMISSIONS.owner.keys))).toBe(true);
    expect(canExport(canOf(SYSTEM_ROLE_PERMISSIONS.admin.keys))).toBe(true);
    expect(canExport(canOf(SYSTEM_ROLE_PERMISSIONS.member.keys))).toBe(false);
  });

  it("un rol personalizado con data.export exporta; ver el formulario o los anuncios no alcanza", () => {
    expect(canExport(canOf([EXPORT_KEY]))).toBe(true);
    expect(canExport(canOf(["forms.view", "dashboards.ads.view", "ai_costs.view"]))).toBe(false);
  });
});
