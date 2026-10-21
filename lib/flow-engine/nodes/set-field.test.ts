import { describe, expect, it } from "vitest";
import { decideSetField } from "./set-field";

describe("decideSetField", () => {
  it("vacío borra el valor en vez de guardar un string vacío", () => {
    expect(decideSetField("text", "   ")).toEqual({ kind: "clear" });
  });

  it("una variable sin resolver no se guarda", () => {
    expect(decideSetField("text", "Viajan {{pasajeros}}")).toEqual({ kind: "skip", reason: "unresolved_variable" });
  });

  it("normaliza por tipo, con la misma regla que la ficha", () => {
    expect(decideSetField("number", "3,5")).toEqual({ kind: "write", value: "3.5" });
    expect(decideSetField("boolean", "sí")).toEqual({ kind: "write", value: "true" });
    expect(decideSetField("date", "21/10/2026")).toEqual({ kind: "write", value: "2026-10-21" });
  });

  it("un valor que no corresponde al tipo no se escribe", () => {
    expect(decideSetField("number", "muchos")).toEqual({ kind: "skip", reason: "invalid_value" });
  });
});
