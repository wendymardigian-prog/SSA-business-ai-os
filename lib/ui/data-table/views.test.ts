import { describe, expect, it } from "vitest";
import { emptyPrefs } from "./prefs";
import { BASE_VIEW, buildViewConfig, canManageView, parseViewConfig, resolveActiveView, validateViewName, viewFilterString, viewHref, visibilityLine, type TableViewItem } from "./views";

const view = (id: string, filters = "", over: Partial<TableViewItem> = {}): TableViewItem => ({
  id, name: id, ownerId: "u1", visibility: "private", config: { v: 1, columns: emptyPrefs(), filters }, memberIds: [], defaultFor: [], ...over,
});

describe("filtros de una vista", () => {
  it("ordenados, sin la página, la búsqueda ni la vista", () => {
    expect(viewFilterString("pagina=3&estado=paid&q=ana&vista=x&producto=p1")).toBe("estado=paid&producto=p1");
    expect(viewFilterString(new URLSearchParams("b=2&a=1&c="))).toBe("a=1&b=2");
  });
  it("lo guardado se lee sin confiar", () => {
    expect(parseViewConfig(null)).toEqual({ v: 1, columns: emptyPrefs(), filters: "" });
    expect(parseViewConfig({ columns: { hidden: ["x"] }, filters: "pagina=2&estado=paid" }).filters).toBe("estado=paid");
    expect(buildViewConfig(emptyPrefs(), "q=ana&desde=2026-01-01").filters).toBe("desde=2026-01-01");
  });
});

describe("qué vista manda", () => {
  const v1 = view("v1", "estado=paid");
  const d = view("d", "pastilla=con_mora");
  it("?vista=base es la de sistema, aunque haya una predeterminada", () => {
    expect(resolveActiveView([d], "d", { vista: BASE_VIEW })).toEqual({ active: null, viewParam: BASE_VIEW, inheritedFilters: null });
  });
  it("?vista=<id>: sus columnas; los filtros solo se heredan si la URL vino sin nada más y sin ?vista=", () => {
    expect(resolveActiveView([v1, d], "d", { vista: "v1" })).toEqual({ active: v1, viewParam: "v1", inheritedFilters: null });
  });
  it("sin ?vista= y URL pelada: la predeterminada con sus filtros", () => {
    expect(resolveActiveView([v1, d], "d", {})).toEqual({ active: d, viewParam: "d", inheritedFilters: "pastilla=con_mora" });
  });
  it("sin ?vista= pero con filtros en la URL: la predeterminada, sin pisar los filtros del link", () => {
    expect(resolveActiveView([d], "d", { estado: "paid" })).toEqual({ active: d, viewParam: "d", inheritedFilters: null });
  });
  it("una vista que la persona no ve (o ya no existe) se ignora", () => {
    expect(resolveActiveView([d], "d", { vista: "otra" })).toEqual({ active: d, viewParam: "d", inheritedFilters: null });
    expect(resolveActiveView([v1], null, { vista: "otra" })).toEqual({ active: null, viewParam: null, inheritedFilters: null });
  });
  it("una predeterminada que ya no está visible no se usa", () => {
    expect(resolveActiveView([v1], "d", {})).toEqual({ active: null, viewParam: null, inheritedFilters: null });
  });
});

describe("links, nombres y permisos", () => {
  it("el link de una vista lleva su id y sus filtros; el de sistema, base", () => {
    expect(viewHref("/dashboard/ventas", view("v1", "estado=paid"))).toBe("/dashboard/ventas?estado=paid&vista=v1");
    expect(viewHref("/dashboard/ventas", null)).toBe("/dashboard/ventas?vista=base");
  });
  it("valida el nombre", () => {
    expect(validateViewName("  Mora   alta ")).toEqual({ ok: true, name: "Mora alta" });
    expect(validateViewName("   ").ok).toBe(false);
    expect(validateViewName("x".repeat(61)).ok).toBe(false);
  });
  it("quién administra una vista: su dueña, o Owner/Admin si no es privada", () => {
    expect(canManageView({ ownerId: "u1", visibility: "private" }, "u1", false)).toBe(true);
    expect(canManageView({ ownerId: "u1", visibility: "private" }, "u2", true)).toBe(false);
    expect(canManageView({ ownerId: "u1", visibility: "workspace" }, "u2", true)).toBe(true);
    expect(canManageView({ ownerId: "u1", visibility: "workspace" }, "u2", false)).toBe(false);
  });
  it("con quién se comparte", () => {
    expect(visibilityLine({ visibility: "private", memberIds: [] })).toBe("Solo vos");
    expect(visibilityLine({ visibility: "workspace", memberIds: [] })).toBe("Todo el equipo");
    expect(visibilityLine({ visibility: "selected", memberIds: ["a"] })).toBe("1 persona");
    expect(visibilityLine({ visibility: "selected", memberIds: ["a", "b"] })).toBe("2 personas");
  });
});
