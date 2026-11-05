import { describe, expect, it } from "vitest";
import { parseImportState } from "@/lib/inbox-import/state";
import {
  afterBatch,
  afterImportFailure,
  canStartWhatsappImport,
  describeEvolutionFailure,
  newWhatsappImportState,
  parseWhatsappImportState,
  whatsappImportView,
  type BatchResult,
} from "./import-state";

const NOW = new Date("2026-11-05T12:00:00.000Z");

function batch(over: Partial<BatchResult> = {}): BatchResult {
  return { lastChat: "b@lid", total: 2, scanned: 1, conversations: 1, messages: 5, failed: 0, hasMore: true, truncated: false, ...over };
}

describe("parseWhatsappImportState", () => {
  it("ida y vuelta, y cualquier otra forma es null", () => {
    const state = newWhatsappImportState("run-1", NOW);
    expect(parseWhatsappImportState(JSON.parse(JSON.stringify(state)))).toEqual(state);
    expect(parseWhatsappImportState({ run_id: "x", status: "done", pass: 1, phase: "active" })).toBeNull();
    expect(parseWhatsappImportState(null)).toBeNull();
  });

  it("la tarjeta de Zernio no confunde este estado con el suyo: comparten columna", () => {
    expect(parseImportState(newWhatsappImportState("run-1", NOW))).toBeNull();
  });
});

describe("canStartWhatsappImport", () => {
  it("no arma otra mientras una corre, salvo que este colgada hace media hora", () => {
    const running = newWhatsappImportState("run-1", NOW);
    expect(canStartWhatsappImport(null, NOW)).toBe(true);
    expect(canStartWhatsappImport(running, new Date(NOW.getTime() + 60_000))).toBe(false);
    expect(canStartWhatsappImport(running, new Date(NOW.getTime() + 31 * 60_000))).toBe(true);
    expect(canStartWhatsappImport({ ...running, status: "done" }, NOW)).toBe(true);
  });
});

describe("afterBatch", () => {
  it("suma el avance y sigue si quedan chats", () => {
    const { state, next } = afterBatch(newWhatsappImportState("r", NOW), batch(), NOW);
    expect(next).toEqual({ kind: "continue" });
    expect(state).toMatchObject({ cursor: "b@lid", total: 2, scanned: 1, conversations: 1, messages: 5, status: "running" });
  });

  it("termina bien cuando no quedan", () => {
    const { state, next } = afterBatch(newWhatsappImportState("r", NOW), batch({ hasMore: false }), NOW);
    expect(next).toEqual({ kind: "finished" });
    expect(state.status).toBe("done");
    expect(state.finished_at).toBe(NOW.toISOString());
  });

  it("queda incompleta si algun chat no se pudo traer o hay mas que el tope", () => {
    expect(afterBatch(newWhatsappImportState("r", NOW), batch({ hasMore: false, failed: 1 }), NOW).state.status).toBe("partial");
    expect(afterBatch(newWhatsappImportState("r", NOW), batch({ hasMore: false, truncated: true }), NOW).state.status).toBe("partial");
  });
});

describe("afterImportFailure", () => {
  const empty = batch({ lastChat: null, scanned: 0, conversations: 0, messages: 0 });
  const temporary = { temporary: true, message: "x" };

  it("uno pasajero espera 1, 5 y 15 minutos y despues queda incompleta", () => {
    let state = newWhatsappImportState("r", NOW);
    for (const minutes of [1, 5, 15]) {
      const out = afterImportFailure(state, empty, temporary, NOW);
      expect(out.next).toEqual({ kind: "wait", runAt: new Date(NOW.getTime() + minutes * 60_000) });
      state = out.state;
    }
    const last = afterImportFailure(state, empty, temporary, NOW);
    expect(last.next).toEqual({ kind: "finished" });
    expect(last.state.status).toBe("partial");
  });

  it("no pierde lo terminado antes del fallo, y avanzar vuelve a contar los reintentos", () => {
    const state = { ...newWhatsappImportState("r", NOW), retries: 2 };
    const out = afterImportFailure(state, batch({ hasMore: true }), temporary, NOW);
    expect(out.state).toMatchObject({ cursor: "b@lid", messages: 5, retries: 1 });
    expect(out.next).toEqual({ kind: "wait", runAt: new Date(NOW.getTime() + 60_000) });
  });

  it("una clave rechazada no se arregla esperando", () => {
    const failure = describeEvolutionFailure(401);
    expect(failure.temporary).toBe(false);
    expect(afterImportFailure(newWhatsappImportState("r", NOW), empty, failure, NOW).state.status).toBe("partial");
    expect(describeEvolutionFailure(404).temporary).toBe(false);
    expect(describeEvolutionFailure(503).temporary).toBe(true);
    expect(describeEvolutionFailure(undefined).temporary).toBe(true);
  });
});

describe("whatsappImportView", () => {
  it("dice el avance y el resultado", () => {
    expect(whatsappImportView(null)).toBeNull();
    const running = { ...newWhatsappImportState("r", NOW), total: 122, scanned: 40, conversations: 39, messages: 380 };
    expect(whatsappImportView(running)).toMatchObject({ running: true, tone: "progress" });
    expect(whatsappImportView(running)?.text).toContain("40 de 122");
    expect(whatsappImportView({ ...running, status: "done" })?.text).toBe("Importación lista: 39 conversaciones nuevas y 380 mensajes.");
    expect(whatsappImportView({ ...running, status: "partial", last_error: "motivo" })).toMatchObject({ tone: "warning", detail: "motivo", running: false });
  });
});
