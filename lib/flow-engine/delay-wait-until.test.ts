/**
 * «Esperar hasta» con la fecha en la hora del negocio, y qué pasa cuando ya pasó: se saltea el paso siguiente (el
 * recordatorio de esa fecha) y el flujo sigue con el que viene. Reloj simulado.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";

vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(async () => null) }));

import "@/lib/flow-engine/registry";
import { registerNode } from "@/lib/flow-engine/registry/registry";
import { executeFlow, resumeSession } from "./engine";
import { delayPlan } from "./nodes/delay";
import { formatLocalDateTime, parseLocalDateTime } from "./wait-until";
import { kindOfStep } from "@/lib/automations/step-catalog";

const WS = "ws-1";
const ran: string[] = [];
registerNode({ type: "zzWaitMarker", label: "Marca", needsContact: false, execute: ({ node }) => { ran.push(node.id); } });

const trigger = { id: "t", type: "trigger", data: { triggerType: "keyword" } };
const step = (id: string) => ({ id, type: "zzWaitMarker", data: { label: `Paso ${id}` } });
const wait = (id: string, waitUntilLocal: string) => ({ id, type: "delay", data: { waitUntilLocal } });
const ctx = (extra: Record<string, unknown> = {}) => ({ triggerId: "tr-1", flowId: "flow-1", channelId: "", contactId: "c-1", conversationId: "", workspaceId: WS, incomingMessage: {}, variables: {}, ...extra });

/** Un flujo en fila: cada nodo sigue al anterior. */
function chain(nodes: Array<{ id: string; type: string; data: unknown }>, timezone: string | null = "America/Costa_Rica", extraEdges: unknown[] = []) {
  const all = [trigger, ...nodes];
  const edges = all.slice(1).map((n, i) => ({ id: `e${i}`, source: all[i].id, target: n.id }));
  return memoryDb({
    flows: [{ id: "flow-1", workspace_id: WS, status: "published", nodes: all, edges: [...edges, ...extraEdges] }],
    contacts: [{ id: "c-1", workspace_id: WS }],
    workspaces: [{ id: WS, name: "N", timezone }],
    flow_sessions: [],
    analytics_events: [],
    scheduled_jobs: [],
  });
}

const skips = (db: ReturnType<typeof chain>) => db.rows("analytics_events").filter((e) => e.event_type === "node_skipped");

beforeEach(() => {
  ran.length = 0;
  vi.useFakeTimers();
  // Jueves 5/11/2026, 09:00 en Costa Rica.
  vi.setSystemTime(new Date("2026-11-05T15:00:00Z"));
});

describe("delayPlan", () => {
  const now = Date.parse("2026-11-05T15:00:00Z");

  it("la hora de pared se lee en la zona que se le pasa, no en la de la máquina", () => {
    const at = (tz: string) => {
      const plan = delayPlan({ waitUntilLocal: "2026-11-07T10:00" }, now, tz);
      return plan.kind === "wait" ? plan.at.toISOString() : plan.kind;
    };
    expect(at("America/Costa_Rica")).toBe("2026-11-07T16:00:00.000Z");
    expect(at("America/New_York")).toBe("2026-11-07T15:00:00.000Z");
    expect(at("America/Argentina/Buenos_Aires")).toBe("2026-11-07T13:00:00.000Z");
  });

  it("del otro lado de un cambio de hora usa el desfase de ESE día", () => {
    // Nueva York pasa de -4 a -5 el 1/11/2026.
    const before = delayPlan({ waitUntilLocal: "2026-10-31T10:00" }, Date.parse("2026-10-01T00:00:00Z"), "America/New_York");
    const after = delayPlan({ waitUntilLocal: "2026-11-02T10:00" }, Date.parse("2026-10-01T00:00:00Z"), "America/New_York");
    expect(before).toMatchObject({ kind: "wait" });
    expect(after).toMatchObject({ kind: "wait" });
    expect((before as { at: Date }).at.toISOString()).toBe("2026-10-31T14:00:00.000Z");
    expect((after as { at: Date }).at.toISOString()).toBe("2026-11-02T15:00:00.000Z");
  });

  it("gana sobre el ISO viejo y sobre la duración; una fecha pasada es date_passed, también en el ISO viejo", () => {
    expect(delayPlan({ waitUntilLocal: "2026-11-07T10:00", waitUntil: "2026-11-30T00:00:00Z", duration: 1, unit: "minutes" }, now, "UTC")).toMatchObject({ kind: "wait", at: new Date("2026-11-07T10:00:00Z") });
    expect(delayPlan({ waitUntilLocal: "2026-11-01T10:00" }, now, "UTC")).toEqual({ kind: "date_passed" });
    expect(delayPlan({ waitUntil: "2026-11-01T10:00:00Z" }, now)).toEqual({ kind: "date_passed" });
  });

  it("justo en la hora ya pasó: no se agenda una espera de cero", () => {
    expect(delayPlan({ waitUntilLocal: "2026-11-05T15:00" }, now, "UTC")).toEqual({ kind: "date_passed" });
  });

  it("una fecha inválida o vacía no saltea nada", () => {
    for (const waitUntilLocal of ["2026-02-31T10:00", "2026-11-07T25:00", "mañana"]) expect(delayPlan({ waitUntilLocal }, now, "UTC")).toEqual({ kind: "none" });
    expect(delayPlan({ waitUntil: "no es fecha" }, now)).toEqual({ kind: "none" });
    expect(delayPlan({ waitUntilLocal: "" }, now, "UTC")).toEqual({ kind: "none" });
  });
});

describe("parseLocalDateTime y formatLocalDateTime", () => {
  it("separa una fecha real y rechaza el resto", () => {
    expect(parseLocalDateTime("2026-11-07T10:30")).toEqual({ date: "2026-11-07", time: "10:30" });
    expect(parseLocalDateTime("2026-11-07")).toBeNull();
    expect(parseLocalDateTime("2026-11-31T10:30")).toBeNull();
  });

  it("muestra la hora escrita, sin pasarla por ninguna zona", () => {
    expect(formatLocalDateTime("2026-11-07T10:00")).toMatch(/7 nov.* 2026.*10:00/);
    expect(formatLocalDateTime("nada")).toBeNull();
  });
});

describe("«Esperar hasta» en el motor", () => {
  it("fecha futura: agenda con la zona del negocio y el paso siguiente corre al despertar", async () => {
    const db = chain([step("a"), wait("w", "2026-11-07T10:00"), step("b")]);
    await executeFlow(db.client, ctx() as never);
    expect(ran).toEqual(["a"]);
    expect(db.rows("scheduled_jobs")[0]).toMatchObject({ type: "resume_flow", run_at: "2026-11-07T16:00:00.000Z" });
    expect(skips(db)).toEqual([]);

    await resumeSession(db.client, db.rows("flow_sessions")[0] as never, ctx({ triggerId: "" }) as never);
    expect(ran).toEqual(["a", "b"]);
  });

  it("usa workspaces.timezone: otra zona, otra hora", async () => {
    const db = chain([wait("w", "2026-11-07T10:00"), step("b")], "America/New_York");
    await executeFlow(db.client, ctx() as never);
    expect(db.rows("scheduled_jobs")[0].run_at).toBe("2026-11-07T15:00:00.000Z");
  });

  it("sin zona guardada o con una inválida usa UTC, no lanza", async () => {
    for (const tz of [null, "Marte/Olympus"]) {
      const db = chain([wait("w", "2026-11-07T10:00"), step("b")], tz);
      await executeFlow(db.client, ctx() as never);
      expect(db.rows("scheduled_jobs")[0].run_at).toBe("2026-11-07T10:00:00.000Z");
    }
  });

  it("fecha pasada: saltea el paso siguiente, lo anota con date_passed y sigue", async () => {
    const db = chain([step("a"), wait("w", "2026-11-04T10:00"), step("b"), step("c")]);
    const skipped: string[] = [];
    await executeFlow(db.client, ctx({ onStepSkipped: (s: { label: string }) => skipped.push(s.label) }) as never);
    expect(ran).toEqual(["a", "c"]);
    expect(db.rows("scheduled_jobs")).toEqual([]);
    expect(skips(db)).toHaveLength(1);
    expect(skips(db)[0]).toMatchObject({ contact_id: "c-1", metadata: { nodeId: "b", reason: "date_passed", waitNodeId: "w" } });
    expect(skipped).toEqual(["Paso b"]);
    expect(db.rows("flow_sessions")[0].status).toBe("completed");
  });

  it("dos fechas pasadas seguidas: saltea las dos y queda esperando la que viene", async () => {
    const db = chain([step("conf"), wait("w1", "2026-11-04T10:00"), step("r1"), wait("w2", "2026-11-05T08:00"), step("r2"), wait("w3", "2026-11-07T10:00"), step("r3")]);
    await executeFlow(db.client, ctx() as never);
    expect(ran).toEqual(["conf"]);
    expect(skips(db).map((e) => (e.metadata as { nodeId: string }).nodeId)).toEqual(["r1", "r2"]);
    expect(db.rows("scheduled_jobs")).toHaveLength(1);
    expect(db.rows("scheduled_jobs")[0].run_at).toBe("2026-11-07T16:00:00.000Z");

    await resumeSession(db.client, db.rows("flow_sessions")[0] as never, ctx({ triggerId: "" }) as never);
    expect(ran).toEqual(["conf", "r3"]);
  });

  it("la fecha pasada es el último recordatorio: el flujo termina", async () => {
    const db = chain([step("a"), wait("w", "2026-11-04T10:00"), step("b")]);
    await executeFlow(db.client, ctx() as never);
    expect(ran).toEqual(["a"]);
    expect(db.rows("flow_sessions")[0].status).toBe("completed");
  });

  it("sin paso siguiente: termina sin anotar nada", async () => {
    const db = chain([wait("w", "2026-11-04T10:00")]);
    await executeFlow(db.client, ctx() as never);
    expect(skips(db)).toEqual([]);
    expect(db.rows("flow_sessions")[0].status).toBe("completed");
  });

  it("el paso siguiente reparte en dos caminos: corre normal, no se elige uno al azar", async () => {
    const db = chain([wait("w", "2026-11-04T10:00"), step("decide"), step("x")], "UTC", [{ id: "extra", source: "decide", target: "y", sourceHandle: "other" }]);
    await executeFlow(db.client, ctx() as never);
    expect(ran).toEqual(["decide", "x"]);
    expect(skips(db)).toEqual([]);
  });

  it("un flujo sin contacto también saltea, sin romper", async () => {
    const db = chain([step("a"), wait("w", "2026-11-04T10:00"), step("b"), step("c")]);
    await executeFlow(db.client, ctx({ contactId: null, memberUserId: "u-1" }) as never);
    expect(ran).toEqual(["a", "c"]);
    expect(skips(db)[0].contact_id).toBeNull();
  });

  it("una fecha inválida sigue de largo sin saltear", async () => {
    const db = chain([wait("w", "2026-02-31T10:00"), step("b")]);
    await executeFlow(db.client, ctx() as never);
    expect(ran).toEqual(["b"]);
    expect(skips(db)).toEqual([]);
  });
});

describe("el editor de pasos no pisa una espera por fecha", () => {
  it("solo reconoce como suya la espera por duración", () => {
    const of = (data: Record<string, unknown>) => kindOfStep({ nodeType: "delay", data } as never, "forms")?.key;
    expect(of({ duration: 1, unit: "hours" })).toBe("delay");
    expect(of({ waitUntilLocal: "2026-11-07T10:00" })).toBeUndefined();
    expect(of({ waitUntil: "2026-11-07T16:00:00Z" })).toBeUndefined();
  });
});
