import { describe, it, expect } from "vitest";
import { addField, autoKey, conditionSources, moveField, pruneInvalidConditions, relabelField, removeField, setFieldKey } from "./builder";
import { MAX_FIELDS, newField, type FormField } from "./fields";
import { validateDefinition } from "./definition-schema";

const withCondition = (field: FormField, fieldKey: string): FormField => ({
  ...field,
  visibility: { rootConjunction: "and", conditions: [{ fieldKey, operator: "is", value: "x" }], groups: [] },
});

describe("addField", () => {
  it("agrega con una clave que no choca", () => {
    let fields: FormField[] = [];
    fields = addField(fields, "short_text");
    fields = addField(fields, "short_text");
    expect(fields.map((f) => f.key)).toEqual(["texto_corto", "texto_corto_2"]);
  });

  it("no pasa del tope de campos", () => {
    let fields: FormField[] = [];
    for (let i = 0; i < MAX_FIELDS + 5; i++) fields = addField(fields, "short_text");
    expect(fields).toHaveLength(MAX_FIELDS);
  });

  it("un oculto nace con su parámetro", () => {
    const [f] = addField([], "hidden");
    expect(f.hidden).toEqual({ source: "url_param", param: f.key });
  });

  it("todo lo que se agrega es una definición publicable", () => {
    let fields: FormField[] = [];
    for (const t of ["short_text", "email", "phone", "number", "single_select", "multi_select", "date", "rating", "nps", "file", "consent", "hidden"] as const) {
      fields = addField(fields, t);
    }
    expect(validateDefinition({ fields }).ok).toBe(true);
  });
});

describe("la clave y la etiqueta", () => {
  it("en un formulario ya publicado la clave NO cambia al editar la etiqueta", () => {
    const fields = [{ ...newField("short_text", "nombre", "Nombre"), required: true }];
    const out = relabelField(fields, 0, "Nombre completo", false);
    expect(out[0].label).toBe("Nombre completo");
    expect(out[0].key).toBe("nombre");
  });

  it("antes de publicar, la clave automática acompaña a la etiqueta", () => {
    let fields = addField([], "short_text");
    fields = relabelField(fields, 0, "Tu nombre", true);
    expect(fields[0].key).toBe("tu_nombre");
    fields = relabelField(fields, 0, "Nombre y apellido", true);
    expect(fields[0].key).toBe("nombre_y_apellido");
  });

  it("si la clave se editó a mano, ya no acompaña", () => {
    let fields = addField([], "short_text");
    fields = setFieldKey(fields, 0, "mi_clave").fields;
    fields = relabelField(fields, 0, "Otra etiqueta", true);
    expect(fields[0].key).toBe("mi_clave");
  });

  it("al renombrar la clave se arreglan las condiciones que la miraban", () => {
    let fields = [newField("short_text", "texto_corto", "Texto corto"), withCondition(newField("short_text", "b", "B"), "texto_corto")];
    fields = relabelField(fields, 0, "Plan", true);
    expect(fields[0].key).toBe("plan");
    expect(fields[1].visibility?.conditions[0].fieldKey).toBe("plan");
  });

  it("setFieldKey valida formato y repetidas", () => {
    const fields = [newField("short_text", "a", "A"), newField("short_text", "b", "B")];
    expect(setFieldKey(fields, 1, "A B").error).toBeDefined();
    expect(setFieldKey(fields, 1, "a").error).toMatch(/otro campo/);
    expect(setFieldKey(fields, 1, "c").fields[1].key).toBe("c");
  });

  it("autoKey", () => {
    expect(autoKey("¿Cuál es tu presupuesto?", [])).toBe("cual_es_tu_presupuesto");
    expect(autoKey("Nombre", ["nombre"])).toBe("nombre_2");
  });
});

describe("mover y borrar mantienen válidas las condiciones", () => {
  it("mover un campo debajo de quien lo miraba saca la condición", () => {
    const a = newField("short_text", "a", "A");
    const b = withCondition(newField("short_text", "b", "B"), "a");
    const moved = moveField([a, b], 1, -1); // b pasa a estar antes que a
    expect(moved.map((f) => f.key)).toEqual(["b", "a"]);
    expect(moved[0].visibility).toBeUndefined();
    expect(validateDefinition({ fields: moved }).ok).toBe(true);
  });

  it("borrar el campo que miraba otro saca la condición", () => {
    const a = newField("short_text", "a", "A");
    const b = withCondition(newField("short_text", "b", "B"), "a");
    const out = removeField([a, b], 0);
    expect(out).toHaveLength(1);
    expect(out[0].visibility).toBeUndefined();
  });

  it("una condición que sigue siendo válida se conserva", () => {
    const a = newField("short_text", "a", "A");
    const b = withCondition(newField("short_text", "b", "B"), "a");
    expect(pruneInvalidConditions([a, b])[1].visibility).toBeDefined();
  });

  it("mover fuera de rango no hace nada", () => {
    const fields = [newField("short_text", "a", "A")];
    expect(moveField(fields, 0, -1)).toBe(fields);
    expect(moveField(fields, 0, 1)).toBe(fields);
  });

  it("de un grupo con condiciones válidas e inválidas queda lo válido", () => {
    const a = newField("short_text", "a", "A");
    const c: FormField = {
      ...newField("short_text", "c", "C"),
      visibility: {
        rootConjunction: "and",
        conditions: [],
        groups: [{ conjunction: "or", conditions: [{ fieldKey: "a", operator: "is", value: "1" }, { fieldKey: "zz", operator: "is", value: "2" }] }],
      },
    };
    const out = pruneInvalidConditions([a, c]);
    expect(out[1].visibility?.groups[0].conditions).toEqual([{ fieldKey: "a", operator: "is", value: "1" }]);
  });
});

describe("conditionSources", () => {
  it("solo los campos anteriores", () => {
    const fields = [newField("short_text", "a", "A"), newField("single_select", "b", "B"), newField("short_text", "c", "C")];
    expect(conditionSources(fields, 2).map((s) => s.key)).toEqual(["a", "b"]);
    expect(conditionSources(fields, 0)).toEqual([]);
  });
});
