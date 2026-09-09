import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { FlowExecutionContext } from "../types";
import { goToFlowNode } from "./go-to-flow";

const context = {
  workspaceId: "ws-1",
  contactId: "con-1",
  channelId: "chn-1",
  conversationId: "conv-1",
  flowId: "flow-padre",
} as unknown as FlowExecutionContext;

function fakeClient() {
  const updates: Array<{ table: string; patch: Record<string, unknown>; filtros: Record<string, string> }> = [];

  const client = {
    from(table: string) {
      return {
        update(patch: Record<string, unknown>) {
          const filtros: Record<string, string> = {};
          const chain = {
            eq(col: string, value: string) {
              filtros[col] = value;
              // El segundo .eq() cierra la cadena y ejecuta.
              if (Object.keys(filtros).length === 2) {
                updates.push({ table, patch, filtros });
                return Promise.resolve({ error: null });
              }
              return chain;
            },
          };
          return chain;
        },
      };
    },
  } as unknown as SupabaseClient<Database>;

  return { client, updates };
}

function run(client: SupabaseClient<Database>, flowId: string, executeFlow = vi.fn()) {
  return {
    executeFlow,
    result: goToFlowNode.execute({
      supabase: client,
      node: { id: "n-1" } as never,
      data: { flowId, returnAfter: false },
      context,
      sessionId: "sesion-padre",
      runtime: { executeFlow },
    }),
  };
}

describe("nodo Ir a otro flow", () => {
  it("cierra la sesion del flow original antes de saltar", async () => {
    // La fuga que esto arregla: el nodo arrancaba el flow destino y devolvia
    // "pause", que corta el recorrido del padre sin cerrar su sesion. Esa
    // sesion quedaba activa para siempre — no la despierta el cron (no hay job)
    // ni un mensaje entrante (el motor solo retoma las que esperan input).
    const { client, updates } = fakeClient();
    const executeFlow = vi.fn();

    await run(client, "flow-destino", executeFlow).result;

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      table: "flow_sessions",
      patch: { status: "completed" },
      filtros: { id: "sesion-padre", status: "active" },
    });
  });

  it("solo cierra si la sesion sigue activa: no pisa una cancelacion en curso", async () => {
    const { client, updates } = fakeClient();
    await run(client, "flow-destino").result;
    expect(updates[0].filtros.status).toBe("active");
  });

  it("arranca el flow destino y pausa el recorrido del original", async () => {
    const { client } = fakeClient();
    const executeFlow = vi.fn();

    const result = await run(client, "flow-destino", executeFlow).result;

    expect(executeFlow).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ flowId: "flow-destino", contactId: "con-1" })
    );
    expect(result).toBe("pause");
  });

  it("sin flow destino no cierra la sesion ni salta a ningun lado", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client, updates } = fakeClient();
    const executeFlow = vi.fn();

    await run(client, "", executeFlow).result;

    expect(updates).toHaveLength(0);
    expect(executeFlow).not.toHaveBeenCalled();
  });
});
