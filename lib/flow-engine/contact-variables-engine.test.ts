/**
 * El motor siembra los datos del contacto al ARRANCAR y los vuelve a leer al RETOMAR después de una espera: si durante
 * la espera cambió el vendedor, el estado o el nombre, los pasos que siguen usan el dato de ahora (24/11/2026).
 */
import { describe, expect, it, vi } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { executeFlow, resumeSession } from "./engine";

vi.mock("@/lib/workspace-members", () => ({
  getWorkspaceMembers: async () => [
    { userId: "u-1", name: "Laura" },
    { userId: "u-2", name: "Pablo" },
  ],
}));

const WS = "ws-1";

describe("variables del contacto en el motor", () => {
  it("al arrancar trae el vendedor; al retomar, los de ahora", async () => {
    await import("./registry");
    const db = memoryDb({
      flows: [
        {
          id: "flow-1",
          workspace_id: WS,
          status: "published",
          nodes: [
            { id: "n-trigger", type: "trigger", data: { triggerType: "keyword" } },
            { id: "n-delay", type: "delay", data: { duration: 5, unit: "minutes" } },
            { id: "n-delay2", type: "delay", data: { duration: 1, unit: "hours" } },
          ],
          edges: [
            { id: "e1", source: "n-trigger", target: "n-delay" },
            { id: "e2", source: "n-delay", target: "n-delay2" },
          ],
        },
      ],
      channels: [{ id: "ch-1", platform: "whatsapp", late_account_id: null }],
      conversations: [],
      contacts: [{ id: "c-1", workspace_id: WS, display_name: "Ana Pérez", email: "ana@x.com", phone: null, vendedor_id: "u-1" }],
      workspaces: [{ id: WS, name: "Mi negocio", contact_status_settings: {}, qualification_settings: {} }],
      flow_sessions: [],
      analytics_events: [],
      scheduled_jobs: [],
    });

    await executeFlow(db.client, { triggerId: "tr-1", flowId: "flow-1", channelId: "ch-1", contactId: "c-1", conversationId: "", workspaceId: WS, incomingMessage: { text: "hola" }, variables: {} });
    const started = db.rows("flow_sessions")[0];
    const startVars = started.variables as { contact: Record<string, unknown>; workspace: Record<string, unknown> };
    expect(startVars.contact).toMatchObject({ first_name: "Ana", vendedor_name: "Laura" });
    expect(startVars.workspace).toMatchObject({ name: "Mi negocio" });

    // Durante la espera cambian el vendedor y el nombre.
    const contact = db.rows("contacts")[0];
    contact.vendedor_id = "u-2";
    contact.display_name = "Ana María Pérez";

    const job = db.rows("scheduled_jobs").find((j) => j.type === "resume_flow")!;
    const payload = job.payload as Record<string, unknown>;
    await resumeSession(db.client, started as never, {
      triggerId: "",
      flowId: "flow-1",
      channelId: "ch-1",
      contactId: "c-1",
      conversationId: "",
      workspaceId: WS,
      variables: (payload.variables as Record<string, string>) || undefined,
      incomingMessage: {},
    });

    // El segundo «Esperar» guarda las variables de ese momento en su job.
    const second = db.rows("scheduled_jobs").filter((j) => j.type === "resume_flow")[1];
    const resumed = (second.payload as { variables: { contact: Record<string, unknown> } }).variables;
    expect(resumed.contact).toMatchObject({ vendedor_name: "Pablo", display_name: "Ana María Pérez" });
  });
});
