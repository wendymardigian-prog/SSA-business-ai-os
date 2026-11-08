/**
 * Publicar una automatización «En una fecha y hora»: agenda la próxima vez de la versión publicada (una sola pendiente
 * aunque se publique tres veces), no deja publicar una sola vez que ya pasó, y no acepta pasos que necesitan contacto.
 */
import { describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { publishFlow } from "@/lib/flow-engine/publish";
import { SCHEDULE_PAST_PROBLEM, SCHEDULED_RUN_JOB } from "./schedule";

const WS = "ws-1";

function world(triggerData: Record<string, unknown>, step: Record<string, unknown> = { id: "n", type: "delay", data: { duration: 5, unit: "minutes" } }) {
  return memoryDb({
    flows: [
      {
        id: "flow-1",
        workspace_id: WS,
        name: "Encuesta de los lunes",
        status: "draft",
        version: 0,
        nodes: [{ id: "t", type: "trigger", data: { triggerType: "scheduled_time", ...triggerData } }, step],
        edges: [{ id: "e", source: "t", target: "n" }],
        viewport: null,
      },
    ],
    workspaces: [{ id: WS, timezone: "America/Argentina/Buenos_Aires" }],
    flow_versions: [],
    triggers: [],
    scheduled_jobs: [],
    integration_configs: [],
    channels: [],
  });
}

const publish = (db: ReturnType<typeof memoryDb>) =>
  publishFlow({ db: db.client, userId: "u-1", workspaceId: WS, flowId: "flow-1", getServiceClient: async () => db.client });

describe("publicar «En una fecha y hora»", () => {
  it("agenda la próxima vez; republicar deja una sola pendiente, de la última versión", async () => {
    const db = world({ repeat: "daily", time: "09:00" });
    for (let i = 0; i < 3; i++) expect((await publish(db)).ok).toBe(true);

    const rows = db.rows("triggers").filter((t) => t.flow_id === "flow-1");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: "scheduled_time", config: { repeat: "daily", time: "09:00" } });

    const pending = db.rows("scheduled_jobs").filter((j) => j.type === SCHEDULED_RUN_JOB && j.status === "pending");
    expect(pending).toHaveLength(1);
    expect(pending[0].payload).toMatchObject({ flowId: "flow-1", version: 3 });
    expect(new Date(String(pending[0].run_at)).getTime()).toBeGreaterThan(Date.now());
  });

  it("una sola vez que ya pasó no se publica", async () => {
    const db = world({ repeat: "once", date: "2020-01-01", time: "09:00" });
    const result = await publish(db);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems).toContain(SCHEDULE_PAST_PROBLEM);
    expect(db.rows("scheduled_jobs")).toHaveLength(0);
  });

  it("no acepta pasos que necesitan un contacto", async () => {
    const db = world({ repeat: "daily", time: "09:00" }, { id: "n", type: "action", data: { actionType: "addTag", tagName: "x" } });
    const result = await publish(db);
    expect(result.ok).toBe(false);
    expect(db.rows("scheduled_jobs")).toHaveLength(0);
  });

  it("dejar de ser programada anula la vez pendiente", async () => {
    const db = world({ repeat: "daily", time: "09:00" });
    await publish(db);
    const flow = db.rows("flows")[0];
    flow.status = "published";
    flow.draft_nodes = [
      { id: "t", type: "trigger", data: { triggerType: "new_contact" } },
      { id: "n", type: "delay", data: { duration: 5, unit: "minutes" } },
    ];
    flow.draft_edges = [{ id: "e", source: "t", target: "n" }];
    expect((await publish(db)).ok).toBe(true);
    expect(db.rows("scheduled_jobs").filter((j) => j.status === "pending")).toHaveLength(0);
  });
});
