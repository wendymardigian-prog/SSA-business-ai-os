import { describe, expect, it } from "vitest";
import { conditionChip, emptyShortcuts, hiddenNote, mappingChip, pickerGroups, shownOptions } from "./canvas-view";
import { DEFAULT_CONTACT_CONFIG, type ContactConfig } from "./contact-config";
import { newField, type FormField } from "./fields";
import { builderSummary } from "./builder-summary";
import { publishIssues, stripFieldPrefix } from "./publish-issues";

const f = (key: string, type: FormField["type"], extra: Partial<FormField> = {}): FormField => ({ ...newField(type, key, extra.label ?? key), id: `id_${key}`, ...extra });
const cond = (fieldKey: string, operator: "is" | "is_not" | "is_empty" = "is", value = "Otro") => ({ rootConjunction: "and" as const, conditions: [{ fieldKey, operator, value }], groups: [] });

describe("conditionChip (F9)", () => {
  const fields = [f("negocio", "single_select", { label: "¿Qué negocio tenés?" }), f("cual", "short_text", { visibility: cond("negocio") })];

  it("'Si ¿Qué negocio tenés? = Otro'", () => {
    expect(conditionChip(fields[1], fields)).toBe("Si ¿Qué negocio tenés? = Otro");
  });

  it("otros operadores con su frase, y los que no llevan valor no lo muestran", () => {
    expect(conditionChip({ ...fields[1], visibility: cond("negocio", "is_not") }, fields)).toBe("Si ¿Qué negocio tenés? no es Otro");
    expect(conditionChip({ ...fields[1], visibility: cond("negocio", "is_empty") }, fields)).toBe("Si ¿Qué negocio tenés? está vacío");
  });

  it("con mas de una condicion suma '+N'; sin condicion es null", () => {
    const two = { rootConjunction: "and" as const, conditions: [{ fieldKey: "negocio", operator: "is" as const, value: "A" }], groups: [{ conjunction: "or" as const, conditions: [{ fieldKey: "negocio", operator: "is" as const, value: "B" }, { fieldKey: "negocio", operator: "is" as const, value: "C" }] }] };
    expect(conditionChip({ ...fields[1], visibility: two }, fields)).toBe("Si ¿Qué negocio tenés? = A +2");
    expect(conditionChip(fields[0], fields)).toBeNull();
  });

  it("una pregunta de la que depende y ya no esta: usa la clave, no rompe", () => {
    expect(conditionChip(fields[1], [fields[1]])).toBe("Si negocio = Otro");
  });
});

describe("mappingChip (F9)", () => {
  const cfg: ContactConfig = { ...DEFAULT_CONTACT_CONFIG, map: [{ fieldKey: "email", target: "contact.email" }, { fieldKey: "empresa", target: "contact.custom.empresa" }] };
  const custom = [{ id: "c1", slug: "empresa", name: "Empresa", type: "text" as const }];

  it("'→ Email', '→ Empresa' y null sin mapeo", () => {
    expect(mappingChip(f("email", "email"), cfg, [])).toBe("→ Email");
    expect(mappingChip(f("empresa", "short_text"), cfg, custom as never)).toBe("→ Empresa");
    expect(mappingChip(f("nombre", "short_text"), cfg, [])).toBeNull();
  });
});

describe("opciones, ocultos y selector (F9)", () => {
  it("muestra 6 opciones y 'y N mas'", () => {
    expect(shownOptions(["a", "b", "c"]).more).toBe(0);
    const out = shownOptions(["1", "2", "3", "4", "5", "6", "7", "8", ""]);
    expect(out.shown).toHaveLength(6);
    expect(out.more).toBe(3);
    expect(shownOptions(["a", " "]).shown[1].empty).toBe(true);
    expect(shownOptions(undefined)).toEqual({ shown: [], more: 0 });
  });

  it("la nota de un oculto segun de donde sale su valor", () => {
    expect(hiddenNote(f("ref", "hidden", { hidden: { source: "url_param", param: "ref" } }))).toBe("No lo ve quien responde. Toma ref de la dirección de la página.");
    expect(hiddenNote(f("o", "hidden", { hidden: { source: "fixed", value: "x" } }))).toBe("No lo ve quien responde. Guarda un valor fijo.");
    expect(hiddenNote(f("u", "hidden", { hidden: { source: "attribution", param: "utm_source" } }))).toContain("ya se guarda solo");
  });

  it("los tipos del selector van en cuatro grupos y no falta ninguno", () => {
    const groups = pickerGroups("custom");
    expect(groups.map((g) => g.title)).toEqual(["Datos de contacto", "Texto", "Opciones", "Otros"]);
    expect(groups.flatMap((g) => g.types.map((t) => t.type)).sort()).toEqual(
      ["consent", "date", "email", "file", "hidden", "long_text", "multi_select", "nps", "number", "phone", "rating", "short_text", "single_select", "social"].sort(),
    );
  });

  it("un reporte de fin de dia solo ofrece lo que acepta", () => {
    const groups = pickerGroups("eod");
    expect(groups.flatMap((g) => g.types.map((t) => t.type)).sort()).toEqual(["long_text", "multi_select", "number", "short_text", "single_select"]);
    expect(groups.map((g) => g.title)).toEqual(["Texto", "Opciones"]);
  });

  it("los cinco atajos del formulario vacio (en un EOD, los que acepta)", () => {
    expect(emptyShortcuts("custom").map((s) => s.type)).toEqual(["short_text", "email", "phone", "single_select", "long_text"]);
    expect(emptyShortcuts("eod").map((s) => s.type)).toEqual(["short_text", "single_select", "long_text"]);
  });
});

describe("builderSummary (F11)", () => {
  it("cuenta preguntas (sin ocultos), obligatorias, condicionales y las que van al contacto", () => {
    const fields = [f("nombre", "short_text", { required: true }), f("email", "email", { required: true }), f("ref", "hidden"), f("cual", "short_text", { visibility: cond("nombre") })];
    const cfg: ContactConfig = { ...DEFAULT_CONTACT_CONFIG, map: [{ fieldKey: "email", target: "contact.email" }, { fieldKey: "borrada", target: "contact.phone" }] };
    expect(builderSummary(fields, cfg)).toEqual({ questions: 3, required: 2, conditional: 1, toContact: 1 });
    expect(builderSummary([], DEFAULT_CONTACT_CONFIG)).toEqual({ questions: 0, required: 0, conditional: 0, toContact: 0 });
  });
});

describe("publishIssues (F9)", () => {
  const ok = { type: "custom" as const, slug: "mi-form" };

  it("sin problemas: nada", () => {
    expect(publishIssues({ ...ok, definition: { fields: [f("email", "email")] } })).toMatchObject({ total: 0, general: [], byField: {}, firstFieldKey: null });
  });

  it("un problema de una pregunta va a SU tarjeta, sin repetir su nombre", () => {
    const out = publishIssues({ ...ok, definition: { fields: [f("nombre", "short_text"), f("negocio", "single_select", { options: ["Solo una"] })] } });
    expect(out.byField).toEqual({ negocio: ["cargá al menos 2 opciones"] });
    expect(out.general).toEqual([]);
    expect(out.total).toBe(1);
    expect(out.firstFieldKey).toBe("negocio");
  });

  it("lo que no es de una pregunta queda en general: el link y las reglas del tipo", () => {
    const out = publishIssues({ type: "contract", slug: "x", definition: { fields: [f("nombre", "short_text")] }, extraChecks: [() => ["El contrato necesita un texto"]] });
    expect(out.general).toEqual(["El link del formulario no es válido (3 a 60 caracteres: minúsculas, números y guiones)", "El contrato necesita un texto"]);
    expect(out.firstFieldKey).toBeNull();
  });

  it("una pregunta sin etiqueta (error de forma) tambien se marca en su tarjeta", () => {
    const out = publishIssues({ ...ok, definition: { fields: [f("nombre", "short_text", { label: "" })] } });
    expect(out.byField.nombre?.[0]).toBe("Falta la etiqueta");
  });

  it("varios problemas en varias preguntas: el total los suma y la primera es la primera del formulario", () => {
    const out = publishIssues({
      ...ok,
      definition: { fields: [f("a", "short_text"), f("b", "single_select", { options: ["x"] }), f("c", "single_select", { options: ["y", "y"] })] },
    });
    expect(Object.keys(out.byField)).toEqual(["b", "c"]);
    expect(out.firstFieldKey).toBe("b");
    expect(out.total).toBe(out.byField.b.length + out.byField.c.length);
  });

  it("los mensajes de las reglas del tipo no se evaluan sobre una definicion invalida (igual que al publicar)", () => {
    let ran = false;
    publishIssues({ ...ok, definition: { fields: [f("b", "single_select", { options: ["x"] })] }, extraChecks: [() => ((ran = true), [])] });
    expect(ran).toBe(false);
  });

  it("stripFieldPrefix saca el nombre y la ruta del mensaje", () => {
    expect(stripFieldPrefix('"Email": hay una opción vacía')).toBe("hay una opción vacía");
    expect(stripFieldPrefix("fields.3.label: Falta la etiqueta")).toBe("Falta la etiqueta");
    expect(stripFieldPrefix("Como máximo 60 campos")).toBe("Como máximo 60 campos");
  });
});
