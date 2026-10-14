import { describe, expect, it } from "vitest";
import { changeFieldType, dropTargetIndex, duplicateField, insertFieldAt, moveFieldTo } from "./builder-ops";
import { addField, moveField } from "./builder";
import { MAX_FIELDS, newField, type FormField } from "./fields";

const f = (key: string, type: FormField["type"] = "short_text", extra: Partial<FormField> = {}): FormField => ({
  ...newField(type, key, key),
  id: `id_${key}`,
  ...extra,
});
const keys = (fields: FormField[]) => fields.map((x) => x.key);

const cond = (fieldKey: string, value = "Otro") => ({ rootConjunction: "and" as const, conditions: [{ fieldKey, operator: "is" as const, value }], groups: [] });

describe("moveFieldTo (F9)", () => {
  const list = [f("a"), f("b"), f("c"), f("d")];

  it("mueve a la posicion pedida y devuelve el mismo arreglo si no cambia nada", () => {
    expect(keys(moveFieldTo(list, 0, 2))).toEqual(["b", "c", "a", "d"]);
    expect(keys(moveFieldTo(list, 3, 0))).toEqual(["d", "a", "b", "c"]);
    expect(moveFieldTo(list, 1, 1)).toBe(list);
    expect(moveFieldTo(list, -1, 2)).toBe(list);
    expect(moveFieldTo(list, 1, 9)).toBe(list);
  });

  it("mover a una posicion vecina da lo mismo que Subir o Bajar", () => {
    expect(keys(moveFieldTo(list, 2, 1))).toEqual(keys(moveField(list, 2, -1)));
    expect(keys(moveFieldTo(list, 1, 2))).toEqual(keys(moveField(list, 1, 1)));
  });

  it("saca la condicion que quedo mirando una pregunta que ya no es anterior", () => {
    const withCond = [f("negocio", "single_select"), f("cual", "short_text", { visibility: cond("negocio") })];
    const moved = moveFieldTo(withCond, 1, 0);
    expect(keys(moved)).toEqual(["cual", "negocio"]);
    expect(moved[0].visibility).toBeUndefined();
  });
});

describe("dropTargetIndex (arrastrar y soltar)", () => {
  it("antes y despues de la tarjeta de abajo y de la de arriba", () => {
    // [a b c d]: arrastro `b` (1)
    expect(dropTargetIndex(1, 3, "after")).toBe(3); // despues de d
    expect(dropTargetIndex(1, 3, "before")).toBe(2); // antes de d
    expect(dropTargetIndex(1, 0, "before")).toBe(0); // antes de a
    expect(dropTargetIndex(1, 0, "after")).toBe(1); // despues de a = donde ya estaba
    expect(dropTargetIndex(1, 1, "before")).toBe(1);
    expect(dropTargetIndex(1, 1, "after")).toBe(1);
  });

  it("soltar donde ya esta no mueve nada", () => {
    const list = [f("a"), f("b"), f("c")];
    expect(moveFieldTo(list, 1, dropTargetIndex(1, 1, "after"))).toBe(list);
    expect(moveFieldTo(list, 1, dropTargetIndex(1, 0, "after"))).toBe(list);
  });
});

describe("insertFieldAt (F9)", () => {
  const list = [f("a"), f("b")];

  it("inserta arriba, en el medio y al final", () => {
    expect(insertFieldAt(list, "email", 0)[0].type).toBe("email");
    expect(keys(insertFieldAt(list, "email", 1)).length).toBe(3);
    expect(insertFieldAt(list, "email", 1)[1].type).toBe("email");
    expect(insertFieldAt(list, "email", 2)[2].type).toBe("email");
    expect(insertFieldAt(list, "email", 99)[2].type).toBe("email");
  });

  it("conserva las otras preguntas en su orden", () => {
    expect(keys(insertFieldAt(list, "long_text", 1)).filter((k) => k === "a" || k === "b")).toEqual(["a", "b"]);
  });

  it("la clave sale del nombre del tipo y no choca", () => {
    const twice = insertFieldAt(insertFieldAt([], "email", 0), "email", 1);
    expect(new Set(keys(twice)).size).toBe(2);
  });

  it("la pregunta nueva es la misma que agregaria al final (mismas claves y prellenado)", () => {
    const base = [f("nombre"), f("whatsapp", "phone")];
    const atEnd = addField(base, "email");
    const inserted = insertFieldAt(base, "email", 2);
    expect(inserted.map(({ id: _id, ...rest }) => rest)).toEqual(atEnd.map(({ id: _id, ...rest }) => rest));
  });

  it("no pasa del maximo de preguntas", () => {
    const full = Array.from({ length: MAX_FIELDS }, (_, i) => f(`q${i}`));
    expect(insertFieldAt(full, "email", 3)).toBe(full);
  });
});

describe("duplicateField (F11)", () => {
  it("la copia queda justo abajo, con clave nueva y sin choque", () => {
    const list = [f("nombre"), f("email", "email")];
    const out = duplicateField(list, 0)!;
    expect(keys(out.fields)).toEqual(["nombre", "nombre_2", "email"]);
    expect(out.index).toBe(1);
    expect(out.fields[1].id).not.toBe(list[0].id);
    const again = duplicateField(out.fields, 0)!;
    expect(keys(again.fields)).toEqual(["nombre", "nombre_3", "nombre_2", "email"]);
  });

  it("no hereda el prellenado (los parametros no se repiten) y conserva lo demas", () => {
    const list = [f("email", "email", { required: true, help: "Tu mejor email", prefill: { params: ["email", "mail"], behavior: "editable" } })];
    const copy = duplicateField(list, 0)!.fields[1];
    expect(copy.prefill).toBeUndefined();
    expect(copy).toMatchObject({ type: "email", required: true, help: "Tu mejor email", label: "email" });
  });

  it("un oculto de la URL toma su clave nueva como parametro", () => {
    const hidden = f("ref", "hidden");
    const copy = duplicateField([hidden], 0)!.fields[1];
    expect(copy.hidden).toEqual({ source: "url_param", param: "ref_2" });
  });

  it("no comparte las opciones con el original (copia profunda)", () => {
    const list = [f("negocio", "single_select", { options: ["A", "B"] })];
    const out = duplicateField(list, 0)!.fields;
    out[1].options!.push("C");
    expect(out[0].options).toEqual(["A", "B"]);
  });

  it("devuelve null si no hay campo o se llego al maximo", () => {
    expect(duplicateField([], 0)).toBeNull();
    expect(duplicateField(Array.from({ length: MAX_FIELDS }, (_, i) => f(`q${i}`)), 0)).toBeNull();
  });

  it("la duplicada de una pregunta condicional sigue siendo valida (la condicion mira algo anterior)", () => {
    const list = [f("negocio", "single_select"), f("cual", "short_text", { visibility: cond("negocio") })];
    const out = duplicateField(list, 1)!.fields;
    expect(out[2].visibility).toBeDefined();
  });
});

describe("changeFieldType (F11)", () => {
  it("conserva etiqueta, clave, id, ayuda, texto de ejemplo y obligatoria entre tipos de texto", () => {
    const list = [f("nombre", "short_text", { label: "Tu nombre", help: "Como figura", placeholder: "Ana", required: true })];
    const out = changeFieldType(list, 0, "long_text")[0];
    expect(out).toMatchObject({ id: "id_nombre", key: "nombre", type: "long_text", label: "Tu nombre", help: "Como figura", placeholder: "Ana", required: true });
  });

  it("el mismo tipo devuelve el mismo arreglo", () => {
    const list = [f("a")];
    expect(changeFieldType(list, 0, "short_text")).toBe(list);
    expect(changeFieldType(list, 5, "email")).toBe(list);
  });

  it("entre tipos de opciones conserva las opciones; a uno que no las tiene, las pierde", () => {
    const list = [f("negocio", "single_select", { options: ["A", "B", "C"] })];
    expect(changeFieldType(list, 0, "multi_select")[0].options).toEqual(["A", "B", "C"]);
    expect(changeFieldType(list, 0, "short_text")[0].options).toBeUndefined();
  });

  it("de texto a opciones arranca con las opciones por defecto", () => {
    const out = changeFieldType([f("a")], 0, "single_select")[0];
    expect(out.options?.length).toBeGreaterThanOrEqual(2);
  });

  it("estrellas y NPS arrancan con su escala; un archivo, con su configuracion", () => {
    expect(changeFieldType([f("a")], 0, "rating")[0]).toMatchObject({ min: 1, max: 5 });
    expect(changeFieldType([f("a")], 0, "nps")[0]).toMatchObject({ min: 0, max: 10 });
    expect(changeFieldType([f("a")], 0, "file")[0].file).toBeDefined();
  });

  it("un consentimiento es obligatorio y un oculto nunca", () => {
    expect(changeFieldType([f("a", "short_text", { required: false })], 0, "consent")[0]).toMatchObject({ required: true });
    const hidden = changeFieldType([f("a", "short_text", { required: true })], 0, "hidden")[0];
    expect(hidden.required).toBe(false);
    expect(hidden.hidden).toEqual({ source: "url_param", param: "a" });
  });

  it("el prellenado se conserva si el tipo nuevo se puede prellenar y se pierde si no", () => {
    const list = [f("email", "email", { prefill: { params: ["email"], behavior: "editable" } })];
    expect(changeFieldType(list, 0, "short_text")[0].prefill).toBeDefined();
    expect(changeFieldType(list, 0, "file")[0].prefill).toBeUndefined();
    expect(changeFieldType(list, 0, "consent")[0].prefill).toBeUndefined();
    expect(changeFieldType(list, 0, "hidden")[0].prefill).toBeUndefined();
  });

  it("su propia condicion se conserva", () => {
    const list = [f("negocio", "single_select"), f("cual", "short_text", { visibility: cond("negocio") })];
    expect(changeFieldType(list, 1, "long_text")[1].visibility).toEqual(cond("negocio"));
  });

  it("al dejar de ser de opciones se quitan las condiciones de abajo que dependian de ella", () => {
    const list = [
      f("negocio", "single_select", { options: ["Otro", "Estudio"] }),
      f("cual", "short_text", { visibility: cond("negocio") }),
      f("otra", "short_text"),
    ];
    const out = changeFieldType(list, 0, "short_text");
    expect(out[1].visibility).toBeUndefined();
    expect(out[2]).toBe(list[2]);
  });

  it("solo se quitan las condiciones sobre esa pregunta: las demas quedan", () => {
    const list = [
      f("negocio", "single_select"),
      f("plan", "single_select"),
      f("cual", "short_text", {
        visibility: { rootConjunction: "and", conditions: [{ fieldKey: "negocio", operator: "is", value: "x" }, { fieldKey: "plan", operator: "is", value: "y" }], groups: [] },
      }),
    ];
    const out = changeFieldType(list, 0, "email");
    expect(out[2].visibility?.conditions.map((c) => c.fieldKey)).toEqual(["plan"]);
  });

  it("entre tipos de opciones las condiciones de abajo se conservan", () => {
    const list = [f("negocio", "single_select"), f("cual", "short_text", { visibility: cond("negocio") })];
    expect(changeFieldType(list, 0, "multi_select")[1].visibility).toBeDefined();
  });

  it("un numero de fin de dia conserva su paso y su metrica al pasar a numero; otros tipos los pierden", () => {
    const list = [f("links", "number", { step: 5, metricKey: "links_enviados", min: 0 })];
    expect(changeFieldType(list, 0, "short_text")[0]).not.toHaveProperty("step");
    expect(changeFieldType(list, 0, "short_text")[0]).not.toHaveProperty("metricKey");
    expect(changeFieldType(changeFieldType(list, 0, "short_text"), 0, "number")[0].step).toBeUndefined();
  });
});
