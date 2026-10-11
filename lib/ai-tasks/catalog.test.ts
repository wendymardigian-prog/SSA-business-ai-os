import { describe, expect, it } from "vitest";
import { AI_TASKS, AI_TASK_IDS, ALL_AI_TASKS, CONFIGURABLE_AI_TASKS, controlLabel, getAiTask, hasEditableInstructions } from "./catalog";

describe("catalogo de tareas de IA", () => {
  it("tiene las diez tareas, sin repetir id", () => {
    expect(AI_TASK_IDS).toHaveLength(10);
    expect(new Set(AI_TASK_IDS).size).toBe(10);
    expect(ALL_AI_TASKS).toHaveLength(10);
  });

  it("solo la clasificacion de mensajes tiene modo propio (las demas no tienen modo económico implementado)", () => {
    expect(CONFIGURABLE_AI_TASKS.map((t) => t.id)).toEqual(["message_classification"]);
    expect(AI_TASKS.message_classification.control.kind).toBe("task");
    for (const t of ALL_AI_TASKS) expect(t.configurable).toBe(t.control.kind === "task");
  });

  it("Resumen y Clasificacion al cierre se controlan desde cada agente, sin selector propio", () => {
    expect(AI_TASKS.conversation_summary.control).toEqual({ kind: "agent", flag: "summaryOnClose" });
    expect(AI_TASKS.close_classification.control).toEqual({ kind: "agent", flag: "classifyOnClose" });
    expect(AI_TASKS.conversation_summary.backgroundTask).toBeUndefined();
    expect(AI_TASKS.close_classification.backgroundTask).toBeUndefined();
  });

  it("instrucciones: ocho editables; las otras dicen por que no tienen", () => {
    const editable = AI_TASK_IDS.filter((id) => hasEditableInstructions(AI_TASKS[id]));
    expect(editable.sort()).toEqual(["ads_analysis", "call_analysis", "call_classification", "call_summary", "close_classification", "conversation_summary", "media_description", "message_classification"]);
    for (const t of ALL_AI_TASKS) {
      if (!t.instructions.editable) expect(t.instructions.whyNot.length).toBeGreaterThan(20);
    }
  });

  it("todas declaran de donde sale su modelo y una etiqueta de como corren", () => {
    for (const t of ALL_AI_TASKS) {
      expect(t.modelSource.length).toBeGreaterThan(10);
      expect(controlLabel(t)).toBeTruthy();
    }
  });

  it("el analisis de anuncios corre bajo demanda: sin modo propio, con modelo elegible", () => {
    const t = AI_TASKS.ads_analysis;
    expect(t.source).toBe("ads_analysis");
    expect(t.configurable).toBe(false);
    expect(t.onDemand).toBe(true);
    expect(t.hasModelPicker).toBe(true);
  });

  it("tienen selector de modelo el analisis de anuncios y las tres de llamadas", () => {
    expect(AI_TASK_IDS.filter((id) => AI_TASKS[id].hasModelPicker).sort()).toEqual(["ads_analysis", "call_analysis", "call_classification", "call_summary"]);
  });

  it("las tareas de llamadas corren bajo demanda y dos tienen configuracion propia (no la de lote)", () => {
    for (const id of ["call_classification", "call_analysis", "call_summary"] as const) {
      const t = AI_TASKS[id];
      expect(t.source).toBe(id);
      expect(t.onDemand).toBe(true);
      expect(t.configurable).toBe(false);
      expect(t.backgroundTask).toBeUndefined();
    }
    expect(AI_TASKS.call_classification.callTask).toBe("call_classification");
    expect(AI_TASKS.call_analysis.callTask).toBe("call_analysis");
    expect(AI_TASKS.call_summary.callTask).toBeUndefined();
  });

  it("close_classification no tiene source propio: filtra por status_detail sobre conversation_summary", () => {
    const t = AI_TASKS.close_classification;
    expect(t.source).toBe("conversation_summary");
    expect(t.detailLike).toBe("%classified%");
  });

  it("knowledge_indexing no se puede apagar", () => {
    expect(AI_TASKS.knowledge_indexing.canTurnOff).toBe(false);
  });

  it("getAiTask: un id invalido devuelve null", () => {
    expect(getAiTask("no_existe")).toBeNull();
    expect(getAiTask("message_classification")?.name).toBe("Clasificación de mensajes");
  });
});
