import { describe, expect, it } from "vitest";
import { alertPctFor, approachingThresholds, approachKey, approachTitle, DEFAULT_CAP_ALERT_PCT } from "./spend-alerts";
import { evaluateTaskCap, taskCapMessage } from "./workspace-budget";

const since = new Date("2026-11-01T05:00:00Z");

describe(" · freno por tarea", () => {
  it("sin tope guardado, la tarea pasa", () => {
    expect(evaluateTaskCap(null, 999)).toBe("allowed");
  });
  it("al llegar al tope (100 %) frena; por debajo pasa", () => {
    expect(evaluateTaskCap(30, 30)).toBe("blocked");
    expect(evaluateTaskCap(30, 31.5)).toBe("blocked");
    expect(evaluateTaskCap(30, 29.99)).toBe("allowed");
  });
  it("si no se pudo leer el gasto, no se llama al modelo", () => {
    expect(evaluateTaskCap(30, null)).toBe("read_error");
  });
  it("tope en 0: frenada desde el primer centavo", () => {
    expect(evaluateTaskCap(0, 0)).toBe("blocked");
  });
  it("el motivo dice qué tarea, cuánto y dónde subirlo", () => {
    const msg = taskCapMessage("Análisis de reuniones", 150);
    expect(msg).toContain("Análisis de reuniones");
    expect(msg).toContain("USD 150");
    expect(msg).toContain("Agentes IA ›");
  });
});

describe(" · aviso previo en agentes y tareas", () => {
  it("sin porcentaje guardado: 80 % en agentes y tareas, nada en los topes del negocio", () => {
    expect(DEFAULT_CAP_ALERT_PCT).toBe(80);
    expect(alertPctFor("task_monthly", null)).toBe(80);
    expect(alertPctFor("agent_monthly", undefined)).toBe(80);
    expect(alertPctFor("workspace_monthly", null)).toBeNull();
  });
  it("el porcentaje guardado manda en todos", () => {
    expect(alertPctFor("task_monthly", 70)).toBe(70);
    expect(alertPctFor("workspace_daily", 90)).toBe(90);
  });
  it("avisa al pasar el 80 % de la tarea y no al llegar al tope", () => {
    const at = (spentUsd: number) =>
      approachingThresholds([{ scope: "task_monthly", limitUsd: 100, spentUsd, since, task: "call_analysis", label: "Análisis" }], null);
    expect(at(79.99)).toHaveLength(0);
    expect(at(80)).toHaveLength(1);
    expect(at(100)).toHaveLength(0);
    expect(at(85)[0]).toMatchObject({ scope: "task_monthly", task: "call_analysis", pct: 80 });
  });
  it("avisa al agente (antes no tenía aviso previo)", () => {
    const out = approachingThresholds([{ scope: "agent_daily", limitUsd: 5, spentUsd: 4.2, since, agentId: "a1", label: "Setter" }], null);
    expect(out).toHaveLength(1);
    expect(out[0].agentId).toBe("a1");
    expect(approachTitle(out[0])).toContain("«Setter»");
  });
  it("una vez por tope y período: la clave lleva la tarea o el agente", () => {
    expect(approachKey({ scope: "task_monthly", periodStart: since, task: "call_summary" })).toEqual({
      scope: "task_monthly",
      period_start: since.toISOString(),
      task: "call_summary",
    });
    // La del negocio no cambia: los avisos viejos siguen contando como dados.
    expect(approachKey({ scope: "workspace_monthly", periodStart: since })).toEqual({ scope: "workspace_monthly", period_start: since.toISOString() });
  });
});
