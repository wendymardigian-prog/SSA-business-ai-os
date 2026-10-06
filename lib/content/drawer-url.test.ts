import { describe, expect, it } from "vitest";
import { closeHref, drawerHref, parseDrawer } from "./drawer-url";

const ID = "425ac42a-2c7b-42ec-b047-5af199b64cc6";
const ID2 = "9a7e1b8c-0000-4000-8000-000000000001";

describe("el drawer vive en la URL (F95/F96)", () => {
  it("?piece= abre la pieza y ?idea= abre la idea", () => {
    expect(parseDrawer({ piece: ID })).toEqual({ kind: "piece", id: ID });
    expect(parseDrawer({ idea: ID })).toEqual({ kind: "idea", id: ID });
  });

  it("sin ninguno de los dos, no hay drawer", () => {
    expect(parseDrawer({})).toBeNull();
    expect(parseDrawer({ vista: "calendar" })).toBeNull();
  });

  it("si vienen los dos, gana la pieza (es lo ultimo que se abrio desde una idea)", () => {
    expect(parseDrawer({ idea: ID2, piece: ID })).toEqual({ kind: "piece", id: ID });
  });

  it("un id que no parece un id no abre nada: nunca llega a una consulta", () => {
    expect(parseDrawer({ piece: "'; drop table" })).toBeNull();
    expect(parseDrawer({ piece: "../../etc" })).toBeNull();
    expect(parseDrawer({ idea: "" })).toBeNull();
    expect(parseDrawer({ piece: "x".repeat(200) })).toBeNull();
  });

  it("lee de URLSearchParams igual que de un objeto", () => {
    expect(parseDrawer(new URLSearchParams(`piece=${ID}`))).toEqual({ kind: "piece", id: ID });
  });
});

describe("armar el link para abrir y cerrar", () => {
  it("abrir una pieza conserva la vista y los filtros", () => {
    const href = drawerHref(new URLSearchParams("vista=calendar&mes=2026-10&red=instagram"), { kind: "piece", id: ID });

    expect(href).toBe(`/dashboard/content?vista=calendar&mes=2026-10&red=instagram&piece=${ID}`);
  });

  it("abrir una idea saca la pieza que hubiera abierta (uno solo a la vez)", () => {
    const href = drawerHref(new URLSearchParams(`piece=${ID}&vista=list`), { kind: "idea", id: ID2 });

    expect(href).toContain(`idea=${ID2}`);
    expect(href).not.toContain("piece=");
    expect(href).toContain("vista=list");
  });

  it("cerrar saca el drawer y deja todo lo demas", () => {
    expect(closeHref(new URLSearchParams(`piece=${ID}&vista=calendar&mes=2026-10`))).toBe(
      "/dashboard/content?vista=calendar&mes=2026-10",
    );
  });

  it("cerrar sin nada mas queda en la ruta limpia, sin '?'", () => {
    expect(closeHref(new URLSearchParams(`idea=${ID}`))).toBe("/dashboard/content");
  });

  it("no duplica el parametro si ya estaba", () => {
    const href = drawerHref(new URLSearchParams(`piece=${ID}`), { kind: "piece", id: ID2 });

    expect(href).toBe(`/dashboard/content?piece=${ID2}`);
  });

  it("drawerHref con null cierra", () => {
    expect(drawerHref(new URLSearchParams(`piece=${ID}`), null)).toBe("/dashboard/content");
  });
});
