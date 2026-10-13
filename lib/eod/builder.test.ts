import { describe, it, expect } from "vitest";
import { addEodField } from "./builder";

describe("addEodField", () => {
  it("un número nace con mínimo 0 y paso 1", () => {
    const [field] = addEodField([], "number");
    expect(field).toMatchObject({ type: "number", min: 0, step: 1, required: false });
    expect(field.prefill).toBeUndefined();
  });
  it("un tipo que no es de EOD no se agrega", () => {
    expect(addEodField([], "email")).toEqual([]);
    expect(addEodField([], "nps")).toEqual([]);
  });
});
