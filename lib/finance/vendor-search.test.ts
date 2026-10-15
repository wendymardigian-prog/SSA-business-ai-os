import { describe, expect, it } from "vitest";
import { canCreateVendor, searchVendors } from "./vendor-search";

const v = (name: string, archived_at: string | null = null) => ({ name, archived_at });
const list = [v("Google Workspace"), v("Agencia de diseño"), v("Diseño Pro"), v("Álvaro")];

describe("searchVendors", () => {
  it("sin texto, todos por orden alfabético", () => {
    expect(searchVendors(list, "").map((x) => x.name)).toEqual(["Agencia de diseño", "Álvaro", "Diseño Pro", "Google Workspace"]);
  });
  it("busca sin importar mayúsculas ni tildes y pone primero los que empiezan igual", () => {
    expect(searchVendors(list, "DISENO").map((x) => x.name)).toEqual(["Diseño Pro", "Agencia de diseño"]);
    expect(searchVendors(list, "alvaro").map((x) => x.name)).toEqual(["Álvaro"]);
  });
  it("respeta el tope", () => {
    expect(searchVendors(list, "", 2)).toHaveLength(2);
  });
});

describe("canCreateVendor", () => {
  it("ofrece crear solo con texto que no coincide exacto con un activo", () => {
    expect(canCreateVendor(list, "Hosting")).toBe(true);
    expect(canCreateVendor(list, "  ")).toBe(false);
    expect(canCreateVendor(list, "google workspace")).toBe(false);
    expect(canCreateVendor(list, "Google")).toBe(true);
  });
  it("un archivado con el mismo nombre no impide crear uno nuevo", () => {
    expect(canCreateVendor([v("Viejo", "2026-01-01")], "Viejo")).toBe(true);
  });
  it("no ofrece crear uno con un nombre demasiado largo", () => {
    expect(canCreateVendor([], "x".repeat(121))).toBe(false);
  });
});
