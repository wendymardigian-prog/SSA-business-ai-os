import { describe, expect, it } from "vitest";
import { deleteBlockedBy, generateToken, hookUrl, isToken, parseSampleJson, validateEndpointInput } from "./endpoints";

describe("generateToken", () => {
  it("22 caracteres URL-safe y distintos entre si", () => {
    const tokens = new Set(Array.from({ length: 200 }, generateToken));
    expect(tokens.size).toBe(200);
    for (const t of tokens) {
      expect(t).toHaveLength(22);
      expect(isToken(t)).toBe(true);
    }
  });
});

describe("hookUrl", () => {
  it("arma la URL sin barras dobles", () => {
    expect(hookUrl("https://app.example.com/", "A".repeat(22))).toBe(`https://app.example.com/api/hooks/${"A".repeat(22)}`);
    expect(hookUrl(null, "T")).toBe("/api/hooks/T");
  });
});

describe("validateEndpointInput", () => {
  it("normaliza espacios y pasa lo opcional a null", () => {
    expect(validateEndpointInput({ name: "  Typeform  ", description: "  ", eventIdPath: "" })).toEqual({
      ok: true, value: { name: "Typeform", description: null, eventIdPath: null },
    });
  });
  it("el nombre es obligatorio y tiene tope", () => {
    expect(validateEndpointInput({ name: "  " }).ok).toBe(false);
    expect(validateEndpointInput({ name: "x".repeat(121) }).ok).toBe(false);
    expect(validateEndpointInput({}).ok).toBe(false);
  });
  it("la ruta del id acepta event_id, data.id y items.0.id; rechaza lo raro", () => {
    for (const ok of ["event_id", "data.id", "items.0.id", "form_response.token"]) {
      expect(validateEndpointInput({ name: "x", eventIdPath: ok }).ok).toBe(true);
    }
    for (const bad of ["data..id", ".id", "a b", "a;b", "a[0]"]) {
      expect(validateEndpointInput({ name: "x", eventIdPath: bad }).ok).toBe(false);
    }
  });
});

describe("parseSampleJson", () => {
  it("un JSON invalido se rechaza con el error de parseo", () => {
    const r = parseSampleJson("{no es json");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/JSON no es válido/);
  });
  it("tiene que ser un objeto", () => {
    expect(parseSampleJson("[1,2]").ok).toBe(false);
    expect(parseSampleJson("42").ok).toBe(false);
    expect(parseSampleJson("").ok).toBe(false);
    expect(parseSampleJson(undefined).ok).toBe(false);
  });
  it("un objeto valido pasa", () => {
    expect(parseSampleJson('{"email":"a@b.com"}')).toEqual({ ok: true, value: { email: "a@b.com" } });
  });
  it("tiene tope de tamano", () => {
    expect(parseSampleJson(JSON.stringify({ x: "y".repeat(300 * 1024) })).ok).toBe(false);
  });
});

describe("deleteBlockedBy", () => {
  it("rechaza si un flujo publicado lo usa, con su nombre", () => {
    const r = deleteBlockedBy([{ id: "1", name: "Bienvenida", status: "published" }, { id: "2", name: "Borrador", status: "draft" }]);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.flowNames).toEqual(["Bienvenida"]);
    expect(!r.ok && r.error).toContain("«Bienvenida»");
  });
  it("un flujo en borrador no lo impide", () => {
    expect(deleteBlockedBy([{ id: "2", name: "Borrador", status: "draft" }]).ok).toBe(true);
    expect(deleteBlockedBy([]).ok).toBe(true);
  });
});
