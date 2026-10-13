import { describe, it, expect } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { notifyRecipients, notifyTeamNode } from "./notify-team";
import type { FlowExecutionContext } from "../types";

const WS = "ws-1";
const ctx = (over: Partial<FlowExecutionContext> = {}): FlowExecutionContext => ({
  triggerId: "t",
  flowId: "flow-1",
  channelId: "",
  contactId: null,
  memberUserId: "u-ana",
  conversationId: "",
  workspaceId: WS,
  incomingMessage: {},
  variables: { member: { name: "Ana" }, metrics: { total: { links_enviados: "4" } }, report: { id: "r-1", form_id: "f-1" } },
  ...over,
});

function world() {
  return memoryDb({
    workspace_members: [
      { workspace_id: WS, user_id: "u-ana" },
      { workspace_id: WS, user_id: "u-lider" },
    ],
    notifications: [],
  });
}

const run = (db: ReturnType<typeof world>, data: Parameters<typeof notifyRecipients>[0], context = ctx()) =>
  notifyTeamNode.execute({ supabase: db.client, node: { id: "n1", type: "action", position: { x: 0, y: 0 }, data: {} } as never, data, context, sessionId: "s", runtime: { executeFlow: async () => {} } } as never);

describe("Avisar en la campana", () => {
  it("no necesita contacto", () => {
    expect(notifyTeamNode.needsContact).toBe(false);
  });

  it("a quien envió el reporte y a quien eligió, con variables, sin repetir", async () => {
    const db = world();
    await run(db, { to: "both", userIds: ["u-lider", "u-ana"], title: "{{member.name}} mandó {{metrics.total.links_enviados}} links", body: "Revisalo" });
    const rows = db.rows("notifications");
    expect(rows.map((r) => r.recipient_id).sort()).toEqual(["u-ana", "u-lider"]);
    expect(rows[0]).toMatchObject({ type: "flow_notice", title: "Ana mandó 4 links", entity_type: "eod_report", entity_id: "r-1" });
  });

  it("alguien que no es del workspace no recibe nada", async () => {
    const db = world();
    await run(db, { to: "users", userIds: ["u-de-otro-lado"], title: "Hola" });
    expect(db.rows("notifications")).toHaveLength(0);
  });

  it("sin título no avisa; sin reporte apunta al flujo", async () => {
    const db = world();
    await run(db, { to: "reporter", title: "  " });
    expect(db.rows("notifications")).toHaveLength(0);
    await run(db, { to: "reporter", title: "Hola" }, ctx({ variables: {} }));
    expect(db.rows("notifications")[0]).toMatchObject({ entity_type: "flow", entity_id: "flow-1", recipient_id: "u-ana" });
  });

  it("notifyRecipients", () => {
    expect(notifyRecipients({ to: "reporter" }, null)).toEqual([]);
    expect(notifyRecipients({ userIds: ["a"] }, "b")).toEqual(["a"]);
  });
});
