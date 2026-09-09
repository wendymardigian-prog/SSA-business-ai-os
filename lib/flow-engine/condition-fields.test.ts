import { describe, it, expect } from "vitest";
import {
  CONDITION_FIELDS,
  findConditionField,
  joinConditionField,
  splitConditionField,
} from "./condition-fields";

describe("splitConditionField", () => {
  it("separa el prefijo del argumento", () => {
    expect(splitConditionField("tag:interesado")).toEqual({
      prefix: "tag:",
      argument: "interesado",
    });
  });

  it("'sequence_ever:' NO cae en 'sequence:': serian dos condiciones distintas", () => {
    expect(splitConditionField("sequence_ever:abc")).toEqual({
      prefix: "sequence_ever:",
      argument: "abc",
    });
    expect(splitConditionField("sequence:abc")).toEqual({
      prefix: "sequence:",
      argument: "abc",
    });
  });

  it("los campos sin argumento se reconocen enteros", () => {
    expect(splitConditionField("platform")).toEqual({ prefix: "platform", argument: "" });
    expect(splitConditionField("is_subscribed")).toEqual({
      prefix: "is_subscribed",
      argument: "",
    });
  });

  it("cualquier otra cosa es el slug de un campo personalizado", () => {
    expect(splitConditionField("presupuesto")).toEqual({ prefix: "", argument: "presupuesto" });
  });

  it("un prefijo sin argumento todavia no elegido no se rompe", () => {
    expect(splitConditionField("sequence:")).toEqual({ prefix: "sequence:", argument: "" });
  });
});

describe("joinConditionField", () => {
  it("es la vuelta exacta de split", () => {
    for (const field of ["tag:interesado", "sequence_ever:abc", "platform", "presupuesto"]) {
      const { prefix, argument } = splitConditionField(field);
      expect(joinConditionField(prefix, argument)).toBe(field);
    }
  });

  it("recorta los espacios del argumento", () => {
    expect(joinConditionField("tag:", "  vip  ")).toBe("tag:vip");
  });
});

describe("catalogo", () => {
  it("no hay dos campos con el mismo prefijo", () => {
    const prefixes = CONDITION_FIELDS.map((f) => f.prefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  it("los campos que piden argumento declaran como llamarlo", () => {
    for (const field of CONDITION_FIELDS) {
      if (field.argument !== "none") expect(field.argumentLabel).toBeTruthy();
    }
  });

  it("findConditionField encuentra los dos campos de secuencia", () => {
    expect(findConditionField("sequence:")?.argument).toBe("sequence");
    expect(findConditionField("sequence_ever:")?.argument).toBe("sequence");
  });
});
