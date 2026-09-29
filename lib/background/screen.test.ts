import { describe, expect, it } from "vitest";
import { DEFAULT_BACKGROUND_SETTINGS } from "./settings";
import { estimatedSavings, formatSpend, lastRunLabel, taskRows } from "./screen";

describe("taskRows", () => {
  it("son las cuatro tareas, con sus defaults", () => {
    const rows = taskRows(DEFAULT_BACKGROUND_SETTINGS, {});
    expect(rows.map((r) => r.task)).toEqual([
      "message_classification",
      "conversation_summary",
      "close_classification",
      "knowledge_indexing",
    ]);
    expect(rows[0]).toMatchObject({ mode: "batch", frequency: "daily", hour: "03:00" });
    expect(rows[1].mode).toBe("now");
  });

  it("la indexacion de Conocimiento no se puede apagar ni pasar a lote", () => {
    const rows = taskRows(DEFAULT_BACKGROUND_SETTINGS, {});
    const kb = rows.find((r) => r.task === "knowledge_indexing");
    expect(kb?.canTurnOff).toBe(false);
    expect(kb?.canBatch).toBe(false);
  });

  it("solo dos tareas tienen aviso al pasar a economico", () => {
    const withWarning = taskRows(DEFAULT_BACKGROUND_SETTINGS, {}).filter((r) => r.batchWarning !== null);
    expect(withWarning.map((r) => r.task)).toEqual(["conversation_summary", "close_classification"]);
  });

  it("trae la ultima corrida de cada tarea", () => {
    const rows = taskRows(DEFAULT_BACKGROUND_SETTINGS, {
      message_classification: { at: "2026-09-28T09:00:00.000Z", status: "completed", detail: null, monthSpendUsd: 0.04 },
    });
    expect(rows[0].lastRun?.monthSpendUsd).toBe(0.04);
    expect(rows[1].lastRun).toBeNull();
  });
});

describe("estimatedSavings", () => {
  const base = taskRows(DEFAULT_BACKGROUND_SETTINGS, {
    message_classification: { at: null, status: null, detail: null, monthSpendUsd: 0.05 },
  });

  it("estima sobre lo gastado por las tareas en lote", () => {
    const { savedUsd, batchTasks } = estimatedSavings(base, 0.5);
    expect(batchTasks).toBe(1);
    // Gasto 0,05 con 50 % de descuento: sin el hubiera costado 0,10.
    expect(savedUsd).toBe(0.05);
  });

  it("sin tareas en lote no hay ahorro que estimar", () => {
    const rows = taskRows({ ...DEFAULT_BACKGROUND_SETTINGS, message_classification: { mode: "now" } }, {});
    expect(estimatedSavings(rows, 0.5)).toEqual({ savedUsd: null, batchTasks: 0 });
  });

  it("sin descuento del proveedor no inventa un ahorro", () => {
    expect(estimatedSavings(base, 0).savedUsd).toBeNull();
  });

  it("sin gasto todavia, tampoco", () => {
    const rows = taskRows(DEFAULT_BACKGROUND_SETTINGS, {});
    expect(estimatedSavings(rows, 0.5).savedUsd).toBeNull();
  });
});

describe("lastRunLabel", () => {
  const now = new Date("2026-09-28T20:00:00.000Z");

  it("hoy, ayer y una fecha", () => {
    expect(lastRunLabel("2026-09-28T09:00:00.000Z", now)).toMatch(/^Hoy /);
    expect(lastRunLabel("2026-09-27T09:00:00.000Z", now)).toMatch(/^Ayer /);
    expect(lastRunLabel("2026-09-23T09:00:00.000Z", now)).toMatch(/sept/);
  });

  it("sin corridas lo dice", () => {
    expect(lastRunLabel(null, now)).toBe("Nunca corrió");
    expect(lastRunLabel("no es una fecha", now)).toBe("Nunca corrió");
  });
});

describe("formatSpend", () => {
  it("sin dato, una raya (nunca USD 0)", () => {
    expect(formatSpend(null)).toBe("—");
  });
  it("centavos con mas decimales", () => {
    expect(formatSpend(0.002)).toContain("0,002");
    expect(formatSpend(1.86)).toBe("USD 1,86");
  });
});
