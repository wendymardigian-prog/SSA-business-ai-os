import { describe, expect, it } from "vitest";
import { interpolateVariables } from "@/lib/flow-engine/interpolate";
import { bracketParts, normalizePayload, safeKey } from "./normalize";
import { flattenPaths } from "./payload-tree";
import { webhookVariables } from "./trigger-config";
import { readSource, suggestMapRows } from "./mapping";

describe("safeKey", () => {
  it("deja claves seguras para {{…}}", () => {
    expect(safeKey("Nombre completo")).toBe("nombre_completo");
    expect(safeKey("Teléfono")).toBe("telefono");
    expect(safeKey("e.mail")).toBe("e_mail");
    expect(safeKey("¿Cuál es tu empresa?")).toBe("cual_es_tu_empresa");
    expect(safeKey("utm-source")).toBe("utm-source");
    expect(safeKey("   ")).toBe("campo");
    expect(safeKey("__proto__")).toBe("proto");
  });
});

describe("bracketParts", () => {
  it("separa los corchetes de un formulario", () => {
    expect(bracketParts("cliente[email]")).toEqual(["cliente", "email"]);
    expect(bracketParts("items[0][precio]")).toEqual(["items", "0", "precio"]);
    expect(bracketParts("tags[]")).toEqual(["tags", ""]);
    expect(bracketParts("raro[")).toEqual(["raro["]);
    expect(bracketParts("simple")).toEqual(["simple"]);
  });
});

describe("normalizePayload", () => {
  const raro = {
    "Nombre completo": "Ana Pérez",
    "cliente[email]": "ana@x.com",
    "cliente[telefono]": "+34 600 000 000",
    "items[0][producto]": "Programa Pro",
    "items[0][precio]": "997",
    "tags[]": "a",
    meta: '{"sale":{"id":"S-1","total":997},"lista":[1,2]}',
    roto: "{no es json",
    anidado: { "Dirección postal": { Ciudad: "Madrid" } },
    lista: [{ "E-mail": "b@x.com" }],
  };

  it("expande corchetes, JSON en texto y claves raras", () => {
    const out = normalizePayload(raro);
    expect(out.nombre_completo).toBe("Ana Pérez");
    expect(out.cliente).toEqual({ email: "ana@x.com", telefono: "+34 600 000 000" });
    expect(out.items).toEqual({ "0": { producto: "Programa Pro", precio: "997" } });
    expect(out.tags).toEqual({ "0": "a" });
    expect(out.meta).toEqual({ sale: { id: "S-1", total: 997 }, lista: [1, 2] });
    expect(out.roto).toBe("{no es json");
    expect(out.anidado).toEqual({ direccion_postal: { ciudad: "Madrid" } });
    expect(out.lista).toEqual([{ "e-mail": "b@x.com" }]);
  });

  it("dos claves que quedan iguales no se pisan", () => {
    const out = normalizePayload({ "Email": "a@x.com", email: "b@x.com", "e mail": "c" });
    expect(out.email).toBe("a@x.com");
    expect(out.email_2).toBe("b@x.com");
    expect(out.e_mail).toBe("c");
  });

  it("lo que no es objeto o está roto no lanza", () => {
    expect(normalizePayload(null)).toEqual({});
    expect(normalizePayload("hola")).toEqual({ valor: "hola" });
    expect(normalizePayload([1, 2])).toEqual({ items: [1, 2] });
    expect(normalizePayload('{"a":1}')).toEqual({ a: 1 });
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    expect(() => normalizePayload(cyclic)).not.toThrow();
  });

  it("cada hoja normalizada se resuelve con {{webhook.data.…}}", () => {
    const vars = webhookVariables({ inboundId: "i", endpointId: "e", endpointName: "Pabbly", receivedAt: "2026-11-24T10:00:00Z", payload: raro, query: { "utm source": "fb" }, reprocessCount: 0 });
    const webhook = vars.webhook as { data: unknown; query_data: unknown; payload: unknown };
    expect(webhook.payload).toBe(raro);
    for (const leaf of flattenPaths(webhook.data)) {
      const text = interpolateVariables(`{{webhook.data.${leaf.path}}}`, vars);
      expect(text, leaf.path).not.toContain("{{");
    }
    expect(interpolateVariables("{{webhook.data.meta.sale.id}}", vars)).toBe("S-1");
    expect(interpolateVariables("{{webhook.query_data.utm_source}}", vars)).toBe("fb");
  });
});

describe("el mapeo lee la copia normalizada", () => {
  it("webhook.data.… en el mapeo, y lo viejo sigue igual", () => {
    const payload = { data: { email: "x@y.com" }, "cliente[email]": "ana@x.com" };
    expect(readSource(payload, {}, { path: "webhook.data.cliente.email" })).toBe("ana@x.com");
    expect(readSource(payload, {}, { path: "data.email" })).toBe("x@y.com");
    expect(readSource(payload, {}, { path: "payload.data.email" })).toBe("x@y.com");
  });

  it("un payload con su propia clave webhook se lee como antes", () => {
    const payload = { webhook: { data: { email: "propio@x.com" } } };
    expect(readSource(payload, {}, { path: "webhook.data.email" })).toBe("propio@x.com");
  });

  it("la sugerencia encuentra campos anidados", () => {
    const rows = suggestMapRows({ customer: { "E-mail": "a@b.com", Phone: "600" }, nombre: "Ana" }, []);
    expect(rows.find((r) => r.target === "contact.display_name")?.source).toEqual({ path: "nombre" });
    expect(rows.find((r) => r.target === "contact.phone")?.source).toEqual({ path: "webhook.data.customer.phone" });
  });
});
