import { describe, expect, it } from "vitest";
import {
  afterHistoryBudget,
  afterHistoryFailure,
  afterHistoryPage,
  historyUpperBound,
  historyView,
  INITIAL_WINDOW_MS,
  isHistoryRunning,
  MAX_PAGES,
  newHistoryState,
  parseHistoryState,
  resumeHistoryState,
  stopHistoryState,
  STALE_RUNNING_MS,
  type FathomHistoryState,
} from "./history-state";

const NOW = new Date("2026-11-06T12:00:00.000Z");
const fresh = () => newHistoryState({ runId: "r1", from: null, before: "2026-10-23T12:00:00.000Z", now: NOW });

describe("classify_ai", () => {
  it("apagado por defecto: una importacion vieja tampoco gasta IA", () => {
    expect(fresh().classify_ai).toBe(false);
    const { classify_ai: _omit, ...vieja } = fresh();
    expect(parseHistoryState(vieja)?.classify_ai).toBe(false);
    expect(newHistoryState({ runId: "r", from: null, before: "2026-10-23T12:00:00.000Z", now: NOW, classifyAi: true }).classify_ai).toBe(true);
  });
});

describe("historyUpperBound", () => {
  it("en manual llega hasta ahora mismo", () => {
    expect(historyUpperBound("2026-01-01T00:00:00.000Z", NOW, { mode: "manual", auto_since: null })).toBe(NOW.toISOString());
  });
  it("quien salio de manual llega hasta ese momento, no hasta su vieja marca de agua", () => {
    const since = new Date(NOW.getTime() - 3600_000).toISOString();
    expect(historyUpperBound("2026-01-01T00:00:00.000Z", NOW, { mode: "auto", auto_since: since })).toBe(since);
  });
  it("llega hasta la marca de agua: lo de despues lo cubre la consulta de cada 10 minutos", () => {
    expect(historyUpperBound("2026-11-01T00:00:00.000Z", NOW)).toBe("2026-11-01T00:00:00.000Z");
  });
  it("sin marca de agua corta donde empieza la ventana de la primera consulta", () => {
    expect(historyUpperBound(null, NOW)).toBe(new Date(NOW.getTime() - INITIAL_WINDOW_MS).toISOString());
  });
});

describe("parseHistoryState", () => {
  it("lee lo que escribio", () => {
    expect(parseHistoryState(JSON.parse(JSON.stringify(fresh())))).toEqual(fresh());
  });
  it("lo que no tiene la forma esperada es 'nunca se importo'", () => {
    expect(parseHistoryState(null)).toBeNull();
    expect(parseHistoryState([])).toBeNull();
    expect(parseHistoryState({ run_id: "x" })).toBeNull();
    expect(parseHistoryState({ ...fresh(), status: "rara" })).toBeNull();
  });
});

describe("afterHistoryPage", () => {
  it("con otra pagina sigue con el cursor nuevo y suma lo importado", () => {
    const { state, finished } = afterHistoryPage(fresh(), { imported: 3, nextCursor: "C2" }, NOW);
    expect(finished).toBe(false);
    expect(state).toMatchObject({ cursor: "C2", imported: 3, pages: 1, status: "running" });
  });
  it("sin otra pagina termina", () => {
    const { state, finished } = afterHistoryPage({ ...fresh(), imported: 2 }, { imported: 1, nextCursor: null }, NOW);
    expect(finished).toBe(true);
    expect(state).toMatchObject({ status: "done", imported: 3, finished_at: NOW.toISOString() });
  });
  it("si Fathom repite la pagina queda incompleta en vez de dar vueltas para siempre", () => {
    const { state, finished } = afterHistoryPage({ ...fresh(), cursor: "C2" }, { imported: 0, nextCursor: "C2" }, NOW);
    expect(finished).toBe(true);
    expect(state.status).toBe("partial");
    expect(state.last_error).toContain("misma página");
  });
  it("pasar el tope de paginas queda incompleta", () => {
    expect(afterHistoryPage({ ...fresh(), pages: MAX_PAGES - 1 }, { imported: 0, nextCursor: "C9" }, NOW).state.status).toBe("partial");
  });
  it("una pagina buena borra los reintentos y el motivo", () => {
    const { state } = afterHistoryPage({ ...fresh(), retries: 2, last_error: "x" }, { imported: 0, nextCursor: "C2" }, NOW);
    expect(state).toMatchObject({ retries: 0, last_error: null });
  });
});

describe("afterHistoryBudget", () => {
  it("guarda lo importado y sigue en la MISMA pagina", () => {
    const runAt = new Date(NOW.getTime() + 70_000);
    const { state, next } = afterHistoryBudget({ ...fresh(), cursor: "C2", imported: 8 }, 8, runAt, NOW);
    expect(state).toMatchObject({ cursor: "C2", imported: 16, status: "running" });
    expect(next).toEqual({ kind: "continue", runAt });
  });
});

describe("afterHistoryFailure", () => {
  const temporary = { temporary: true, message: "Fathom pidió esperar" };

  it("un fallo temporal espera 1, 5 y 15 minutos sin moverse de la pagina", () => {
    let state: FathomHistoryState = { ...fresh(), cursor: "C2" };
    for (const minutes of [1, 5, 15]) {
      const r = afterHistoryFailure(state, temporary, NOW);
      expect(r.next).toEqual({ kind: "continue", runAt: new Date(NOW.getTime() + minutes * 60_000) });
      state = r.state;
      expect(state.cursor).toBe("C2");
    }
  });
  it("agotados los reintentos queda incompleta con el motivo", () => {
    const { state, next } = afterHistoryFailure({ ...fresh(), retries: 3 }, temporary, NOW);
    expect(next).toEqual({ kind: "finished" });
    expect(state).toMatchObject({ status: "partial", last_error: "Fathom pidió esperar" });
  });
  it("respeta el Retry-After si es mas largo que la espera propia, y no si es mas corto", () => {
    const largo = afterHistoryFailure(fresh(), { ...temporary, retryAfterMs: 120_000 }, NOW).next;
    expect(largo).toEqual({ kind: "continue", runAt: new Date(NOW.getTime() + 120_000) });
    const corto = afterHistoryFailure(fresh(), { ...temporary, retryAfterMs: 5_000 }, NOW).next;
    expect(corto).toEqual({ kind: "continue", runAt: new Date(NOW.getTime() + 60_000) });
  });
  it("un fallo que no se arregla esperando queda incompleta enseguida, sin perder lo importado", () => {
    const { state, next } = afterHistoryFailure({ ...fresh(), imported: 4 }, { temporary: false, message: "Reconectá", imported: 2 }, NOW);
    expect(next).toEqual({ kind: "finished" });
    expect(state).toMatchObject({ status: "partial", imported: 6 });
  });
});

describe("seguir y frenar", () => {
  it("seguir conserva la pagina y lo importado, y sube el paso", () => {
    const state = resumeHistoryState({ ...fresh(), status: "partial", cursor: "C2", imported: 5, step: 3, retries: 3, last_error: "x", finished_at: "y" }, NOW);
    expect(state).toMatchObject({ status: "running", cursor: "C2", imported: 5, step: 4, retries: 0, last_error: null, finished_at: null });
  });
  it("frenar sube el paso: una vuelta en curso ya no puede pisarlo", () => {
    const state = stopHistoryState({ ...fresh(), step: 3 }, NOW);
    expect(state).toMatchObject({ status: "stopped", step: 4 });
  });
  it("una corrida sin novedades hace mas de media hora ya no cuenta como en curso", () => {
    expect(isHistoryRunning(fresh(), NOW)).toBe(true);
    expect(isHistoryRunning(fresh(), new Date(NOW.getTime() + STALE_RUNNING_MS + 1))).toBe(false);
    expect(isHistoryRunning(null, NOW)).toBe(false);
  });
});

describe("historyView", () => {
  it("sin importar: ofrece arrancar", () => {
    expect(historyView(null, NOW)).toMatchObject({ phase: "idle", canStart: true, canResume: false, canStop: false });
  });
  it("corriendo: dice cuantas van y solo deja frenar", () => {
    const v = historyView({ ...fresh(), imported: 12 }, NOW);
    expect(v).toMatchObject({ phase: "running", canStart: false, canResume: false, canStop: true });
    expect(v.message).toContain("12 llamadas");
  });
  it("terminada: dice cuantas y deja importar de nuevo", () => {
    expect(historyView({ ...fresh(), status: "done", imported: 1 }, NOW).message).toContain("1 llamada ");
    expect(historyView({ ...fresh(), status: "done", imported: 0 }, NOW).message).toContain("No había");
  });
  it("incompleta: muestra el motivo y deja seguir", () => {
    const v = historyView({ ...fresh(), status: "partial", last_error: "Reconectá" }, NOW);
    expect(v).toMatchObject({ phase: "partial", canResume: true, canStart: true });
    expect(v.message).toContain("Reconectá");
  });
  it("una corrida colgada se ofrece para seguir, no queda girando para siempre", () => {
    const v = historyView(fresh(), new Date(NOW.getTime() + STALE_RUNNING_MS + 1));
    expect(v).toMatchObject({ phase: "partial", canResume: true, canStop: false });
  });
  it("frenada: deja seguir", () => {
    expect(historyView({ ...fresh(), status: "stopped" }, NOW)).toMatchObject({ phase: "stopped", canResume: true });
  });
});
