import { describe, expect, it } from "vitest";
import {
  allColumns,
  columnMenuGroups,
  defaultVisibleKeys,
  parseColumnPrefs,
  serializeColumnPrefs,
  toggleColumnKey,
} from "./columns";

const fields = [
  { id: "f-viajeros", name: "Cantidad de viajeros" },
  { id: "f-destino", name: "Destino" },
];
const defs = allColumns(fields);
const keys = (list: string[]) => list;

describe("el catálogo de columnas", () => {
  it("Nombre es la única que no se oculta", () => {
    expect(defs.filter((c) => !c.hideable).map((c) => c.key)).toEqual(["name"]);
  });

  it("los campos personalizados van antes de Etiquetas, como antes del catálogo", () => {
    const order = defs.map((c) => c.key);
    expect(order.indexOf("cf:f-viajeros")).toBeLessThan(order.indexOf("tags"));
    expect(order.indexOf("cf:f-destino")).toBe(order.indexOf("cf:f-viajeros") + 1);
  });

  it("las claves no se repiten", () => {
    expect(new Set(defs.map((c) => c.key)).size).toBe(defs.length);
  });

  it("por defecto se ven las de siempre y las nuevas nacen ocultas", () => {
    expect(defaultVisibleKeys(defs)).toEqual(["name", "status", "contact", "setter", "vendedor", "product", "tags", "last_interaction"]);
  });
});

describe("las preferencias guardadas", () => {
  it("sin nada guardado, o roto, las de por defecto", () => {
    expect(parseColumnPrefs(null, defs)).toEqual(defaultVisibleKeys(defs));
    expect(parseColumnPrefs("{roto", defs)).toEqual(defaultVisibleKeys(defs));
    expect(parseColumnPrefs(JSON.stringify({ v: 9 }), defs)).toEqual(defaultVisibleKeys(defs));
  });

  it("el formato viejo conserva lo elegido y suma las que antes eran fijas", () => {
    const old = JSON.stringify(["email_status", "cf:f-viajeros", "cf:borrado"]);
    expect(parseColumnPrefs(old, defs)).toEqual(
      keys(["name", "contact", "setter", "vendedor", "email_status", "cf:f-viajeros", "tags", "last_interaction"]),
    );
  });

  it("el formato viejo vacío a propósito deja solo las que antes eran fijas", () => {
    expect(parseColumnPrefs("[]", defs)).toEqual(["name", "contact", "setter", "vendedor", "tags", "last_interaction"]);
  });

  it("el formato nuevo se respeta, descarta lo que ya no existe y nunca pierde Nombre", () => {
    const saved = serializeColumnPrefs(["status", "cf:borrado", "tags"]);
    expect(parseColumnPrefs(saved, defs)).toEqual(["name", "status", "tags"]);
  });

  it("prender y apagar respeta el orden de la tabla y no apaga Nombre", () => {
    const start = ["name", "tags"];
    expect(toggleColumnKey(start, "status", defs)).toEqual(["name", "status", "tags"]);
    expect(toggleColumnKey(start, "tags", defs)).toEqual(["name"]);
    expect(toggleColumnKey(start, "name", defs)).toEqual(start);
    expect(toggleColumnKey(start, "no-existe", defs)).toEqual(start);
  });
});

describe("el menú de columnas", () => {
  it("agrupa en orden y sin grupos vacíos", () => {
    const groups = columnMenuGroups(defs);
    const orders = groups.map((g) => g.group.order);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
    expect(groups.every((g) => g.columns.length > 0)).toBe(true);
  });

  it("el título «Campos personalizados» va arriba de sus campos y de nada más", () => {
    const custom = columnMenuGroups(defs).find((g) => g.group.key === "campos");
    expect(custom?.columns.map((c) => c.key)).toEqual(["cf:f-viajeros", "cf:f-destino"]);
  });

  it("el buscador encuentra por nombre, grupo o palabra extra, sin tildes", () => {
    expect(columnMenuGroups(defs, "interaccion").flatMap((g) => g.columns.map((c) => c.key))).toEqual(["last_interaction"]);
    expect(columnMenuGroups(defs, "personalizados").flatMap((g) => g.columns.map((c) => c.key))).toEqual(["cf:f-viajeros", "cf:f-destino"]);
    expect(columnMenuGroups(defs, "closer").flatMap((g) => g.columns.map((c) => c.key))).toEqual(["vendedor"]);
    expect(columnMenuGroups(defs, "zzz")).toEqual([]);
  });
});
