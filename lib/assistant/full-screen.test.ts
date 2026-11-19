import { describe, expect, it } from "vitest";
import { ASSISTANT_STALL_MS, canResume, cleanPlan, parseAssistantResult, turnPhase, type ProposalState } from "./steps";
import { createSseReader, encodeSse, type SseMessage } from "./sse";

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const write = (id: string) => ({ tool: "crear_tarea", label: "Crear una tarea", access: "write" as const, ok: true, message: "Queda propuesto", proposal_id: id });
const read = { tool: "ver_tareas", label: "Ver tareas", access: "read" as const, ok: true, message: "2 tareas" };
const prop = (id: string, status: string): ProposalState => ({ id, status, label: "Crear una tarea", reject_reason: null, reject_note: null });
const NOW = new Date("2026-11-15T10:00:00Z");

describe("asistente a pantalla completa: plan, estado y reanudar", () => {
  it("el plan se limpia: sin vacíos, una línea, recortado y como mucho 8 pasos", () => {
    expect(cleanPlan(["  Ver tus tareas ", "", 3, "Proponer\nla tarea"])).toEqual(["Ver tus tareas", "Proponer la tarea"]);
    expect(cleanPlan(Array.from({ length: 12 }, (_, i) => `paso ${i}`))).toHaveLength(8);
    expect(cleanPlan(["x".repeat(300)])[0]).toHaveLength(200);
    expect(cleanPlan("no es lista")).toEqual([]);
  });

  it("el resultado guardado admite plan, estado y latido; lo viejo (sin estado) sigue valiendo", () => {
    const r = parseAssistantResult({ steps: [read], plan: ["Ver tareas"], status: "waiting", heartbeat_at: NOW.toISOString() });
    expect(r.plan).toEqual(["Ver tareas"]);
    expect(r.status).toBe("waiting");
    expect(parseAssistantResult({ steps: [read], status: "otro" }).steps).toEqual([]);
    expect(turnPhase(parseAssistantResult({ steps: [read] }), NOW)).toBe("done");
    expect(turnPhase({ error: "falló" }, NOW)).toBe("failed");
  });

  it("una respuesta «trabajando» sin moverse más de 3 minutos se cortó", () => {
    const fresh = new Date(NOW.getTime() - 10_000).toISOString();
    const old = new Date(NOW.getTime() - ASSISTANT_STALL_MS - 1).toISOString();
    expect(turnPhase({ status: "running", heartbeat_at: fresh }, NOW)).toBe("running");
    expect(turnPhase({ status: "running", heartbeat_at: old }, NOW)).toBe("stalled");
    expect(turnPhase({ status: "running" }, NOW)).toBe("stalled");
  });

  it("se reanuda cuando lo propuesto ya se decidió (aunque sea horas después) o si se cortó; nunca con algo pendiente", () => {
    const steps = [read, write(P1)];
    expect(canResume("waiting", steps, new Map([[P1, prop(P1, "pending")]]))).toBe(false);
    expect(canResume("waiting", steps, new Map())).toBe(false);
    expect(canResume("waiting", steps, new Map([[P1, prop(P1, "approved")]]))).toBe(true);
    expect(canResume("waiting", steps, new Map([[P1, prop(P1, "rejected")]]))).toBe(true);
    expect(canResume("waiting", [write(P1), write(P2)], new Map([[P1, prop(P1, "approved")], [P2, prop(P2, "pending")]]))).toBe(false);
    expect(canResume("stalled", steps, new Map())).toBe(true);
    expect(canResume("running", steps, new Map())).toBe(false);
    expect(canResume("done", steps, new Map([[P1, prop(P1, "approved")]]))).toBe(false);
  });
});

describe("eventos del servidor al navegador", () => {
  it("un evento va en una línea de datos y se vuelve a leer igual, aunque llegue cortado en trozos", () => {
    const got: SseMessage[] = [];
    const reader = createSseReader((m) => got.push(m));
    const wire = encodeSse("step", { step: { label: "Ver\ntareas" } }) + encodeSse("end", { ok: true });
    expect(wire.split("\n\n").filter(Boolean)).toHaveLength(2);
    for (let i = 0; i < wire.length; i += 7) reader.push(wire.slice(i, i + 7));
    reader.end();
    expect(got).toEqual([
      { event: "step", data: { step: { label: "Ver\ntareas" } } },
      { event: "end", data: { ok: true } },
    ]);
  });

  it("lo que no es JSON se ignora y el nombre del evento no puede romper el formato", () => {
    const got: SseMessage[] = [];
    const reader = createSseReader((m) => got.push(m));
    reader.push("event: step\ndata: {roto\n\n");
    reader.push(encodeSse("pl\nan", [1]));
    reader.end();
    expect(got).toEqual([{ event: "plan", data: [1] }]);
  });
});
