import { describe, expect, it } from "vitest";
import { attributionColumnMetas, ATTRIBUTION_COLUMN_WIDTH, ATTRIBUTION_WIDE_COLUMN_WIDTH } from "./table-columns";
import type { ColumnDef } from "./columns";

const def = (over: Partial<ColumnDef<unknown>>): ColumnDef<unknown> => ({ key: "attr:x", label: "X", group: "campaign", defaultVisible: false, value: () => "", ...over });

describe("attributionColumnMetas", () => {
  it("lleva clave, etiqueta, visibilidad y el nombre del grupo", () => {
    const [meta] = attributionColumnMetas([def({ key: "attr:utm_source", label: "Fuente", defaultVisible: true })], [{ key: "campaign", label: "Campaña" }]);
    expect(meta).toMatchObject({ key: "attr:utm_source", label: "Fuente", group: "Campaña", defaultVisible: true, defaultWidth: ATTRIBUTION_COLUMN_WIDTH });
  });

  it("un grupo desconocido queda con su clave y una columna para copiar arranca más ancha", () => {
    const [meta] = attributionColumnMetas([def({ group: "otro", copyable: true })], []);
    expect(meta.group).toBe("otro");
    expect(meta.defaultWidth).toBe(ATTRIBUTION_WIDE_COLUMN_WIDTH);
  });
});
