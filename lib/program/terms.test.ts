// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import cases from "./terms.cases.json";
import { termsPending, type TermsInput } from "./terms";

describe("los términos al entrar (casos compartidos con la base)", () => {
  for (const c of cases.cases) it(c.name, () => expect(termsPending(c.input as TermsInput)).toBe(c.expected));
});
