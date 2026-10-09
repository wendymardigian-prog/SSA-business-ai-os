import { describe, expect, it } from "vitest";
import { planInlineCommit } from "./inline-edit";

describe("planInlineCommit", () => {
  it("un valor nuevo y valido se guarda", () => {
    expect(planInlineCommit("email", "ana@x.com", "")).toEqual({ kind: "save", value: "ana@x.com", normalized: "ana@x.com" });
    expect(planInlineCommit("country", "Chile", "Argentina")).toEqual({ kind: "save", value: "Chile", normalized: "Chile" });
  });

  it("un valor invalido no se guarda y dice por que, con el mismo mensaje que el servidor", () => {
    const r = planInlineCommit("email", "ana@", "");
    expect(r).toMatchObject({ kind: "invalid", error: expect.stringContaining("email") });
    expect(planInlineCommit("phone", "abc", "")).toMatchObject({ kind: "invalid" });
  });

  it("lo que se muestra al guardar es como lo guarda el servidor (minusculas, sin arroba), sin esperar a la recarga", () => {
    expect(planInlineCommit("email", " Ana@X.com ", "")).toMatchObject({ kind: "save", normalized: "ana@x.com" });
    expect(planInlineCommit("instagram_username", "@Ana.Gomez", "")).toMatchObject({ kind: "save", normalized: "ana.gomez" });
  });

  it("lo que no cambia nada no llama al servidor (espacios, mayusculas, arroba)", () => {
    expect(planInlineCommit("email", "  Ana@X.com ", "ana@x.com")).toEqual({ kind: "unchanged" });
    expect(planInlineCommit("instagram_username", "@Ana", "ana")).toEqual({ kind: "unchanged" });
    expect(planInlineCommit("country", "Chile", "Chile")).toEqual({ kind: "unchanged" });
    expect(planInlineCommit("country", "", null)).toEqual({ kind: "unchanged" });
  });

  it("un telefono escrito de otra forma pero igual al guardado no cambia", () => {
    const stored = "+5491122334455";
    expect(planInlineCommit("phone", "+54 9 11 2233 4455", stored)).toEqual({ kind: "unchanged" });
  });

  it("vaciar un dato es un cambio valido (todos los campos son opcionales)", () => {
    expect(planInlineCommit("secondary_email", "", "ana@x.com")).toEqual({ kind: "save", value: "", normalized: "" });
  });

  it("un dato viejo que ya no valida se compara tal cual, sin romper", () => {
    expect(planInlineCommit("email", "ana@x.com", "dato-raro")).toEqual({ kind: "save", value: "ana@x.com", normalized: "ana@x.com" });
    expect(planInlineCommit("country", "x", undefined)).toEqual({ kind: "save", value: "x", normalized: "x" });
  });
});
