import { describe, it, expect } from "vitest";
import type { InboxImportState } from "./state";
import {
  afterFailure,
  afterPage,
  canStartImport,
  followUpPass,
  MAX_PAGES_PER_PHASE,
  newImportState,
  parseImportState,
  passForManualStart,
  RETRY_DELAYS_MS,
  STALE_RUNNING_MS,
} from "./state";

const NOW = new Date("2026-10-28T12:00:00Z");
const DAY = 24 * 60 * 60_000;

function page(over: Partial<{ received: number; imported: number; hasMore: boolean; nextCursor: string | null }> = {}) {
  return { received: 50, imported: 10, hasMore: true, nextCursor: "c-2", ...over };
}

describe("una corrida nueva", () => {
  it("arranca en las activas, desde el principio y corriendo", () => {
    expect(newImportState(1, "run-1", NOW)).toMatchObject({
      run_id: "run-1",
      status: "running",
      pass: 1,
      phase: "active",
      cursor: null,
      step: 0,
      scanned: 0,
      imported: 0,
      started_at: NOW.toISOString(),
    });
  });
});

describe("despues de una pagina", () => {
  it("con mas paginas, sigue con el cursor nuevo y suma lo mirado y lo importado", () => {
    const { state, next } = afterPage(newImportState(1, "r", NOW), page(), NOW);
    expect(next).toEqual({ kind: "page" });
    expect(state).toMatchObject({ cursor: "c-2", pages: 1, scanned: 50, imported: 10, retries: 0 });
  });

  it("sin mas paginas en las activas, pasa a las archivadas desde el principio", () => {
    const s = { ...newImportState(1, "r", NOW), cursor: "c-9", pages: 7 };
    const { state, next } = afterPage(s, page({ hasMore: false, nextCursor: null }), NOW);
    expect(next).toEqual({ kind: "page" });
    expect(state).toMatchObject({ phase: "archived", cursor: null, pages: 0, status: "running" });
  });

  it("sin mas paginas en las archivadas, termina y agenda la pasada de 24 horas", () => {
    const s = { ...newImportState(1, "r", NOW), phase: "archived" as const };
    const { state, next } = afterPage(s, page({ hasMore: false, nextCursor: null }), NOW);
    expect(state).toMatchObject({ status: "done", finished_at: NOW.toISOString() });
    expect(next).toEqual({ kind: "finished", followUp: { pass: 2, runAt: new Date(NOW.getTime() + DAY) } });
    expect(state.next_pass_at).toBe(new Date(NOW.getTime() + DAY).toISOString());
  });

  it("un cursor que se repite es una vuelta infinita: queda incompleta", () => {
    const s = { ...newImportState("manual", "r", NOW), cursor: "c-2" };
    const { state, next } = afterPage(s, page({ nextCursor: "c-2" }), NOW);
    expect(state.status).toBe("partial");
    expect(state.last_error).toMatch(/misma página/);
    expect(next).toEqual({ kind: "finished", followUp: null });
  });

  it("pasado el tope de paginas de una fase, corta", () => {
    const s = { ...newImportState("manual", "r", NOW), pages: MAX_PAGES_PER_PHASE - 1, cursor: "x" };
    const { state } = afterPage(s, page({ nextCursor: "y" }), NOW);
    expect(state.status).toBe("partial");
  });

  it("una pagina leida borra el error y los reintentos que habia", () => {
    const s = { ...newImportState(1, "r", NOW), retries: 2, last_error: "Zernio no respondió" };
    const { state } = afterPage(s, page(), NOW);
    expect(state).toMatchObject({ retries: 0, last_error: null });
  });
});

describe("despues de un fallo", () => {
  it("uno temporal espera 1, 5 y 15 minutos y vuelve a pedir la MISMA pagina", () => {
    let s: InboxImportState = { ...newImportState(1, "r", NOW), cursor: "c-4" };
    for (const delay of RETRY_DELAYS_MS) {
      const r = afterFailure(s, { temporary: true, message: "429" }, NOW);
      expect(r.next).toEqual({ kind: "wait", runAt: new Date(NOW.getTime() + delay) });
      expect(r.state.cursor).toBe("c-4");
      s = r.state;
    }
    const last = afterFailure(s, { temporary: true, message: "Zernio no respondió (código 429)" }, NOW);
    expect(last.state).toMatchObject({ status: "partial", last_error: "Zernio no respondió (código 429)" });
    expect(last.next.kind).toBe("finished");
  });

  it("uno que no se arregla esperando queda incompleto enseguida, con lo importado", () => {
    const s = { ...newImportState(1, "r", NOW), imported: 120 };
    const { state, next } = afterFailure(s, { temporary: false, message: "clave rechazada" }, NOW);
    expect(state).toMatchObject({ status: "partial", imported: 120, last_error: "clave rechazada" });
    // La pasada de 24 horas se agenda igual: puede que para entonces ande.
    expect(next).toMatchObject({ kind: "finished", followUp: { pass: 2 } });
  });
});

describe("las pasadas", () => {
  it("la 1 trae la de 24 horas, la 2 la de 7 dias (6 mas), la 3 y la manual ninguna", () => {
    expect(followUpPass(1)).toEqual({ pass: 2, delayMs: DAY });
    expect(followUpPass(2)).toEqual({ pass: 3, delayMs: 6 * DAY });
    expect(followUpPass(3)).toBeNull();
    expect(followUpPass("manual")).toBeNull();
  });

  it("Sincronizar en un canal nunca importado es la pasada 1; si ya se importo, una suelta", () => {
    expect(passForManualStart(null)).toBe(1);
    expect(passForManualStart(newImportState(1, "r", NOW))).toBe("manual");
  });
});

describe("si se puede arrancar otra corrida", () => {
  it("si nunca se importo o la anterior termino, si", () => {
    expect(canStartImport(null, NOW)).toBe(true);
    expect(canStartImport({ ...newImportState(1, "r", NOW), status: "done" }, NOW)).toBe(true);
    expect(canStartImport({ ...newImportState(1, "r", NOW), status: "partial" }, NOW)).toBe(true);
  });

  it("con una corriendo de verdad, no (dos clics no arman dos importaciones)", () => {
    expect(canStartImport(newImportState(1, "r", new Date(NOW.getTime() - 60_000)), NOW)).toBe(false);
  });

  it("una corriendo sin novedades hace mas de media hora se considera muerta", () => {
    const vieja = newImportState(1, "r", new Date(NOW.getTime() - STALE_RUNNING_MS - 1));
    expect(canStartImport(vieja, NOW)).toBe(true);
  });
});

describe("leer lo guardado", () => {
  it("lo que no tiene la forma esperada es como si nunca se hubiera importado", () => {
    expect(parseImportState(null)).toBeNull();
    expect(parseImportState("x")).toBeNull();
    expect(parseImportState({ run_id: "r", status: "otro" })).toBeNull();
    expect(parseImportState({ run_id: "r", status: "done", pass: 9, phase: "active" })).toBeNull();
  });

  it("ida y vuelta: lo que se guarda se lee igual", () => {
    const s = afterPage(newImportState(1, "r", NOW), page(), NOW).state;
    expect(parseImportState(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });
});
