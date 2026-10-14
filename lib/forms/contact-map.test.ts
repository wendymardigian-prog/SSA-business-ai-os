import { describe, expect, it } from "vitest";
import { mappingOf, setFieldMapping } from "./contact-map";
import { DEFAULT_CONTACT_CONFIG, type ContactConfig } from "./contact-config";
import { newField, type FormField } from "./fields";

const f = (key: string, type: FormField["type"], label = key): FormField => ({ ...newField(type, key, label), id: `id_${key}` });
const FIELDS = [f("nombre", "short_text", "Nombre"), f("email", "email", "Email"), f("email2", "email", "Email de trabajo"), f("negocio", "single_select", "Negocio")];
const CFG: ContactConfig = { ...DEFAULT_CONTACT_CONFIG, map: [{ fieldKey: "email", target: "contact.email" }] };

describe("setFieldMapping (F11)", () => {
  it("mapea una pregunta a un dato libre", () => {
    const out = setFieldMapping(CFG, FIELDS, [], "nombre", "contact.display_name");
    expect(out.config.map).toEqual([{ fieldKey: "email", target: "contact.email" }, { fieldKey: "nombre", target: "contact.display_name" }]);
    expect(out.displaced).toBeNull();
    expect(out.error).toBeUndefined();
  });

  it("si otra pregunta ya usaba ese dato, se lo saca y lo dice", () => {
    const out = setFieldMapping(CFG, FIELDS, [], "email2", "contact.email");
    expect(out.config.map).toEqual([{ fieldKey: "email2", target: "contact.email" }]);
    expect(out.displaced).toEqual({ fieldKey: "email", label: "Email" });
  });

  it("cambiar el destino de una pregunta reemplaza el anterior", () => {
    const out = setFieldMapping({ ...CFG, map: [{ fieldKey: "nombre", target: "contact.display_name" }] }, FIELDS, [], "nombre", "contact.first_name_part");
    expect(out.config.map).toEqual([{ fieldKey: "nombre", target: "contact.first_name_part" }]);
    expect(out.displaced).toBeNull();
  });

  it("'No se guarda en el contacto' quita el mapeo, y si no habia, devuelve el mismo objeto", () => {
    expect(setFieldMapping(CFG, FIELDS, [], "email", null).config.map).toEqual([]);
    expect(setFieldMapping(CFG, FIELDS, [], "email", "").config.map).toEqual([]);
    expect(setFieldMapping(CFG, FIELDS, [], "nombre", null).config).toBe(CFG);
  });

  it("un destino que el tipo no acepta no cambia nada y explica por que", () => {
    const out = setFieldMapping(CFG, FIELDS, [], "negocio", "contact.email");
    expect(out.config).toBe(CFG);
    expect(out.error).toContain("no se puede guardar");
  });

  it("una pregunta que no existe no cambia nada", () => {
    expect(setFieldMapping(CFG, FIELDS, [], "fantasma", "contact.email")).toMatchObject({ config: CFG, error: "No encontré esa pregunta" });
  });

  it("un mapeo viejo a una pregunta que ya no esta no se cuenta como desplazada", () => {
    const stale: ContactConfig = { ...CFG, map: [{ fieldKey: "borrada", target: "contact.email" }] };
    const out = setFieldMapping(stale, FIELDS, [], "email2", "contact.email");
    expect(out.displaced).toBeNull();
    expect(out.config.map).toEqual([{ fieldKey: "email2", target: "contact.email" }]);
  });

  it("acepta un campo personalizado compatible", () => {
    const custom = [{ id: "c1", slug: "empresa", name: "Empresa", type: "text" as const }];
    const out = setFieldMapping(CFG, FIELDS, custom as never, "negocio", "contact.custom.empresa");
    expect(out.config.map.at(-1)).toEqual({ fieldKey: "negocio", target: "contact.custom.empresa" });
  });
});

describe("mappingOf", () => {
  it("el destino o vacio", () => {
    expect(mappingOf(CFG, "email")).toBe("contact.email");
    expect(mappingOf(CFG, "nombre")).toBe("");
  });
});
