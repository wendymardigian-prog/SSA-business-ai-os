import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { agentBurstTiming, scheduleBroadcastDelivery } from "./scheduler";

/**
 * Cliente falso que registra en que tabla se escribio.
 *
 * Lo que se afirma acá es de quien es cada escritura: scheduled_jobs quedo
 * cerrada a service role en la migracion 00046, asi que si alguien vuelve a
 * agendar con el cliente del usuario, el envio de broadcasts se rompe en
 * produccion. Este test es lo que protege esa migracion.
 */
function fakeClient() {
  const inserts: Array<{ table: string; rows: unknown[] }> = [];
  const updates: Array<{ table: string; patch: Record<string, unknown> }> = [];
  const order: string[] = [];

  const client = {
    from(table: string) {
      return {
        insert: async (rows: unknown[]) => {
          inserts.push({ table, rows: Array.isArray(rows) ? rows : [rows] });
          order.push(`insert:${table}`);
          return { error: null };
        },
        update: (patch: Record<string, unknown>) => ({
          eq: async () => {
            updates.push({ table, patch });
            order.push(`update:${table}`);
            return { error: null };
          },
        }),
      };
    },
  } as unknown as SupabaseClient<Database>;

  return { client, inserts, updates, order };
}

describe("scheduleBroadcastDelivery", () => {
  it("agenda los jobs con el service client y NUNCA con el del usuario", async () => {
    const usuario = fakeClient();
    const service = fakeClient();

    await scheduleBroadcastDelivery({
      userClient: usuario.client,
      serviceClient: service.client,
      broadcastId: "b-1",
      recipientIds: ["r-1", "r-2"],
    });

    expect(service.inserts.map((i) => i.table)).toEqual(["scheduled_jobs"]);
    expect(usuario.inserts).toHaveLength(0);
  });

  it("el estado del broadcast se escribe con el cliente del usuario, para que la RLS valide", async () => {
    const usuario = fakeClient();
    const service = fakeClient();

    await scheduleBroadcastDelivery({
      userClient: usuario.client,
      serviceClient: service.client,
      broadcastId: "b-1",
      recipientIds: ["r-1"],
    });

    expect(usuario.updates[0]).toMatchObject({
      table: "broadcasts",
      patch: { status: "sending", total_recipients: 1 },
    });
    expect(service.updates).toHaveLength(0);
  });

  it("los jobs se agendan ANTES de marcar el broadcast como enviando", async () => {
    // Al reves, si falla el insert queda un broadcast en "enviando" sin ningun
    // job: se cuelga sin señal. Asi queda en borrador y se ve que algo paso.
    const usuario = fakeClient();
    const service = fakeClient();

    await scheduleBroadcastDelivery({
      userClient: usuario.client,
      serviceClient: service.client,
      broadcastId: "b-1",
      recipientIds: ["r-1"],
    });

    expect(service.order[0]).toBe("insert:scheduled_jobs");
    expect(usuario.order[0]).toBe("update:broadcasts");
  });

  it("inserta de a 100: 250 destinatarios son 3 tandas", async () => {
    const usuario = fakeClient();
    const service = fakeClient();
    const recipientIds = Array.from({ length: 250 }, (_, i) => `r-${i}`);

    await scheduleBroadcastDelivery({
      userClient: usuario.client,
      serviceClient: service.client,
      broadcastId: "b-1",
      recipientIds,
    });

    expect(service.inserts).toHaveLength(3);
    expect(service.inserts.map((i) => i.rows.length)).toEqual([100, 100, 50]);
  });

  it("sin destinatarios lanza y no escribe nada", async () => {
    const usuario = fakeClient();
    const service = fakeClient();

    await expect(
      scheduleBroadcastDelivery({
        userClient: usuario.client,
        serviceClient: service.client,
        broadcastId: "b-1",
        recipientIds: [],
      })
    ).rejects.toThrow();

    expect(service.inserts).toHaveLength(0);
    expect(usuario.updates).toHaveLength(0);
  });

  it("si falla el insert de los jobs, el broadcast no queda marcado como enviando", async () => {
    const usuario = fakeClient();
    const service = {
      from: () => ({
        insert: async () => ({ error: { message: "permission denied" } }),
      }),
    } as unknown as SupabaseClient<Database>;

    await expect(
      scheduleBroadcastDelivery({
        userClient: usuario.client,
        serviceClient: service,
        broadcastId: "b-1",
        recipientIds: ["r-1"],
      })
    ).rejects.toThrow(/permission denied/);

    expect(usuario.updates).toHaveLength(0);
  });
});


describe("tiempos del turno del agente (ventana de silencio)", () => {
  const t0 = new Date("2026-09-15T16:00:00.000Z");
  const at = (s: number) => new Date(t0.getTime() + s * 1000);

  it("el turno se agenda un tic (15 s) antes de que cierre la ventana de 60 s", () => {
    const { runAt } = agentBurstTiming({ lastMessageAt: t0, bundleWindowSeconds: 60, maxWaitSeconds: 300, now: t0 });
    expect(runAt.toISOString()).toBe(at(45).toISOString());
  });

  it("cada mensaje nuevo reprograma: el turno se corre a 45 s del ULTIMO mensaje", () => {
    const second = agentBurstTiming({ lastMessageAt: at(20), bundleWindowSeconds: 60, maxWaitSeconds: 300, now: at(20) });
    const third = agentBurstTiming({ lastMessageAt: at(30), bundleWindowSeconds: 60, maxWaitSeconds: 300, now: at(30) });
    expect(second.runAt.toISOString()).toBe(at(65).toISOString());
    expect(third.runAt.toISOString()).toBe(at(75).toISOString());
  });

  it("el tope se calcula desde el primer mensaje y la base lo congela (push_debounced_job)", () => {
    const first = agentBurstTiming({ lastMessageAt: t0, bundleWindowSeconds: 60, maxWaitSeconds: 180, now: t0 });
    // El turno arranca un tic antes del tope: 180 - 15.
    expect(first.deadline?.toISOString()).toBe(at(165).toISOString());
  });

  it("sin tope configurado no hay deadline", () => {
    expect(agentBurstTiming({ lastMessageAt: t0, bundleWindowSeconds: 60, maxWaitSeconds: null, now: t0 }).deadline).toBeNull();
  });

  it("nunca se agenda en el pasado", () => {
    const { runAt } = agentBurstTiming({ lastMessageAt: t0, bundleWindowSeconds: 15, maxWaitSeconds: null, now: at(10) });
    expect(runAt.getTime()).toBeGreaterThanOrEqual(at(10).getTime());
  });
});
