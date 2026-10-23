import { describe, expect, it } from "vitest";
import { matchesQuery } from "./search";

describe("matchesQuery", () => {
  it("sin tildes, todas las palabras, vacio = todo", () => {
    expect(matchesQuery(["Enviar email", "correo"], "mail")).toBe(true);
    expect(matchesQuery(["Cambiar estado de la reunión"], "reunion estado")).toBe(true);
    expect(matchesQuery(["Crear tarea"], "tarea email")).toBe(false);
    expect(matchesQuery(["x"], "  ")).toBe(true);
  });
});
