/**
 * El historial de ejecuciones (00290) contra el motor de verdad: que queda anotado en cada caso, y que anotar no cambia
 * lo que hace el flujo.
 */
import { describe, expect, it, vi } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { executeFlow, resumeSession } from "./engine";
import { registerNode } from "./registry";

const WS = "ws-1";

function trigger(next: string) {
  return {
    node: { id: "n-trigger", type: "trigger", data: { triggerType: "keyword" } },
    edge: { id: "e0", source: "n-trigger", target: next },
  };
}

function setup(nodes: unknown[], edges: unknown[], extra: Record<string, unknown[]> = {}) {
  return memoryDb({
    flows: [{ id: "flow-1", workspace_id: WS, status: "published", version: 7, nodes, edges }],
    channels: [],
    conversations: [],
    contacts: [{ id: "c-1", workspace_id: WS }],
    workspaces: [{ id: WS, name: "Negocio", timezone: "UTC" }],
    flow_sessions: [],
    flow_session_steps: [],
    analytics_events: [],
    scheduled_jobs: [],
    ...extra,
  });
}

const context = () => ({
  triggerId: "tr-1",
  flowId: "flow-1",
  channelId: "",
  contactId: "c-1",
  conversationId: "",
  workspaceId: WS,
  incomingMessage: { text: "" },
  variables: {} as Record<string, unknown>,
});

describe("cada paso queda anotado", () => {
  it("un paso que sale bien, con el nombre congelado y la version del flujo", async () => {
    await import("./registry");
    const t = trigger("n-delay");
    const db = setup(
      [t.node, { id: "n-delay", type: "delay", data: { label: "Un rato", duration: 5, unit: "minutes" } }],
      [t.edge],
    );
    await executeFlow(db.client, context());

    const [session] = db.rows("flow_sessions");
    expect(session.flow_version).toBe(7);
    const steps = db.rows("flow_session_steps");
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ node_id: "n-delay", node_label: "Esperar · Un rato", status: "waiting", flow_id: "flow-1", session_id: session.id });
    expect(steps[0].resumes_at).toBeTruthy();
  });

  it("una condicion anota por donde siguio", async () => {
    await import("./registry");
    const t = trigger("n-branch");
    const db = setup(
      [
        t.node,
        {
          id: "n-branch",
          type: "branch",
          data: { paths: [{ id: "p_uno", label: "Camino uno", conditions: [{ id: "c1", field: "message", operator: "contains", value: "zzz" }] }] },
        },
      ],
      [t.edge],
    );
    await executeFlow(db.client, context());
    const [step] = db.rows("flow_session_steps");
    expect(step.exit_label).toBe("Si no");
    expect(step.status).toBe("ok");
  });

  it("un paso que necesita contacto, en un flujo sin contacto, queda salteado con el motivo", async () => {
    await import("./registry");
    const t = trigger("n-tag");
    const db = setup([t.node, { id: "n-tag", type: "action", data: { actionType: "addTag", tagId: "t-1" } }], [t.edge]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await executeFlow(db.client, { ...context(), contactId: null, memberUserId: "u-1" });
    warn.mockRestore();
    const [step] = db.rows("flow_session_steps");
    expect(step.status).toBe("skipped");
    expect(step.reason).toContain("necesita un contacto");
  });
});

describe("un paso que falla", () => {
  it("si lanza: queda failed con el motivo saneado, la sesion cancelada y el error sigue subiendo", async () => {
    await import("./registry");
    registerNode({
      type: "zz_test_lanza",
      label: "Prueba que lanza",
      needsContact: false,
      execute: async () => {
        throw new Error("el proveedor rechazo a persona@ejemplo.com");
      },
    } as never);
    const t = trigger("n-boom");
    const db = setup([t.node, { id: "n-boom", type: "zz_test_lanza", data: {} }], [t.edge]);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(executeFlow(db.client, context())).rejects.toThrow("el proveedor rechazo");
    err.mockRestore();

    const [step] = db.rows("flow_session_steps");
    expect(step.status).toBe("failed");
    expect(step.reason).toBe("el proveedor rechazo a [email]");
    const [session] = db.rows("flow_sessions");
    expect(session).toMatchObject({ status: "cancelled", end_reason: "step_failed", has_failed_step: true, error_message: "el proveedor rechazo a [email]" });
  });

  it("si avisa sin lanzar: queda failed y el flujo SIGUE con el paso de despues, como siempre", async () => {
    await import("./registry");
    registerNode({
      type: "zz_test_rechazado",
      label: "Prueba rechazada",
      needsContact: false,
      execute: async ({ context: ctx }: { context: { noteStep?: (n: unknown) => void } }) => {
        ctx.noteStep?.({ status: "failed", reason: "El canal rechazó el mensaje." });
      },
    } as never);
    const t = trigger("n-rej");
    const db = setup(
      [t.node, { id: "n-rej", type: "zz_test_rechazado", data: {} }, { id: "n-delay", type: "delay", data: { duration: 5, unit: "minutes" } }],
      [t.edge, { id: "e1", source: "n-rej", target: "n-delay" }],
    );
    await executeFlow(db.client, context());

    expect(db.rows("flow_session_steps").map((s) => [s.node_id, s.status])).toEqual([
      ["n-rej", "failed"],
      ["n-delay", "waiting"],
    ]);
    expect(db.rows("flow_sessions")[0]).toMatchObject({ status: "active", has_failed_step: true, current_node_id: "n-delay" });
  });
});

describe("anotar nunca frena un flujo", () => {
  it("si escribir el paso falla, el flujo sigue igual", async () => {
    await import("./registry");
    const t = trigger("n-delay");
    const db = setup([t.node, { id: "n-delay", type: "delay", data: { duration: 5, unit: "minutes" } }], [t.edge]);
    const realFrom = db.client.from.bind(db.client);
    const client = {
      ...db.client,
      from: (table: string) => {
        if (table === "flow_session_steps") throw new Error("la tabla no existe");
        return realFrom(table as never);
      },
    };
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await executeFlow(client as never, context());
    err.mockRestore();
    expect(db.rows("flow_sessions")[0]).toMatchObject({ status: "active", current_node_id: "n-delay" });
    expect(db.rows("scheduled_jobs")).toHaveLength(1);
  });
});

describe("al retomar", () => {
  it("una automatizacion despublicada cancela la espera y anota por que", async () => {
    await import("./registry");
    const db = setup([], [], {
      flow_sessions: [{ id: "s-1", flow_id: "flow-1", contact_id: "c-1", channel_id: null, status: "active", current_node_id: "n", variables: {}, waiting_for_input: false, end_reason: null }],
    });
    (db.rows("flows")[0] as { status: string }).status = "draft";
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await resumeSession(db.client, db.rows("flow_sessions")[0] as never, context());
    err.mockRestore();
    expect(db.rows("flow_sessions")[0]).toMatchObject({ status: "cancelled", end_reason: "flow_unpublished" });
  });
});
