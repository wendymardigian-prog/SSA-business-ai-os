/**
 * Caracterizacion de la cola de jobs: lo que hace HOY.
 *
 * Se escribe ANTES de sumarle tipos nuevos (publicar, metricas, copy con IA).
 * Si alguno de estos casos cambia sin querer, lo que se rompe es la
 * indexacion de la base de conocimiento, el cierre de conversaciones o los
 * flows con espera — cosas que no se notan al probar lo nuevo.
 */

import { describe, it, expect } from "vitest";
import {
  BATCH_SIZE,
  decideClaim,
  decideFailure,
  EXCLUDED_TYPES,
  isExcludedFromRunner,
  MAX_ATTEMPTS,
  retryDelayMs,
  type JobSnapshot,
} from "./dispatch";

const job = (over: Partial<JobSnapshot> = {}): JobSnapshot => ({
  id: "j1",
  type: "index_document",
  status: "pending",
  attempts: 0,
  claimed_at: null,
  ...over,
});

describe("que jobs toma el runner", () => {
  it("los turnos del agente NO los toma: tienen su propia ruta", () => {
    // Si los tomara, caerian en el default y se marcarian completados sin
    // haber respondido.
    expect(isExcludedFromRunner("agent_burst")).toBe(true);
    expect(EXCLUDED_TYPES).toEqual(["agent_burst"]);
  });

  it("los demas tipos si", () => {
    for (const type of ["index_document", "conversation_close", "resume_flow", "send_broadcast", "bg_task"]) {
      expect(isExcludedFromRunner(type), type).toBe(false);
    }
  });

  it("toma de a 20", () => {
    expect(BATCH_SIZE).toBe(20);
  });
});

describe("antes de ejecutar un job", () => {
  it("uno pendiente se reclama", () => {
    expect(decideClaim(job())).toEqual({ action: "claim" });
  });

  it("uno colgado con hora de reclamo se vuelve a reclamar", () => {
    expect(decideClaim(job({ status: "processing", claimed_at: "2026-09-26T10:00:00Z" }))).toEqual({
      action: "claim",
    });
  });

  it("uno 'processing' SIN hora solo se marca: podria estar corriendo ahora", () => {
    // Tomarlo seria ejecutarlo dos veces en paralelo, y en una publicacion eso
    // es publicar dos veces.
    const decision = decideClaim(job({ status: "processing", claimed_at: null }));

    expect(decision.action).toBe("stamp_only");
  });

  it("uno que ya gasto sus intentos se da por perdido sin volver a correrlo", () => {
    // Sin esto, un job que cuelga siempre se reintentaria para siempre.
    const decision = decideClaim(job({ attempts: MAX_ATTEMPTS, status: "processing", claimed_at: "2026-01-01T00:00:00Z" }));

    expect(decision.action).toBe("fail_exhausted");
  });

  it("el maximo es 3", () => {
    expect(MAX_ATTEMPTS).toBe(3);
    expect(decideClaim(job({ attempts: 2 })).action).toBe("claim");
    expect(decideClaim(job({ attempts: 3 })).action).toBe("fail_exhausted");
  });
});

describe("cuando un job falla", () => {
  const STALE = 5 * 60 * 1000;

  it("la espera crece: 10 s el primero, 20 s el segundo", () => {
    expect(retryDelayMs(0)).toBe(10_000);
    expect(retryDelayMs(1)).toBe(20_000);
  });

  it("un error comun se reintenta con esa espera", () => {
    expect(decideFailure({ attempts: 0 }, "error", STALE)).toEqual({
      action: "retry",
      delayMs: 10_000,
    });
  });

  it("en el ultimo intento ya no se reintenta", () => {
    expect(decideFailure({ attempts: MAX_ATTEMPTS - 1 }, "error", STALE)).toEqual({ action: "fail" });
  });

  it("una cancelacion termina el job aunque queden intentos", () => {
    expect(decideFailure({ attempts: 0 }, "cancel", STALE)).toEqual({ action: "fail" });
  });

  it("una revision NO gasta intento: se vuelve a preguntar mas tarde", () => {
    // Gastarle un intento terminaria cancelando una sesion que estaba bien.
    expect(decideFailure({ attempts: 2 }, "recheck", STALE)).toEqual({
      action: "requeue",
      delayMs: STALE,
      keepAttempts: true,
    });
  });
});
