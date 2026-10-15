import { describe, expect, it } from "vitest";
import { commissionDbError, isPositionClash } from "./errors";

describe("errores de la base, en palabras", () => {
  it("traduce los de roles y personas (CM001 / CM002)", () => {
    expect(commissionDbError({ code: "CM001", message: 'El rol "x" no existe o esta desactivado.' }, "f")).toMatch(/desactivado/);
    expect(commissionDbError({ code: "CM001", message: "Una regla de un rol de persona fija necesita la persona." }, "f")).toMatch(/persona fija/);
    expect(commissionDbError({ code: "CM001", message: "La persona de la regla tiene que ser parte del equipo." }, "f")).toMatch(/no es del equipo/);
    expect(commissionDbError({ code: "CM001", message: 'El rol "x" no existe.' }, "f")).toBe("Ese rol no existe.");
    expect(commissionDbError({ code: "CM002", message: "Un rol de comision no se borra: se desactiva (vendedor)." }, "f")).toMatch(/se desactiva/);
    expect(commissionDbError({ code: "CM002", message: "A quien se le paga un rol de comision no se cambia (vendedor)." }, "f")).toMatch(/no se puede cambiar/);
    expect(commissionDbError({ code: "CM002", message: "Un rol precargado sigue siendo precargado (vendedor)." }, "f")).toMatch(/precargado/);
    expect(commissionDbError({ code: "CM002", message: "Hay dos roles de comision con la misma clave." }, "f")).toMatch(/misma clave/);
    expect(commissionDbError({ code: "CM002", message: "La clave de un rol de comision tiene que ser ^[a-z0-9_]{2,40}$." }, "f")).toMatch(/clave del rol no es válida/);
  });

  it("traduce los de la comisión (CM003)", () => {
    expect(commissionDbError({ code: "CM003", message: "Las comisiones las escribe el servidor." }, "f")).toMatch(/solo las escribe el sistema/);
    expect(commissionDbError({ code: "CM003", message: "Una comision de un gasto pagado no se suelta." }, "f")).toMatch(/gasto ya pagado/);
    expect(commissionDbError({ code: "CM003", message: "Una comision no cambia de monto, pago, regla ni tipo: se anula y se genera de nuevo." }, "f")).toMatch(/ajuste/);
  });

  it("un choque de posiciones se dice como «dos personas a la vez»", () => {
    expect(isPositionClash({ code: "23P01" })).toBe(true);
    expect(isPositionClash({ code: "23505" })).toBe(true);
    expect(isPositionClash({ code: "42501" })).toBe(false);
    expect(commissionDbError({ code: "23P01", message: "conflicting key value violates exclusion constraint" }, "f")).toMatch(/al mismo tiempo/);
  });

  it("lo desconocido cae en el mensaje de quien llama, sin el detalle técnico", () => {
    expect(commissionDbError({ code: "XX000", message: "relation boom" }, "No pude guardar")).toBe("No pude guardar");
    expect(commissionDbError(null, "No pude guardar")).toBe("No pude guardar");
    expect(commissionDbError({ code: "CM001", message: "texto nuevo que no conocemos" }, "No pude guardar")).toBe("No pude guardar");
  });
});
