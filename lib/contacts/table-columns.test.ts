import { describe, expect, it } from "vitest";
import { allColumns } from "./columns";
import { contactColumnMetas } from "./table-columns";

describe("columnas de contactos para la tabla común", () => {
  it("una por columna del catálogo, con grupo, ancho y Nombre que no se oculta", () => {
    const defs = allColumns([{ id: "f1", name: "Ciudad" }]);
    const metas = contactColumnMetas(defs);
    expect(metas.map((m) => m.key)).toEqual(defs.map((d) => d.key));
    const name = metas.find((m) => m.key === "name")!;
    expect(name).toMatchObject({ hideable: false, defaultVisible: true, defaultWidth: 240 });
    const custom = metas.find((m) => m.key === "cf:f1")!;
    expect(custom).toMatchObject({ label: "Ciudad", defaultVisible: false, defaultWidth: 160 });
    expect(typeof custom.group).toBe("string");
  });
});
