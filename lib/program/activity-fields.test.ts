// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import { HELP_MAX, PORTAL_FIELD_TYPES, cleanHelp, fieldDefinition, fieldForType, portalFieldsIssue, type PortalFieldInput } from "./activity-fields";
import { ratingAnswerLabel, ratingSummary } from "./activity-survey";

const q = (p: Partial<PortalFieldInput> = {}): PortalFieldInput => ({ key: "p1", type: "long_text", label: "¿Qué te pareció?", required: true, ...p });

describe("preguntas de una actividad", () => {
  it("las estrellas son solo de actividades", () => {
    expect(PORTAL_FIELD_TYPES.activity).toContain("rating");
    expect(PORTAL_FIELD_TYPES.quiz).not.toContain("rating");
    expect(PORTAL_FIELD_TYPES.terms).not.toContain("rating");
    expect(portalFieldsIssue([q({ type: "rating" })], "quiz")).toMatch(/no va acá/);
    expect(portalFieldsIssue([q({ type: "rating" })], "activity")).toBeNull();
  });

  it("una pregunta de estrellas necesita su texto", () => expect(portalFieldsIssue([q({ type: "rating", label: "  " })], "activity")).toMatch(/estrellas/));

  it("lo de siempre: sin preguntas, claves repetidas y opciones", () => {
    expect(portalFieldsIssue([], "activity")).toBe("Agregá al menos una pregunta");
    expect(portalFieldsIssue([q(), q()], "activity")).toBe("Hay preguntas con la misma clave");
    expect(portalFieldsIssue([q({ type: "single_select", options: ["A", " "] })], "activity")).toMatch(/dos opciones/);
  });

  it("las estrellas se guardan con la escala de Formularios (1 a 5)", () => {
    expect(fieldDefinition(q({ type: "rating" }), "activity")).toMatchObject({ type: "rating", min: 1, max: 5 });
    expect(fieldDefinition(q(), "activity")).not.toHaveProperty("min");
  });

  it("la ayuda: limpia, con tope y solo en actividades", () => {
    expect(cleanHelp("  Contanos\n qué te gustó  ")).toBe("Contanos qué te gustó");
    expect(cleanHelp("   ")).toBeUndefined();
    expect(cleanHelp(3)).toBeUndefined();
    expect(cleanHelp("x".repeat(HELP_MAX + 50))).toHaveLength(HELP_MAX);
    expect(fieldDefinition(q({ help: "Contanos todo" }), "activity").help).toBe("Contanos todo");
    expect(fieldDefinition(q({ help: "Contanos todo" }), "quiz")).not.toHaveProperty("help");
    expect(fieldDefinition(q({ help: "  " }), "activity")).not.toHaveProperty("help");
  });

  it("cambiar de tipo deja las opciones solo donde van", () => {
    expect(fieldForType(q(), "single_select").options).toEqual(["", ""]);
    expect(fieldForType(q({ type: "single_select", options: ["A", "B"] }), "rating").options).toBeUndefined();
  });
});

describe("estrellas en la revisión y el resumen", () => {
  it("se leen como estrellas", () => {
    expect(ratingAnswerLabel(4)).toBe("★★★★☆ (4)");
    expect(ratingAnswerLabel(1)).toBe("★☆☆☆☆ (1)");
    expect(ratingAnswerLabel(5)).toBe("★★★★★ (5)");
    expect(ratingAnswerLabel("4")).toBeNull();
    expect(ratingAnswerLabel(7)).toBeNull();
    expect(ratingAnswerLabel(3.5)).toBeNull();
  });

  const fields = [{ key: "r", label: "¿Qué te pareció?", type: "rating" }, { key: "t", label: "Texto", type: "long_text" }];

  it("promedio con la última entrega de cada estudiante", () => {
    const s = ratingSummary(fields, [
      { contactId: "a", createdAt: "2026-11-01T00:00:00Z", answers: { r: 2 } },
      { contactId: "a", createdAt: "2026-11-02T00:00:00Z", answers: { r: 4 } },
      { contactId: "b", createdAt: "2026-11-01T00:00:00Z", answers: { r: 5 } },
      { contactId: "c", createdAt: "2026-11-01T00:00:00Z", answers: { r: "lo que sea" } },
    ]);
    expect(s).toEqual([{ key: "r", label: "¿Qué te pareció?", average: 4.5, responses: 2, max: 5 }]);
  });

  it("sin respuestas el promedio es null, nunca 0", () => expect(ratingSummary(fields, [])[0]).toMatchObject({ average: null, responses: 0 }));
  it("sin preguntas de estrellas no hay resumen", () => expect(ratingSummary([fields[1]], [])).toEqual([]));
});
