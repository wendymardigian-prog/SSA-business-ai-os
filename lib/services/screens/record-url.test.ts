// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import { clientHref, legacyServiceRedirect, parseRecordParams, serviceHref, withRecord, withoutRecord } from "./record-url";

const S = "11111111-1111-4111-8111-111111111111";
const C = "22222222-2222-4222-8222-222222222222";

describe("las fichas en modal por la URL", () => {
  it("arma los links", () => {
    expect(serviceHref(S)).toBe(`/dashboard/clientes?servicio=${S}`);
    expect(serviceHref(S, { tab: "actividad" })).toBe(`/dashboard/clientes?servicio=${S}&panel=actividad`);
    expect(clientHref(C)).toBe(`/dashboard/clientes?cliente=${C}`);
  });
  it("lee que ficha pide la URL; un id que no es uuid no abre nada", () => {
    expect(parseRecordParams({ servicio: S })).toEqual({ kind: "service", id: S, tab: "camino" });
    expect(parseRecordParams(new URLSearchParams(`servicio=${S}&panel=actividad`))).toEqual({ kind: "service", id: S, tab: "actividad" });
    expect(parseRecordParams({ cliente: C })).toEqual({ kind: "client", id: C });
    expect(parseRecordParams({ servicio: S, cliente: C })).toMatchObject({ kind: "service" });
    expect(parseRecordParams({ servicio: "1;drop" })).toEqual({ kind: "none" });
    expect(parseRecordParams({})).toEqual({ kind: "none" });
  });
  it("abrir y cerrar conservan los filtros de la lista", () => {
    expect(withRecord("/dashboard/clientes", "f=red&q=ana", { kind: "client", id: C })).toBe(`/dashboard/clientes?f=red&q=ana&cliente=${C}`);
    expect(withRecord("/dashboard/clientes", `f=red&cliente=${C}`, { kind: "service", id: S })).toBe(`/dashboard/clientes?f=red&servicio=${S}`);
    expect(withoutRecord("/dashboard/clientes", `f=red&servicio=${S}&panel=actividad`)).toBe("/dashboard/clientes?f=red");
    expect(withoutRecord("/dashboard/clientes/lista", `cliente=${C}`)).toBe("/dashboard/clientes/lista");
  });
  it("el link viejo de la ficha del servicio sigue abriendo la misma pestaña", () => {
    expect(legacyServiceRedirect(S, "actividad")).toBe(`/dashboard/clientes?servicio=${S}&panel=actividad`);
    expect(legacyServiceRedirect(S, "datos")).toBe(`/dashboard/clientes?servicio=${S}`);
  });
});
