/**
 * Ventas F37: un flujo corre UNA vez por cambio. Simula lo que hace el cron `automation-events`
 * (para cada evento, para cada trigger: coincide → reclama la clave de idempotencia → dispara) sobre una
 * base en memoria, en los dos órdenes posibles.
 */
import { describe, expect, it } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";
import { getTrigger } from "./index";

const WS = "ws-1";
interface Ev { id: string; event_type: string; payload: Record<string, unknown> }
interface Tr { id: string; flow_id: string; type: string; config: Record<string, unknown>; priority?: number }

function setup(triggers: Tr[], events: Ev[]): MemoryDb {
  return memoryDb({
    triggers: triggers.map((t) => ({ workspace_id: WS, is_active: true, priority: 0, ...t })),
    automation_events: events.map((e) => ({ workspace_id: WS, contact_id: "c1", ...e })),
  });
}

/** Lo que hace el cron, en el orden que se le pase. Devuelve los flujos disparados. */
async function runCron(db: MemoryDb, order: string[], passes = 1): Promise<Array<{ trigger: string; flow: string; event: string }>> {
  const claimed = new Set<string>();
  const fired: Array<{ trigger: string; flow: string; event: string }> = [];
  const events = db.rows("automation_events");
  for (let pass = 0; pass < passes; pass++) {
    for (const eventId of order) {
      const event = events.find((e) => e.id === eventId)!;
      const row = { id: event.id as string, workspace_id: WS, event_type: event.event_type as string, contact_id: "c1", payload: event.payload as Record<string, unknown> };
      for (const t of db.rows("triggers")) {
        const def = getTrigger(t.type as string);
        if (!def || !def.eventTypes?.includes(row.event_type)) continue;
        const trigger = { id: t.id as string, flow_id: t.flow_id as string, channel_id: null, type: t.type as string, config: t.config, priority: (t.priority as number) ?? 0, is_active: true };
        const args = { supabase: db.client, event: row, config: (t.config ?? {}) as Record<string, unknown>, trigger };
        if (def.eventMatches && !(await def.eventMatches(args))) continue;
        const key = `${t.id}|${def.dedupeKeyFor ? def.dedupeKeyFor(args) : `event:${row.id}`}`;
        if (claimed.has(key)) continue;
        claimed.add(key);
        fired.push({ trigger: t.id as string, flow: t.flow_id as string, event: row.id });
      }
    }
  }
  return fired;
}

const paid = (changeId: string, extra: Record<string, unknown> = {}): Ev => ({ id: `ev-${changeId}`, event_type: "payment_status_changed", payload: { payment_id: `p-${changeId}`, sale_id: "s1", change_id: changeId, from_status: "scheduled", to_status: "paid", payment_type: "installment", ...extra } });

describe("un flujo corre UNA vez por cambio", () => {
  it("un flujo con el genérico «Cambió el estado del pago» y el atajo «Pago cobrado»: UNA sola vez", async () => {
    const db = setup(
      [{ id: "t-generic", flow_id: "f1", type: "payment_status_changed", config: {} }, { id: "t-paid", flow_id: "f1", type: "payment_status_changed", config: { to_status: ["paid"] } }],
      [paid("c1")],
    );
    expect(await runCron(db, ["ev-c1"])).toHaveLength(1);
  });

  it("«Pago creado» + «Pago cobrado» sobre un pago que nace cobrado (mismo change_id): una vez, en cualquier orden", async () => {
    const created: Ev = { id: "ev-created", event_type: "payment_created", payload: { payment_id: "p1", sale_id: "s1", change_id: "c9", payment_type: "full", status: "paid" } };
    const born: Ev = { id: "ev-born", event_type: "payment_status_changed", payload: { payment_id: "p1", sale_id: "s1", change_id: "c9", to_status: "paid", payment_type: "full" } };
    const triggers: Tr[] = [{ id: "t-created", flow_id: "f1", type: "payment_created", config: {} }, { id: "t-paid", flow_id: "f1", type: "payment_status_changed", config: { to_status: ["paid"] } }];
    for (const order of [["ev-created", "ev-born"], ["ev-born", "ev-created"]]) {
      const db = setup(triggers, [created, born]);
      expect(await runCron(db, order), order.join(">")).toHaveLength(1);
    }
  });

  it("procesar dos veces el mismo evento: el flujo arranca una sola vez", async () => {
    const db = setup([{ id: "t1", flow_id: "f1", type: "payment_status_changed", config: { to_status: ["paid"] } }], [paid("c1")]);
    expect(await runCron(db, ["ev-c1"], 2)).toHaveLength(1);
  });

  it("dos flujos distintos con triggers que coinciden corren los dos (la unicidad es por flujo)", async () => {
    const db = setup(
      [{ id: "t-a", flow_id: "f1", type: "payment_status_changed", config: { to_status: ["paid"] } }, { id: "t-b", flow_id: "f2", type: "payment_status_changed", config: {} }],
      [paid("c1")],
    );
    expect((await runCron(db, ["ev-c1"])).map((f) => f.flow).sort()).toEqual(["f1", "f2"]);
  });

  it("un flujo «Pago cobrado» y otro «→ Moroso»: un pago que pasa a cobrado corre solo el primero", async () => {
    const db = setup(
      [{ id: "t-paid", flow_id: "f1", type: "payment_status_changed", config: { to_status: ["paid"] } }, { id: "t-late", flow_id: "f2", type: "payment_status_changed", config: { to_status: ["overdue"] } }],
      [paid("c1")],
    );
    expect((await runCron(db, ["ev-c1"])).map((f) => f.flow)).toEqual(["f1"]);
  });

  it("revertir un cobro (paid → scheduled): un flujo «→ Cobrado» NO corre", async () => {
    const db = setup(
      [{ id: "t-paid", flow_id: "f1", type: "payment_status_changed", config: { to_status: ["paid"] } }],
      [paid("c2", { from_status: "paid", to_status: "scheduled" })],
    );
    expect(await runCron(db, ["ev-c2"])).toHaveLength(0);
  });

  it("el barrido marca 30 pagos: 30 eventos con claves distintas y un flujo «→ Moroso» corre una vez por pago", async () => {
    const events = Array.from({ length: 30 }, (_, i) => paid(`c${i}`, { to_status: "overdue", from_status: "scheduled", payment_id: `p${i}` }));
    const db = setup([{ id: "t-late", flow_id: "f1", type: "payment_status_changed", config: { to_status: ["overdue"] } }], events);
    expect(new Set(events.map((e) => e.payload.change_id)).size).toBe(30);
    expect(await runCron(db, events.map((e) => e.id))).toHaveLength(30);
  });

  it("una configuración rota no dispara para nadie", async () => {
    const db = setup([{ id: "t1", flow_id: "f1", type: "payment_status_changed", config: { to_status: ["inventado"] } }], [paid("c1")]);
    expect(await runCron(db, ["ev-c1"])).toHaveLength(0);
  });
});

describe("filtros y relativos", () => {
  it("sale_created filtrado al producto B no arranca con una venta del A", async () => {
    const ev: Ev = { id: "ev-sale", event_type: "sale_created", payload: { sale_id: "s1", change_id: "k1", product_id: "A" } };
    const db = setup([{ id: "t-b", flow_id: "f1", type: "sale_created", config: { product_ids: ["B"] } }, { id: "t-any", flow_id: "f2", type: "sale_created", config: {} }], [ev]);
    expect((await runCron(db, ["ev-sale"])).map((f) => f.flow)).toEqual(["f2"]);
  });

  it("un relativo lo atiende solo el trigger que lo agendó, y se dispara una vez por pago y reprogramación", async () => {
    const mk = (id: string, count: number): Ev => ({ id, event_type: "payment_before_due", payload: { payment_id: "p1", sale_id: "s1", trigger_id: "t1", reschedule_count: count } });
    const db = setup([{ id: "t1", flow_id: "f1", type: "payment_before_due", config: { offset_days: 3 } }, { id: "t2", flow_id: "f2", type: "payment_before_due", config: { offset_days: 3 } }], [mk("e0", 0), mk("e0b", 0), mk("e1", 1)]);
    const fired = await runCron(db, ["e0", "e0b", "e1"]);
    expect(fired.map((f) => `${f.trigger}:${f.event}`)).toEqual(["t1:e0", "t1:e1"]);
  });

  it("las claves de idempotencia: <tipo>:<change_id> y para los relativos por pago y reprogramación", () => {
    const def = getTrigger("payment_status_changed")!;
    const args = { supabase: null as never, event: { id: "e", workspace_id: WS, event_type: "payment_status_changed", contact_id: "c", payload: { change_id: "ch1" } }, config: {}, trigger: { id: "t", flow_id: "f", channel_id: null, type: "payment_status_changed", config: {}, priority: 0, is_active: true } };
    expect(def.dedupeKeyFor!(args)).toBe("payment_status_changed:ch1");
    const rel = getTrigger("payment_after_due")!;
    expect(rel.dedupeKeyFor!({ ...args, event: { ...args.event, event_type: "payment_after_due", payload: { trigger_id: "t9", payment_id: "p3", reschedule_count: 2 } } })).toBe("payment_after_due:t9:p3:2");
  });
});
