/**
 * Caracterizacion de la configuracion de tareas en segundo plano (Llamadas,
 * §4.3): lo que devuelve hoy `resolveBackgroundSettings` y lo que acepta
 * `validateBackgroundSettings`, con las cuatro claves que existen.
 */
import { describe, expect, it } from "vitest";
import { resolveBackgroundSettings, validateBackgroundSettings, BACKGROUND_TASKS, BATCH_CAPABLE_TASKS } from "./settings";

describe("resolveBackgroundSettings", () => {
  it("sin nada guardado devuelve los defaults de las cuatro tareas", () => {
    expect(resolveBackgroundSettings({})).toEqual({
      message_classification: { mode: "batch", frequency: "daily", hour: "03:00", model: null },
      conversation_summary: { mode: "now" },
      close_classification: { mode: "now" },
      knowledge_indexing: { mode: "now" },
    });
  });

  it("una entrada invalida cae a su default sin afectar a las demas", () => {
    const r = resolveBackgroundSettings({ conversation_summary: { mode: "nunca" }, close_classification: { mode: "off" } });
    expect(r.conversation_summary).toEqual({ mode: "now" });
    expect(r.close_classification).toEqual({ mode: "off" });
  });

  it("la indexacion de Conocimiento nunca queda apagada", () => {
    expect(resolveBackgroundSettings({ knowledge_indexing: { mode: "off" } }).knowledge_indexing).toEqual({ mode: "now" });
  });
});

describe("validateBackgroundSettings", () => {
  it("las tareas son estas cuatro y solo una sabe correr por lote", () => {
    expect([...BACKGROUND_TASKS]).toEqual(["message_classification", "conversation_summary", "close_classification", "knowledge_indexing"]);
    expect([...BATCH_CAPABLE_TASKS]).toEqual(["message_classification"]);
  });

  it("rechaza el modo lote en una tarea que no lo tiene", () => {
    const r = validateBackgroundSettings({ conversation_summary: { mode: "batch", frequency: "daily" } });
    expect(r.ok).toBe(false);
  });

  it("rechaza apagar la indexacion", () => {
    expect(validateBackgroundSettings({ knowledge_indexing: { mode: "off" } }).ok).toBe(false);
  });

  it("acepta un cambio valido y completa con defaults", () => {
    const r = validateBackgroundSettings({ close_classification: { mode: "off" } });
    expect(r.ok).toBe(true);
    expect(r.settings?.close_classification).toEqual({ mode: "off" });
    expect(r.settings?.message_classification).toEqual({ mode: "batch", frequency: "daily", hour: "03:00", model: null });
  });
});
