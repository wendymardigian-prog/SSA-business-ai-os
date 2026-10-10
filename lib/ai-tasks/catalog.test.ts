import { describe, expect, it } from "vitest";
import { AI_TASKS, AI_TASK_IDS, ALL_AI_TASKS, CONFIGURABLE_AI_TASKS, getAiTask } from "./catalog";

describe("catalogo de tareas de IA", () => {
  it("tiene las siete tareas, sin repetir id", () => {
    expect(AI_TASK_IDS).toHaveLength(7);
    expect(new Set(AI_TASK_IDS).size).toBe(7);
    expect(ALL_AI_TASKS).toHaveLength(7);
  });

  it("las cuatro configurables son las de BACKGROUND_TASKS", () => {
    expect(CONFIGURABLE_AI_TASKS.map((t) => t.id).sort()).toEqual(
      ["message_classification", "conversation_summary", "close_classification", "knowledge_indexing"].sort(),
    );
  });

  it("solo las que admite el CHECK de 00137/00138 tienen instrucciones", () => {
    const withInstructions = AI_TASK_IDS.filter((id) => AI_TASKS[id].hasInstructions);
    expect(withInstructions.sort()).toEqual(["message_classification", "conversation_summary", "media_description", "ads_analysis"].sort());
  });

  it("el analisis de anuncios corre bajo demanda: sin modo propio, con modelo elegible", () => {
    const t = AI_TASKS.ads_analysis;
    expect(t.source).toBe("ads_analysis");
    expect(t.configurable).toBe(false);
    expect(t.onDemand).toBe(true);
    expect(t.hasModelPicker).toBe(true);
  });

  it("solo el analisis de anuncios tiene selector de modelo (por ahora)", () => {
    expect(AI_TASK_IDS.filter((id) => AI_TASKS[id].hasModelPicker)).toEqual(["ads_analysis"]);
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
