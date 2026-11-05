import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { countActiveFlowRunFilters, deriveRunState, formatRunDate, formatRunDuration, parseFlowRunFilters, runEndReasonLabel, runSourceLabel, runStepReasonLabel, runStepStatusLabel } from "./runs";
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
    expect(runSourceLabel("form")).toBe("Formulario");
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

  it("cada columna que lee la pantalla tiene su permiso en la migracion", () => {
    const query = readFileSync(path.join(process.cwd(), "lib/flows/runs-query.ts"), "utf8");
    const migration = readFileSync(path.join(process.cwd(), "supabase/migrations/00292_flow_run_history.sql"), "utf8");
    const columns = /const RUN_COLUMNS =\s*"([^"]+)"/.exec(query)?.[1].split(",").map((c) => c.trim()) ?? [];
    const granted = /GRANT SELECT \(([\s\S]*?)\) ON public\.flow_sessions TO authenticated/.exec(migration)?.[1] ?? "";
    expect(columns.length).toBeGreaterThan(5);
    for (const column of columns) expect(granted, column).toMatch(new RegExp(`\\b${column}\\b`));
    expect(granted).not.toMatch(/\bvariables\b/);
  });
});

describe("la retencion", () => {
  it("el corte es a 12 meses", () => {
    expect(flowStepRetentionCutoff(new Date("2026-11-04T00:00:00Z")).toISOString()).toBe("2025-11-04T00:00:00.000Z");
  });
});
