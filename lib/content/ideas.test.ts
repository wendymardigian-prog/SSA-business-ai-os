import { describe, it, expect } from "vitest";
import { contentExcerpt, ideaActions, ideaWaitingLabel, validateIdea } from "./ideas";

describe("validar una idea (F19)", () => {
  it("el titulo es lo unico obligatorio", () => {
    expect(validateIdea({ title: "  Una idea  " })).toEqual({
      ok: true,
      idea: expect.objectContaining({ title: "Una idea" }),
    });
    expect(validateIdea({ title: "   " })).toEqual({ ok: false, error: expect.any(String) });
  });

  it("los campos vacios quedan en null, no en cadena vacia", () => {
    // Asi "sin angulo" se distingue de "angulo en blanco" al leer la fila.
    const result = validateIdea({ title: "x", content: "   ", reference: "" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.idea.content).toBeNull();
    expect(result.idea.reference).toBeNull();
  });

  it("el texto unico se recorta pero conserva los saltos de linea de adentro", () => {
    const result = validateIdea({ title: "x", content: "  Hook\n\nAngulo\n\nNotas \n" });

    expect(result.ok && result.idea.content).toBe("Hook\n\nAngulo\n\nNotas");
  });

  it("la idea ya no tiene hook, angulo, notas ni pilar de texto: no se escriben mas", () => {
    // Las columnas viejas las borra la 00118; el codigo nuevo no las toca.
    const result = validateIdea({
      title: "x",
      hook: "viejo",
      angle: "viejo",
      notes: "viejo",
      pillar: "viejo",
    } as never);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.idea).sort()).toEqual(["content", "format", "reference", "title"]);
  });

  it("un titulo enorme se rechaza", () => {
    expect(validateIdea({ title: "a".repeat(201) }).ok).toBe(false);
  });
});

describe("los botones de una tarjeta de idea", () => {
  const conIa = { approve: true, ai: true, aiAvailable: true };

  it("en el DETALLE, quien aprueba ve aprobar, aprobar y producir, y descartar", () => {
    expect(ideaActions("nueva", conIa, { withDiscard: true }).map((a) => a.action)).toEqual([
      "approve",
      "approve_and_generate",
      "discard",
    ]);
  });

  it("en la TARJETA no hay descartar: es la unica destructiva de las tres (C3)", () => {
    // Al lado de "Aprobar", en una tarjeta chica, es pedir que alguien la
    // toque sin querer.
    expect(ideaActions("nueva", conIa).map((a) => a.action)).toEqual([
      "approve",
      "approve_and_generate",
    ]);
  });

  it("quien no aprueba no ve ninguno", () => {
    expect(ideaActions("nueva", { approve: false, ai: true, aiAvailable: true })).toEqual([]);
  });

  it("sin permiso de IA, no aparece el de producir copy", () => {
    expect(
      ideaActions("nueva", { approve: true, ai: false, aiAvailable: true }, { withDiscard: true }).map(
        (a) => a.action,
      ),
    ).toEqual(["approve", "discard"]);
  });

  it("sin proveedor de IA conectado aparece deshabilitado y dice como arreglarlo", () => {
    // Esconderlo no enseña que la funcion existe.
    const accion = ideaActions("nueva", { approve: true, ai: true, aiAvailable: false }).find(
      (a) => a.action === "approve_and_generate",
    );

    expect(accion?.disabledReason).toContain("Integraciones");
  });

  it("una idea ya aprobada o descartada no ofrece nada", () => {
    expect(ideaActions("aprobada", conIa)).toEqual([]);
    expect(ideaActions("descartada", conIa)).toEqual([]);
  });

  it("a quien no aprueba se le dice que su idea esta esperando", () => {
    expect(ideaWaitingLabel("nueva", false)).toBe("Esperando aprobacion");
    expect(ideaWaitingLabel("nueva", true)).toBeNull();
    expect(ideaWaitingLabel("aprobada", false)).toBeNull();
  });
});

describe("el comienzo de una idea en la tarjeta (F90)", () => {
  it("es la primera linea con algo escrito", () => {
    expect(contentExcerpt("\n\n  Si te da verguenza decir el precio\nSegunda linea")).toBe(
      "Si te da verguenza decir el precio",
    );
  });

  it("se recorta con puntos suspensivos", () => {
    const largo = "a".repeat(200);
    const out = contentExcerpt(largo, 50);

    expect(out).toHaveLength(50);
    expect(out?.endsWith("…")).toBe(true);
  });

  it("una idea sin texto no muestra nada", () => {
    expect(contentExcerpt(null)).toBeNull();
    expect(contentExcerpt("  \n  ")).toBeNull();
  });
});
