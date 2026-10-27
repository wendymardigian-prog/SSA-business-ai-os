/**
 * Republicar no duplica disparadores (auditoria de automatizaciones, oct 2026).
 *
 * Antes publicar solo borraba las filas de los disparadores de mensaje y de Ventas: un flujo de agenda, formulario,
 * CRM, tareas o webhook sumaba UNA FILA MAS por cada publicacion, y corria una vez por cada fila.
 */
import { describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { publishFlow, unpublishFlow } from "./publish";

const WS = "ws-1";

function world(triggerData: Record<string, unknown>, extraTriggers: Record<string, unknown>[] = []) {
  return memoryDb({
    flows: [
      {
        id: "flow-1",
        workspace_id: WS,
        name: "F",
        status: "draft",
        version: 0,
        nodes: [
          { id: "t", type: "trigger", data: triggerData },
          { id: "n", type: "action", data: { actionType: "addTag", tagName: "x" } },
        ],
        edges: [{ id: "e", source: "t", target: "n" }],
        viewport: null,
      },
    ],
    flow_versions: [],
    triggers: extraTriggers,
    integration_configs: [],
    channels: [],
  });
}

async function publish(db: ReturnType<typeof memoryDb>) {
  return publishFlow({ db: db.client, userId: "u-1", workspaceId: WS, flowId: "flow-1", getServiceClient: async () => db.client });
}

describe("publicar reconcilia todas las filas que arma el editor", () => {
  it.each([
    ["crm_event", { triggerType: "crm_event", event: "tag_added", value: "vip" }],
    ["new_contact", { triggerType: "new_contact" }],
    ["booking_created", { triggerType: "booking_created" }],
    ["task_completed", { triggerType: "task_completed" }], // @plantilla-quitar(tareas)
  ])("%s: tres publicaciones dejan UNA fila", async (_type, data) => {
    const db = world(data);
    for (let i = 0; i < 3; i++) {
      const result = await publish(db);
      expect(result.ok).toBe(true);
    }
    expect(db.rows("triggers").filter((t) => t.flow_id === "flow-1")).toHaveLength(1);
  });

  it("despublicar saca las filas de cualquier tipo del editor", async () => {
    const db = world({ triggerType: "new_contact" });
    await publish(db);
    expect(await unpublishFlow(db.client, WS, "flow-1")).toBe(true);
    expect(db.rows("triggers")).toHaveLength(0);
  });

  it("una fila con canal (pestaña Growth) apagada a mano sigue apagada despues de publicar", async () => {
    const db = world({ triggerType: "keyword", keywords: [{ value: "hola", matchType: "contains" }] }, [
      { id: "growth-1", flow_id: "flow-1", channel_id: "ch-1", type: "comment_keyword", config: {}, is_active: false, priority: 0 },
    ]);
    await publish(db);
    const growth = db.rows("triggers").find((t) => t.id === "growth-1");
    expect(growth).toMatchObject({ is_active: false });
  });
});
