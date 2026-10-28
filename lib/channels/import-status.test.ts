import { describe, it, expect } from "vitest";
import { importStatusView } from "./import-status";
import { newImportState } from "@/lib/inbox-import/state";

const NOW = new Date("2026-10-28T12:00:00Z");
const fmt = (iso: string) => iso.slice(0, 10);

describe("importStatusView", () => {
  it("nunca importado (o algo ilegible): no muestra nada", () => {
    expect(importStatusView(null, fmt)).toBeNull();
    expect(importStatusView({ basura: true }, fmt)).toBeNull();
  });

  it("corriendo: cuantas van y que se vuelva a mirar", () => {
    const v = importStatusView({ ...newImportState(1, "r", NOW), imported: 340 }, fmt);
    expect(v).toMatchObject({ tone: "progress", running: true, canRetry: false });
    expect(v!.text).toBe("Importando conversaciones… 340 nuevas hasta ahora.");
  });

  it("esperando un reintento: lo dice, sin alarmar", () => {
    const v = importStatusView({ ...newImportState(1, "r", NOW), retries: 1, imported: 1 }, fmt);
    expect(v!.text).toMatch(/Zernio pidió esperar, sigue sola\. 1 nueva/);
  });

  it("terminada, con la pasada siguiente", () => {
    const v = importStatusView(
      { ...newImportState(1, "r", NOW), status: "done", imported: 1487, next_pass_at: "2026-10-29T12:00:00Z" },
      fmt,
    );
    expect(v).toMatchObject({ tone: "ok", running: false });
    expect(v!.text).toBe("1.487 conversaciones importadas. Vuelve a revisar el 2026-10-29.");
  });

  it("terminada sin nada nuevo y sin otra pasada", () => {
    const v = importStatusView({ ...newImportState("manual", "r", NOW), status: "done" }, fmt);
    expect(v!.text).toBe("Conversaciones al día.");
  });

  it("incompleta: lo que se importo, el motivo y Reintentar", () => {
    const v = importStatusView(
      { ...newImportState(1, "r", NOW), status: "partial", imported: 1, last_error: "Zernio no respondió (código 503)." },
      fmt,
    );
    expect(v).toMatchObject({
      tone: "warning",
      canRetry: true,
      detail: "Zernio no respondió (código 503).",
      text: "La importación quedó incompleta (1 conversación importada).",
    });
  });

  it("sin nada importado y con error", () => {
    const v = importStatusView({ ...newImportState(1, "r", NOW), status: "error", last_error: "x" }, fmt);
    expect(v!.text).toBe("No se pudieron importar las conversaciones.");
  });
});
