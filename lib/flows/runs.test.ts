import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { canRetryStep, countActiveFlowRunFilters, deriveRunState, formatRunDate, formatRunDuration, parseFlowRunFilters, runEndReasonLabel, runSourceLabel, runStepReasonLabel, runStepStatusLabel } from "./runs";
import { flowStepRetentionCutoff } from "./runs-cleanup";

const base = { status: "active", waiting_for_input: false, waiting_until: null, error_message: null, has_failed_step: false };

describe("deriveRunState", () => {
  it.each([
    [{ ...base }, "en_curso"],
    [{ ...base, waiting_for_input: true }, "esperando"],
    [{ ...base, waiting_until: "2026-11-05T10:00:00Z" }, "esperando"],
    [{ ...base, status: "completed" }, "termino"],
    [{ ...base, status: "completed", has_failed_step: true }, "con_fallos"],
    [{ ...base, status: "cancelled", error_message: "se rompio" }, "fallo"],
    [{ ...base, status: "cancelled", has_failed_step: true }, "fallo"],
    [{ ...base, status: "cancelled" }, "cancelada"],
    [{ ...base, status: "expired" }, "cancelada"],
  ])("%j -> %s", (input, expected) => {
    expect(deriveRunState(input)).toBe(expected);
  });
});

describe("parseFlowRunFilters", () => {
  it("toma lo que vale", () => {
    const id = "6f1a2b3c-1234-4abc-8def-0123456789ab";
    expect(parseFlowRunFilters({ estado: "fallo", fecha: "7d", q: "juana", page: "3", ejecucion: id })).toMatchObject({ estado: "fallo", fecha: "7d", q: "juana", page: 3, ejecucion: id });
  });

  it("un valor inventado se ignora en vez de romper la consulta", () => {
    expect(parseFlowRunFilters({ estado: "cualquiera", fecha: "ayer", page: "-1", ejecucion: "1 or 1=1", desde: "mañana" })).toMatchObject({ estado: "", fecha: "", page: 1, ejecucion: null, desde: "" });
  });

  it("la busqueda se limpia: no puede inyectar un filtro", () => {
    expect(parseFlowRunFilters({ q: "a),b(c*%" }).q).not.toMatch(/[(),*%]/);
  });

  it("la ejecucion abierta y la pagina no cuentan como filtros", () => {
    const id = "6f1a2b3c-1234-4abc-8def-0123456789ab";
    expect(countActiveFlowRunFilters(parseFlowRunFilters({ page: "2", ejecucion: id }))).toBe(0);
    expect(countActiveFlowRunFilters(parseFlowRunFilters({ estado: "fallo", q: "x" }))).toBe(2);
  });
});

describe("como se lee", () => {
  it("la duracion, y sin hora de fin es un guion, nunca un cero", () => {
    const start = "2026-11-04T10:00:00Z";
    expect(formatRunDuration(start, null)).toBe("—");
    expect(formatRunDuration(start, "2026-11-04T09:00:00Z")).toBe("—");
    expect(formatRunDuration(start, start)).toBe("Menos de 1 s");
    expect(formatRunDuration(start, "2026-11-04T10:00:42Z")).toBe("42 s");
    expect(formatRunDuration(start, "2026-11-04T10:05:00Z")).toBe("5 min");
    expect(formatRunDuration(start, "2026-11-04T12:30:00Z")).toBe("2 h 30 min");
    expect(formatRunDuration(start, "2026-11-06T13:00:00Z")).toBe("2 d 3 h");
  });

  it("la fecha usa la zona de quien mira", () => {
    expect(formatRunDate("2026-11-04T02:00:00Z", "America/Argentina/Buenos_Aires")).toContain("03");
    expect(formatRunDate("2026-11-04T02:00:00Z", "UTC")).toContain("04");
    expect(formatRunDate(null, "UTC")).toBe("—");
  });

  it("una espera que no es el ultimo paso ya paso", () => {
    expect(runStepStatusLabel("waiting", true)).toBe("En espera");
    expect(runStepStatusLabel("waiting", false)).toBe("Esperó");
  });

  it("un codigo se traduce y un texto queda igual", () => {
    expect(runStepReasonLabel("do_not_contact")).toContain("no contactar");
    expect(runStepReasonLabel("El canal rechazó el mensaje.")).toBe("El canal rechazó el mensaje.");
    expect(runStepReasonLabel(null)).toBeNull();
  });

  it("un origen o un motivo desconocido no inventan nada", () => {
    expect(runSourceLabel("form")).toBe("Formulario"); // @plantilla-quitar(formularios)
    expect(runSourceLabel("otra_cosa")).toBe("—");
    expect(runEndReasonLabel("otra_cosa")).toBeNull();
  });

  it("cada motivo de fin que escribe el motor tiene su texto", () => {
    const source = readFileSync(path.join(process.cwd(), "lib/flow-engine/run-log.ts"), "utf8");
    const block = /export type SessionEndReason =([\s\S]*?);/.exec(source)?.[1] ?? "";
    const reasons = [...block.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    expect(reasons.length).toBeGreaterThan(5);
    for (const reason of reasons) expect(runEndReasonLabel(reason), reason).toBeTruthy();
  });
});

describe("la pantalla nunca lee variables", () => {
  it("la consulta nombra sus columnas: un * falla por el permiso de columna", () => {
    const source = readFileSync(path.join(process.cwd(), "lib/flows/runs-query.ts"), "utf8");
    expect(source).not.toMatch(/\.select\(\s*["'`]\*/);
  });

  // @plantilla-desde(proyecto)
  it("cada columna que lee la pantalla tiene su permiso en la migracion", () => {
    const query = readFileSync(path.join(process.cwd(), "lib/flows/runs-query.ts"), "utf8");
    const migration = readFileSync(path.join(process.cwd(), "supabase/migrations/00292_flow_run_history.sql"), "utf8");
    const columns = /const RUN_COLUMNS =\s*"([^"]+)"/.exec(query)?.[1].split(",").map((c) => c.trim()) ?? [];
    const granted = /GRANT SELECT \(([\s\S]*?)\) ON public\.flow_sessions TO authenticated/.exec(migration)?.[1] ?? "";
    expect(columns.length).toBeGreaterThan(5);
    for (const column of columns) expect(granted, column).toMatch(new RegExp(`\\b${column}\\b`));
    expect(granted).not.toMatch(/\bvariables\b/);
  });
  // @plantilla-hasta(proyecto)
});

describe("la retencion", () => {
  it("el corte es a 12 meses", () => {
    expect(flowStepRetentionCutoff(new Date("2026-11-04T00:00:00Z")).toISOString()).toBe("2025-11-04T00:00:00.000Z");
  });
});

describe("el paso que fallo (metricas del lienzo)", () => {
  it("lee el paso de la URL y descarta lo que no parece un id", () => {
    expect(parseFlowRunFilters({ paso_fallido: "step-1" }).pasoFallido).toBe("step-1");
    expect(parseFlowRunFilters({ paso_fallido: "a b;drop" }).pasoFallido).toBeNull();
    expect(countActiveFlowRunFilters(parseFlowRunFilters({ paso_fallido: "step-1" }))).toBe(1);
  });
});

describe("canRetryStep", () => {
  const now = new Date("2026-11-07T12:00:00Z").getTime();
  const base = {
    stepStatus: "failed",
    errorKind: null,
    nodeType: "privateReply",
    isLastFailure: true,
    runStatus: "completed",
    runCreatedAt: "2026-11-06T17:56:44Z",
  };

  it("un fallo desconocido o pasajero se puede reintentar", () => {
    expect(canRetryStep(base, now)).toEqual({ ok: true });
    expect(canRetryStep({ ...base, errorKind: "rate_limited" }, now)).toEqual({ ok: true });
  });

  it("no se reintenta cuando otra app ya contesto el comentario (el caso del 6/11)", () => {
    const r = canRetryStep({ ...base, errorKind: "already_replied" }, now);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/otra app/);
  });

  it("una respuesta privada de hace mas de 7 dias no se reintenta; otro paso si", () => {
    expect(canRetryStep({ ...base, runCreatedAt: "2026-10-30T11:00:00Z" }, now).ok).toBe(false);
    expect(canRetryStep({ ...base, nodeType: "send_email", runCreatedAt: "2026-10-30T11:00:00Z" }, now).ok).toBe(true);
  });

  it("solo un paso fallido, el ultimo, y con la ejecucion terminada", () => {
    expect(canRetryStep({ ...base, stepStatus: "ok" }, now).ok).toBe(false);
    expect(canRetryStep({ ...base, isLastFailure: false }, now).ok).toBe(false);
    expect(canRetryStep({ ...base, runStatus: "active" }, now).ok).toBe(false);
  });
});
