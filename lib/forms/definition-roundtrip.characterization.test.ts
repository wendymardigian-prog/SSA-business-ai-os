/**
 * Caracterizacion de la definicion de un formulario ANTES de la corrida
 * formularios-ui (plano B4, regla 2).
 *
 * Pasa definiciones reales (las dos borradores vacios de la base, sin datos
 * personales; las plantillas por defecto de cada tipo; los EOD; y una rica con
 * los 14 tipos) por las funciones puras de hoy y fija lo que devuelven. B4
 * reescribe la pantalla pero NO estas reglas: lo que no se toca tiene que
 * seguir dando exactamente lo mismo, y las funciones nuevas (mover al mismo
 * lugar, mapear lo mismo, cambiar al mismo tipo) devuelven la definicion
 * identica.
 *
 * Los ids de los campos nuevos son aleatorios: se normalizan antes de comparar.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { addField, moveField, pruneInvalidConditions, relabelField, removeField, setFieldKey } from "./builder";
import { DEFAULT_CONTACT_CONFIG, parseStoredContactConfig, pruneContactConfig, reconcileContactConfig } from "./contact-config";
import { newFormParts } from "./defaults";
import { validateDefinition, validateDraftShape } from "./definition-schema";
import { FORM_FIELD_TYPES, type FormDefinition, type FormField, type FormType } from "./fields";
import { validateSuccess } from "./success";

interface Fixture {
  name: string;
  type: FormType;
  definition: FormDefinition;
  design: Record<string, unknown>;
  success: Record<string, unknown>;
  contactConfig: unknown;
}

const load = (file: string): Fixture =>
  JSON.parse(readFileSync(join(__dirname, "__fixtures__", "definitions", file), "utf8")) as Fixture;

const FIXTURES: Array<[string, Fixture]> = [
  ["live-prueba1", load("live-prueba1.json")],
  ["live-test", load("live-test.json")],
  ["rich-custom", load("rich-custom.json")],
];

/** Reemplaza los ids aleatorios por su posicion, para poder comparar. */
function stable(fields: FormField[]): FormField[] {
  return fields.map((f, i) => ({ ...f, id: `#${i}` }));
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe("caracterizacion: validateDefinition (los textos de hoy)", () => {
  it.each(FIXTURES)("%s: el resultado de validar es el de hoy", (_n, fx) => {
    const res = validateDefinition(fx.definition, { formType: fx.type });
    expect(res.ok ? { ok: true } : { ok: false, errors: res.errors }).toMatchSnapshot();
  });

  it.each([
    ["custom", "custom"],
    ["survey", "survey"],
    ["contract", "contract"],
    ["eod-general", "eod:general"],
    ["eod-setter", "eod:setter"],
  ] as const)("la plantilla por defecto %s valida como hoy y su forma es la de hoy", (_n, kind) => {
    const [type, variant] = kind.split(":") as [FormType, "general" | "setter" | undefined];
    const parts = newFormParts(type, "Formulario", variant);
    const res = validateDefinition(parts.definition, { formType: type });
    expect({
      validation: res.ok ? { ok: true } : { ok: false, errors: res.errors },
      fields: stable(parts.definition.fields).map(({ id: _id, ...rest }) => rest),
      design: parts.design,
      surveyConfig: parts.surveyConfig,
      contractConfig: parts.contractConfig,
    }).toMatchSnapshot();
  });

  it("un formulario con un error conocido da los mismos mensajes (con la etiqueta delante)", () => {
    const rich = clone(load("rich-custom.json").definition);
    rich.fields[4] = { ...rich.fields[4], options: ["Solo una"] };
    rich.fields.push({ ...rich.fields[0], id: "f_dup00001" });
    const res = validateDefinition(rich, { formType: "custom" });
    expect(res.ok).toBe(false);
    expect(res.ok ? [] : res.errors).toMatchSnapshot();
  });
});

describe("caracterizacion: guardar el borrador no cambia la definicion", () => {
  it.each(FIXTURES)("%s: validateDraftShape devuelve la misma definicion", (_n, fx) => {
    const res = validateDraftShape(fx.definition);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.definition).toEqual(fx.definition);
  });

  it.each(FIXTURES)("%s: el diseno y el final se guardan igual que antes de B4", (_n, fx) => {
    // Lo que hace `saveFormDraft` con `design` (lib/actions/forms/forms.ts): recorta y deja showLogo como esta.
    const d = fx.design;
    const stored = {
      title: String(d.title ?? "").slice(0, 200),
      intro: String(d.intro ?? "").slice(0, 2000),
      submitLabel: String(d.submitLabel ?? "").slice(0, 60),
      showLogo: d.showLogo !== false,
    };
    expect(stored).toEqual(fx.design);
    const success = validateSuccess(fx.success);
    expect(success.ok).toBe(true);
  });

  it("el mapeo guardado junto con la rica sobrevive intacto", () => {
    const fx = load("rich-custom.json");
    const cfg = parseStoredContactConfig(fx.contactConfig);
    expect(pruneContactConfig(cfg, fx.definition.fields, [])).toBe(cfg);
    expect(cfg.map.map((m) => `${m.fieldKey}->${m.target}`)).toEqual([
      "nombre->contact.display_name",
      "email->contact.email",
      "whatsapp->contact.phone",
      "instagram->contact.instagram_username",
    ]);
  });
});

describe("caracterizacion: las operaciones del builder", () => {
  const rich = load("rich-custom.json").definition.fields;

  it("agregar un campo de cada tipo a la rica da lo de hoy", () => {
    const out = Object.fromEntries(
      FORM_FIELD_TYPES.map((type) => {
        const next = addField(rich, type);
        const { id: _id, ...added } = next[next.length - 1];
        return [type, { count: next.length, added }];
      }),
    );
    expect(out).toMatchSnapshot();
  });

  it("agregar a un formulario vacio: la clave sale de la etiqueta y email y telefono se prellenan", () => {
    const first = addField([], "email");
    const second = addField(first, "email");
    expect(stable(second).map(({ id: _id, ...f }) => f)).toMatchSnapshot();
  });

  it("mover un campo hacia arriba y hacia abajo, y los bordes, dan lo de hoy", () => {
    const keys = (f: FormField[]) => f.map((x) => x.key);
    expect(keys(moveField(rich, 3, -1)).slice(0, 5)).toEqual(["nombre", "email", "instagram", "whatsapp", "negocio"]);
    expect(keys(moveField(rich, 0, -1))).toEqual(keys(rich));
    expect(moveField(rich, rich.length - 1, 1)).toBe(rich);
  });

  it("mover la pregunta de la que depende una condicion la saca (hoy)", () => {
    // `cual` (indice 5) mira a `negocio` (indice 4): al subir `cual` por encima, la condicion se pierde.
    const moved = moveField(moveField(rich, 5, -1), 4, -1);
    const cual = moved.find((f) => f.key === "cual");
    expect(cual?.visibility).toBeUndefined();
  });

  it("borrar la pregunta de la que depende una condicion la saca (hoy)", () => {
    const out = removeField(rich, 4);
    expect(out.find((f) => f.key === "cual")?.visibility).toBeUndefined();
    // el grupo de `objetivo` conserva la condicion que mira a `facturacion`, que sigue antes
    const objetivo = out.find((f) => f.key === "objetivo");
    expect(objetivo?.visibility?.groups[0].conditions.map((c) => c.fieldKey)).toEqual(["facturacion"]);
  });

  it("podar no cambia nada cuando todas las condiciones siguen siendo validas", () => {
    expect(pruneInvalidConditions(rich)).toEqual(rich);
  });

  it("la etiqueta arrastra la clave solo si nunca se publico y la clave era la automatica", () => {
    const fields = addField([], "short_text");
    const label = relabelField(fields, 0, "Nombre de la empresa", true);
    expect(label[0].key).toBe("nombre_de_la_empresa");
    expect(relabelField(fields, 0, "Nombre de la empresa", false)[0].key).toBe(fields[0].key);
  });

  it("cambiar la clave a mano valida el formato y los choques (los mensajes de hoy)", () => {
    expect(setFieldKey(rich, 0, "Nombre!").error).toBe("Usá minúsculas, números y guión bajo, empezando con una letra");
    expect(setFieldKey(rich, 0, "email").error).toBe("Ya hay otro campo con esa clave");
    expect(setFieldKey(rich, 0, "nombre_completo").fields[0].key).toBe("nombre_completo");
  });
});

describe("caracterizacion: el mapeo al contacto acompana a los campos", () => {
  const fx = load("rich-custom.json");
  const config = parseStoredContactConfig(fx.contactConfig);

  it("agregar un email a un formulario que ya tiene uno NO pisa el mapeo y queda sin mapear", () => {
    const next = addField(fx.definition.fields, "email");
    expect(reconcileContactConfig(fx.definition.fields, next, config)).toBe(config);
  });

  it("agregar un email a un formulario vacio lo mapea solo", () => {
    const next = addField([], "email");
    const out = reconcileContactConfig([], next, DEFAULT_CONTACT_CONFIG);
    expect(out.map).toEqual([{ fieldKey: next[0].key, target: "contact.email" }]);
  });

  it("borrar un campo mapeado le saca el mapeo", () => {
    const next = removeField(fx.definition.fields, 1);
    const out = reconcileContactConfig(fx.definition.fields, next, config);
    expect(out.map.map((m) => m.fieldKey)).toEqual(["nombre", "whatsapp", "instagram"]);
  });

  it("sin cambios devuelve el mismo objeto", () => {
    expect(reconcileContactConfig(fx.definition.fields, fx.definition.fields, config)).toBe(config);
  });
});
