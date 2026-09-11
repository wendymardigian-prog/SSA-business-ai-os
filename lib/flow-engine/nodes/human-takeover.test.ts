import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { FlowExecutionContext } from "../types";

vi.mock("@/lib/notifications/create", () => ({
  createNotification: vi.fn().mockResolvedValue(true),
}));

import { createNotification } from "@/lib/notifications/create";
import { humanTakeoverNode } from "./human-takeover";

interface World {
  assignedTo?: string | null;
  contact?: { display_name: string | null; instagram_username: string | null } | null;
  failLookups?: boolean;
}

function fakeClient(world: World = {}) {
  const updates: Array<{ table: string; values: Record<string, unknown> }> = [];

  const from = (table: string) => {
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      update: (values: Record<string, unknown>) => {
        updates.push({ table, values });
        return builder;
      },
      maybeSingle: async () => {
        if (world.failLookups) throw new Error("boom");
        if (table === "conversations") {
          return { data: { assigned_to: world.assignedTo ?? null }, error: null };
        }
        return { data: world.contact ?? null, error: null };
      },
      then: (resolve: (v: unknown) => unknown) => resolve({ error: null }),
    };
    return builder;
  };

  return { client: { from } as unknown as SupabaseClient<Database>, updates };
}

const context = {
  workspaceId: "ws-1",
  conversationId: "conv-1",
  contactId: "contact-1",
  channelId: "chan-1",
  flowId: "flow-1",
  triggerId: "trig-1",
  incomingMessage: "hola",
} as unknown as FlowExecutionContext;

async function run(client: SupabaseClient<Database>) {
  return humanTakeoverNode.execute({
    supabase: client,
    node: { id: "n1", type: "action", position: { x: 0, y: 0 }, data: {} },
    data: {},
    context,
    sessionId: "sess-1",
    runtime: { executeFlow: vi.fn() },
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("nodo Human Takeover (F18)", () => {
  it("pausa la conversacion, cierra la sesion y corta el recorrido", async () => {
    const { client, updates } = fakeClient();

    const result = await run(client);

    expect(result).toBe("pause");
    expect(updates.find((u) => u.table === "conversations")?.values).toMatchObject({
      is_automation_paused: true,
    });
    const session = updates.find((u) => u.table === "flow_sessions")?.values;
    expect(session?.status).toBe("completed");
    expect(session?.human_takeover_at).toBeTruthy();
  });

  it("avisa al centro de notificaciones, apuntando a la conversacion", async () => {
    const { client } = fakeClient({
      contact: { display_name: "Maria Lopez", instagram_username: "mlopez" },
    });

    await run(client);

    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "human_takeover",
        entityType: "conversation",
        entityId: "conv-1",
        title: expect.stringContaining("Maria Lopez"),
      }),
    );
  });

  it("le avisa al agente asignado cuando lo hay", async () => {
    const { client } = fakeClient({ assignedTo: "user-9", contact: null });

    await run(client);

    expect(vi.mocked(createNotification).mock.calls[0][0].recipientId).toBe("user-9");
  });

  it("sin agente asignado, el aviso queda para los admins", async () => {
    const { client } = fakeClient({ assignedTo: null, contact: null });

    await run(client);

    expect(vi.mocked(createNotification).mock.calls[0][0].recipientId).toBeNull();
  });

  it("sin nombre usa el usuario, y sin ninguno de los dos no queda vacio", async () => {
    const sinNombre = fakeClient({
      contact: { display_name: null, instagram_username: "mlopez" },
    });
    await run(sinNombre.client);
    expect(String(vi.mocked(createNotification).mock.calls[0][0].title)).toContain("@mlopez");

    vi.clearAllMocks();

    const anonimo = fakeClient({ contact: null });
    await run(anonimo.client);
    expect(String(vi.mocked(createNotification).mock.calls[0][0].title)).toContain("Un contacto");
  });

  /**
   * La garantia que importa: si el aviso falla, la conversacion igual queda
   * derivada. Derivar sin avisar es malo; no derivar porque el aviso fallo, peor.
   */
  it("si el aviso falla, la derivacion se hace igual", async () => {
    const { client, updates } = fakeClient({ failLookups: true });

    const result = await run(client);

    expect(result).toBe("pause");
    expect(updates.find((u) => u.table === "conversations")?.values).toMatchObject({
      is_automation_paused: true,
    });
  });
});
