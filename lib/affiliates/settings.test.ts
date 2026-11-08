// @plantilla-quitar(ventas)
import { describe, expect, it } from "vitest";
import cases from "./affiliate-settings.cases.json";
import { validateAffiliateSettings } from "./settings";

describe("las reglas de afiliados (gemela de validate_affiliate_settings)", () => {
  for (const c of cases.cases as Array<{ name: string; input: unknown; expected: string[] }>) {
    it(c.name, () => expect(validateAffiliateSettings(c.input)).toEqual(c.expected));
  }
});
