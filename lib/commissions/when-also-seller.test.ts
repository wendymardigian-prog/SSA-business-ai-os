// @plantilla-quitar(comisiones)
import { describe, expect, it } from "vitest";
import cases from "./when-also-seller.cases.json";
import { applyWhenAlsoSeller, type MaxEval } from "./rules";

describe("pagar solo la mayor (casos compartidos con la base)", () => {
  for (const c of cases.cases) {
    it(c.name, () => {
      expect(applyWhenAlsoSeller(c.evals as MaxEval[]).map((e) => e.applies)).toEqual(c.expected);
    });
  }
});
