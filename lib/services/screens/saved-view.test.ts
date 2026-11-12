// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import { applySavedView, savedViewKey, viewFromParams } from "./saved-view";

describe("Guardar vista de Clientes", () => {
  it("guarda solo la vista (no la búsqueda ni la página)", () => {
    expect(viewFromParams("q=ana&modo=tablero&pagina=2&agrupar=light&f=red")).toBe("modo=tablero&f=red&agrupar=light");
    expect(savedViewKey("clientes", "u1")).toBe("ssa:clientes-vista:clientes:u1");
  });
  it("se aplica solo si la URL no trae una vista ni una ficha abierta", () => {
    expect(applySavedView("/dashboard/clientes", "", "modo=tablero&agrupar=phase")).toBe("/dashboard/clientes?modo=tablero&agrupar=phase");
    expect(applySavedView("/dashboard/clientes", "q=ana", "f=red")).toBe("/dashboard/clientes?q=ana&f=red");
    expect(applySavedView("/dashboard/clientes", "f=yellow", "f=red")).toBeNull();
    expect(applySavedView("/dashboard/clientes", "vista=tablero", "f=red")).toBeNull();
    expect(applySavedView("/dashboard/clientes", "servicio=x", "f=red")).toBeNull();
    expect(applySavedView("/dashboard/clientes", "", null)).toBeNull();
    expect(applySavedView("/dashboard/clientes", "", "q=solo")).toBeNull();
  });
});
