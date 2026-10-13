import { describe, expect, it } from "vitest";
import { describeHistoryRow, RETENTION_NOTICE, type HistoryRowInput } from "./history-view";

const row = (over: Partial<HistoryRowInput>): HistoryRowInput => ({ status: "processed", payload: { a: 1 }, result: null, error_message: null, ...over });

describe("describeHistoryRow: los estados", () => {
  it.each([
    ["received", "Recibido", "info"],
    ["processing", "Procesando", "info"],
    ["processed", "Procesado", "success"],
    ["error", "Con error", "danger"],
    ["ignored", "Ignorado", "neutral"],
    ["captured", "Capturado", "warning"],
    ["paused", "Pausado", "neutral"],
  ] as const)("%s -> %s", (status, label, tone) => {
    expect(describeHistoryRow(row({ status })).chip).toEqual({ label, tone });
  });
});

describe("describeHistoryRow: los resultados", () => {
  it("contacto creado, actualizado, sin contacto y error", () => {
    const created = describeHistoryRow(row({ result: { flows: { f1: { status: "completed", contact_id: "c1", contact_name: "Ana Pérez", contact_result: "created" } } } }));
    expect(created.resultText).toBe("Contacto creado: Ana Pérez");

    const updated = describeHistoryRow(row({ result: { flows: { f1: { status: "completed", contact_id: "c1", contact_result: "updated" } } } }));
    expect(updated.resultText).toBe("Actualizado");

    const none = describeHistoryRow(row({ result: { flows: { f1: { status: "completed", contact_fail_reason: "no_identifier" } } } }));
    expect(none.resultText).toBe("Sin contacto");

    const error = describeHistoryRow(row({ status: "error", result: { flows: { f1: { status: "failed", error: "HTTP 500" } } } }));
    expect(error.resultText).toBe("Error: HTTP 500");
  });

  it("un error sin detalle de flujo usa el mensaje del envio", () => {
    expect(describeHistoryRow(row({ status: "error", error_message: "cuerpo no es JSON" })).resultText).toBe("Error: cuerpo no es JSON");
  });

  it("sin flujos que lo escuchen lo dice", () => {
    expect(describeHistoryRow(row({ result: { flows: {} } })).resultText).toBe("Ningún flujo publicado escucha este webhook");
  });
});

describe("describeHistoryRow: retencion", () => {
  it("con payload null avisa que se borro a los 90 dias", () => {
    expect(describeHistoryRow(row({ payload: null })).retentionNotice).toBe(RETENTION_NOTICE);
    expect(describeHistoryRow(row({ payload: {} })).retentionNotice).toBeNull();
  });
});
