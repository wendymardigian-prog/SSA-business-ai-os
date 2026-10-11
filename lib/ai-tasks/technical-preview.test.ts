import { describe, expect, it } from "vitest";
import { technicalPreviewFor } from "./technical-preview";
import { AI_TASK_IDS, AI_TASKS } from "./catalog";

describe("la parte tecnica de las tareas de llamadas", () => {
  it("Clasificacion: los tipos validos y que lo que viene es dato", () => {
    const t = technicalPreviewFor("call_classification");
    expect(t).toContain("TIPOS VÁLIDOS");
    expect(t).toContain("- cierre");
    expect(t).toContain("DATOS para clasificar");
  });
  it("Analisis: la rubrica, las categorias y la advertencia anti-inyeccion; sin bloque de formato", () => {
    const t = technicalPreviewFor("call_analysis");
    expect(t).toContain("DATOS para analizar");
    expect(t).toContain("Rúbrica del closer");
    expect(t).not.toContain("Formato de respuesta");
  });
  it("Resumen: la regla de la memoria y los datos", () => {
    const t = technicalPreviewFor("call_summary");
    expect(t).toContain("DATOS para resumir");
    expect(t).toContain("memoria integrada");
  });
  it("toda tarea con instrucciones editables y parte fija tiene su vista previa no vacia", () => {
    for (const id of ["message_classification", "conversation_summary", "close_classification", "call_classification", "call_analysis", "call_summary"] as const) {
      expect(AI_TASK_IDS).toContain(id);
      expect(AI_TASKS[id].instructions.editable).toBe(true);
      expect(technicalPreviewFor(id).length, id).toBeGreaterThan(20);
    }
  });
});
