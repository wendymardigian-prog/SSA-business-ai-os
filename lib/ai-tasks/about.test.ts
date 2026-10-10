import { describe, expect, it } from "vitest";
import { AI_TASK_IDS } from "./catalog";
import { taskAbout } from "./about";
import { CLASSIFIER_BATCH } from "@/lib/patterns/classifier";
import { SUMMARY_MAX_CHARS } from "@/lib/agent/summary";
import { DEFAULT_TASK_TAB, TASK_TABS, resolveTaskTab } from "./tabs";

describe("Cómo funciona: la misma estructura para las siete tareas", () => {
  it.each(AI_TASK_IDS)("%s tiene todas las secciones con contenido", (id) => {
    const about = taskAbout(id);
    expect(about.trigger.length).toBeGreaterThan(10);
    expect(about.cost.length).toBeGreaterThan(10);
    for (const list of [about.reads, about.decides, about.writes, about.limits]) {
      expect(list.length).toBeGreaterThan(0);
      for (const item of list) expect(item.trim()).not.toBe("");
    }
  });

  it("los topes salen de las constantes del codigo, no de un texto copiado", () => {
    expect(taskAbout("message_classification").limits.join(" ")).toContain(CLASSIFIER_BATCH.toLocaleString("es"));
    expect(taskAbout("conversation_summary").limits.join(" ")).toContain(SUMMARY_MAX_CHARS.toLocaleString("es"));
  });

  it("la clasificacion al cierre explica tags, temperatura y seguimiento", () => {
    const text = JSON.stringify(taskAbout("close_classification"));
    expect(text).toMatch(/Etiquetas/);
    expect(text).toMatch(/Temperatura/);
    expect(text).toMatch(/Seguimiento/);
  });
});

describe("pestañas de una tarea", () => {
  it("son cinco, la primera es Cómo funciona", () => {
    expect(TASK_TABS.map((t) => t.key)).toEqual(["como", "config", "instrucciones", "runs", "costos"]);
    expect(DEFAULT_TASK_TAB).toBe("como");
  });

  it("una pestaña que no existe cae en la primera", () => {
    expect(resolveTaskTab("runs")).toBe("runs");
    expect(resolveTaskTab("inventada")).toBe("como");
    expect(resolveTaskTab(undefined)).toBe("como");
  });
});
