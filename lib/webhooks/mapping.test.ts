import { describe, expect, it } from "vitest";
import { applyContactMapping, cleanPhone, hasIdentifier, readSource, splitName, suggestMapRows, type MappingDefaults } from "./mapping";
import { DEFAULT_UPSERT_CONFIG, type MapRow, type UpsertContactConfig } from "./upsert-config";

const defaults: MappingDefaults = {
  defaultCountry: "CR",
  customFields: [
    { id: "cf-1", slug: "empresa", name: "Empresa", type: "text" },
    { id: "cf-2", slug: "presupuesto", name: "Presupuesto", type: "number" },
    { id: "cf-3", slug: "acepta", name: "Acepta", type: "boolean" },
    { id: "cf-4", slug: "nacimiento", name: "Nacimiento", type: "date" },
  ],
};

const cfg = (map: MapRow[], over: Partial<UpsertContactConfig> = {}) => ({ ...DEFAULT_UPSERT_CONFIG, ...over, map });
const row = (target: string, path: string, transform?: MapRow["transform"], fallbacks?: string[]): MapRow => ({ target, source: { path, ...(fallbacks ? { fallbacks } : {}) }, ...(transform ? { transform } : {}) });

describe("applyContactMapping: el origen", () => {
  it("una ruta anidada con lowercase + trim da a@b.com", () => {
    const r = applyContactMapping({ data: { user: { email: " A@B.com " } } }, {}, cfg([row("contact.email", "data.user.email", "lowercase")]), defaults);
    expect(r.contact.email).toBe("a@b.com");
    expect(r.errors).toEqual([]);
  });

  it("con fallbacks usa la primera ruta con valor", () => {
    const r = applyContactMapping({ data: { email: "x@y.com" } }, {}, cfg([row("contact.email", "email", undefined, ["email", "data.email"])]), defaults);
    expect(r.contact.email).toBe("x@y.com");
  });

  it("una ruta inexistente y sin fallbacks omite el destino: no escribe undefined ni vacío", () => {
    const r = applyContactMapping({ a: 1 }, {}, cfg([row("contact.email", "no.existe")]), defaults);
    expect(r.contact).toEqual({});
    expect(r.rows[0]).toMatchObject({ status: "empty" });
    expect(JSON.stringify(r.contact)).not.toContain("undefined");
  });

  it("lee de la URL con el prefijo query. y los índices de lista", () => {
    const r = applyContactMapping({ items: [{ email: "i@z.com" }] }, { who: "Beto" }, cfg([row("contact.email", "items.0.email"), row("contact.display_name", "query.who")]), defaults);
    expect(r.contact).toMatchObject({ email: "i@z.com", display_name: "Beto" });
  });

  it("un valor fijo", () => {
    const r = applyContactMapping({}, {}, cfg([{ target: "contact.country", source: { const: "Costa Rica" } }]), defaults);
    expect(r.contact.country).toBe("CR");
  });

  it("readSource une una lista de textos y descarta objetos", () => {
    expect(readSource({ tags: ["a", "b"] }, {}, { path: "tags" })).toBe("a, b");
    expect(readSource({ x: { y: 1 } }, {}, { path: "x" })).toBeNull();
  });
});

describe("applyContactMapping: nombres y teléfonos", () => {
  it("split_name: nombre y apellido", () => {
    const r = applyContactMapping({ full: "Ana María Pérez" }, {}, cfg([row("contact.first_name_part", "full", "split_name"), row("contact.last_name_part", "full", "split_name")]), defaults);
    expect(r.contact.display_name).toBe("Ana María Pérez");
    expect(splitName("Ana María Pérez")).toEqual({ first: "Ana María", last: "Pérez" });
  });

  it("split_name('Ana') da nombre Ana y apellido vacío", () => {
    expect(splitName("Ana")).toEqual({ first: "Ana", last: "" });
    const r = applyContactMapping({ full: "Ana" }, {}, cfg([row("contact.first_name_part", "full", "split_name"), row("contact.last_name_part", "full", "split_name")]), defaults);
    expect(r.contact.display_name).toBe("Ana");
    expect(r.rows.find((x) => x.target === "contact.last_name_part")?.status).toBe("empty");
  });

  it("un nombre completo gana sobre las partes", () => {
    const r = applyContactMapping({ n: "Ana Pérez", f: "Otra" }, {}, cfg([row("contact.display_name", "n"), row("contact.first_name_part", "f")]), defaults);
    expect(r.contact.display_name).toBe("Ana Pérez");
  });

  it("clean_phone: +506 8888-1234 con y sin prefijo da el mismo E.164", () => {
    expect(cleanPhone("+506 8888-1234", "CR")).toBe("+50688881234");
    expect(cleanPhone("8888-1234", "CR")).toBe("+50688881234");
    expect(cleanPhone("00506 8888 1234", null)).toBe("+50688881234");
  });

  it("clean_phone('123') deja un error y no escribe el teléfono", () => {
    const r = applyContactMapping({ p: "123" }, {}, cfg([row("contact.phone", "p", "clean_phone")]), defaults);
    expect(r.contact.phone).toBeUndefined();
    expect(r.errors).toEqual([{ target: "contact.phone", reason: "telefono_invalido" }]);
    expect(r.rows[0]).toMatchObject({ status: "error", raw: "123" });
  });

  it("el teléfono se normaliza siempre, aunque no se pida la transformación", () => {
    const r = applyContactMapping({ p: "8888 1234" }, {}, cfg([row("contact.phone", "p")]), defaults);
    expect(r.contact.phone).toBe("+50688881234");
  });

  it("sin país por defecto ni prefijo: solo los dígitos", () => {
    expect(cleanPhone("50688881234", null)).toBe("50688881234");
    expect(cleanPhone("123", null)).toBeNull();
  });
});

describe("applyContactMapping: redes, país, personalizados y tags", () => {
  it("usuarios de redes se normalizan; uno inválido es un error", () => {
    const r = applyContactMapping({ ig: "@Ana.Perez", tt: "no es usuario!!" }, {}, cfg([row("contact.instagram_username", "ig"), row("contact.tiktok_username", "tt")]), defaults);
    expect(r.contact.instagram_username).toBe("ana.perez");
    expect(r.errors).toEqual([{ target: "contact.tiktok_username", reason: "usuario_invalido" }]);
  });

  it("un país que no se reconoce es un error", () => {
    const r = applyContactMapping({ c: "Narnia" }, {}, cfg([row("contact.country", "c")]), defaults);
    expect(r.errors[0]).toEqual({ target: "contact.country", reason: "pais_no_reconocido" });
  });

  it("campos personalizados: valida el tipo y el slug", () => {
    const r = applyContactMapping(
      { e: "ACME", b: "1500,5", a: "sí", n: "2000-01-05", m: "x" },
      {},
      cfg([row("contact.custom.empresa", "e"), row("contact.custom.presupuesto", "b"), row("contact.custom.acepta", "a"), row("contact.custom.nacimiento", "n"), row("contact.custom.borrado", "m")]),
      defaults,
    );
    expect(r.custom).toEqual({ empresa: "ACME", presupuesto: "1500.5", acepta: "true", nacimiento: "2000-01-05" });
    expect(r.errors).toEqual([{ target: "contact.custom.borrado", reason: "campo_personalizado_inexistente" }]);
  });

  it("tags desde el payload: separados por coma y sin repetir", () => {
    const r = applyContactMapping({ t: "vip, Lead , vip" }, {}, cfg([], { tags: { fixed: [], fromSource: { path: "t" } } }), defaults);
    expect(r.tagNames).toEqual(["vip", "Lead"]);
  });

  it("atribución mapeada a mano", () => {
    const r = applyContactMapping({ x: { c: "oct" } }, {}, cfg([], { attribution: { autoDetect: true, map: [{ key: "utm_campaign", source: { path: "x.c" } }] } }), defaults);
    expect(r.attribution).toEqual({ utm_campaign: "oct" });
  });

  it("hasIdentifier: nunca por nombre", () => {
    expect(hasIdentifier({ display_name: "Ana" })).toBe(false);
    expect(hasIdentifier({ phone: "+50688881234" })).toBe(true);
    expect(hasIdentifier({ instagram_username: "ana" })).toBe(true);
    expect(hasIdentifier({ facebook_id: "x" })).toBe(false);
  });
});

describe("applyContactMapping: nunca lanza", () => {
  it("payload null, lista en la raíz o 20 niveles", () => {
    let deep: unknown = { email: "a@b.com" };
    for (let i = 0; i < 20; i++) deep = { n: deep };
    for (const payload of [null, undefined, [1, 2], "texto", 5, deep]) {
      expect(() => applyContactMapping(payload, null, cfg([row("contact.email", "email")]), defaults)).not.toThrow();
    }
    expect(applyContactMapping(null, null, cfg([row("contact.email", "email")]), defaults).contact).toEqual({});
  });

  it("una config rota no tira el mapeo", () => {
    expect(() => applyContactMapping({}, {}, { map: undefined, tags: undefined, attribution: undefined } as never, defaults)).not.toThrow();
  });
});

describe("suggestMapRows: la sugerencia automática", () => {
  it("completa email, teléfono y nombre con las claves obvias", () => {
    const rows = suggestMapRows({ Email: "a@b.com", telefono: "88881234", nombre: "Ana", extra: 1 }, []);
    expect(rows.map((r) => r.target).sort()).toEqual(["contact.display_name", "contact.email", "contact.phone"]);
    expect(rows.find((r) => r.target === "contact.phone")).toMatchObject({ source: { path: "telefono" }, transform: "clean_phone" });
  });

  it("NO pisa una fila elegida a mano", () => {
    const chosen: MapRow[] = [row("contact.email", "data.correo")];
    const rows = suggestMapRows({ email: "a@b.com", name: "Ana" }, chosen);
    expect(rows.find((r) => r.target === "contact.email")?.source).toEqual({ path: "data.correo" });
    expect(rows.map((r) => r.target)).toContain("contact.display_name");
  });

  it("un ejemplo que no es objeto no cambia nada", () => {
    expect(suggestMapRows(null, [])).toEqual([]);
    expect(suggestMapRows([1], [])).toEqual([]);
  });
});
