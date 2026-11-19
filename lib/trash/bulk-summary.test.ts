import { describe, expect, it } from "vitest";
import { BULK_NOUNS, bulkCountLabel, bulkDeleteSummary } from "./bulk-summary";

describe("resumen de «Eliminar seleccionadas»", () => {
  it("cuenta lo eliminado con el género de cada registro", () => {
    expect(bulkDeleteSummary(8, [], BULK_NOUNS.sale)).toBe("8 eliminadas");
    expect(bulkDeleteSummary(1, [], BULK_NOUNS.payment)).toBe("1 eliminado");
    expect(bulkDeleteSummary(0, [], BULK_NOUNS.payment)).toBe("0 eliminados");
  });

  it("suma lo que no se pudo con su motivo, agrupando los iguales", () => {
    expect(bulkDeleteSummary(8, [{ error: "Tiene una comisión pagada." }], BULK_NOUNS.sale)).toBe("8 eliminadas · 1 no se pudo: Tiene una comisión pagada.");
    expect(bulkDeleteSummary(0, [{ error: "A" }, { error: "A" }], BULK_NOUNS.sale)).toBe("2 no se pudieron: A");
    expect(bulkDeleteSummary(1, [{ error: "A" }, { error: "B" }, { error: "A" }], BULK_NOUNS.payment)).toBe("1 eliminado · 3 no se pudieron: A (2); B (1)");
  });

  it("nombra la cantidad elegida", () => {
    expect(bulkCountLabel(1, BULK_NOUNS.sale)).toBe("1 venta");
    expect(bulkCountLabel(3, BULK_NOUNS.payment)).toBe("3 pagos");
  });
});
