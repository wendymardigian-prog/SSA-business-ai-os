/**
 * «Solo si…» en el disparador: el motor lo mira ANTES de reclamar el disparo. Si no se cumple, el flujo no corre, no se
 * gasta la marca (la persona puede entrar después) y queda anotado sin valores.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";

const mocks = vi.hoisted(() => ({ executeFlow: vi.fn(async () => undefined), audit: vi.fn(async () => null) }));
vi.mock("@/lib/flow-engine/engine", () => ({ executeFlow: mocks.executeFlow }));
vi.mock("@/lib/audit", () => ({ logAudit: mocks.audit }));

import "@/lib/flow-engine/registry";
import { getTrigger, registerTrigger } from "@/lib/flow-engine/registry/registry";
import { processEvent, type AutomationEvent } from "./automation-events";
import { readTriggerOnlyIf, supportsTriggerOnlyIf, writeTriggerOnlyIf } from "./trigger-only-if";

const WS = "ws-1";

registerTrigger({
  type: "test_only_if_trigger",
  label: "Disparador de prueba",
  scope: "event",
  priority: 45,
  subject: "system",
  sourceType: "system",
  eventTypes: ["test_only_if_event"],
  variablesFor: (args) => ({ service: { status: (args.event.payload as { estado?: string }).estado ?? "" } }),
});

const onlyIf = (value: string) => ({ logic: "and", conditions: [{ field: "service.status", operator: "is", value, valueType: "text" }] });

function world(config: Record<string, unknown>) {
  return memoryDb(
    {
      triggers: [{ id: "tr-1", workspace_id: WS, flow_id: "flow-1", channel_id: null, type: "test_only_if_trigger", config, priority: 45, is_active: true }],
      trigger_fires: [],
      analytics_events: [],
    },
    { unique: { trigger_fires: (a, b) => a.trigger_id === b.trigger_id && a.dedupe_key === b.dedupe_key } },
  );
}

const event = (estado: string, id = "ev-1"): AutomationEvent =>
  ({ id, workspace_id: WS, event_type: "test_only_if_event", contact_id: null, member_user_id: null, source_type: "system", source_id: null, payload: { estado } }) as AutomationEvent;

beforeEach(() => vi.clearAllMocks());

describe("«Solo si…» en el motor", () => {
  it("se cumple: corre, con las variables del disparador", async () => {
    const db = world({ onlyIf: onlyIf("Activo") });
    expect(await processEvent(db.client as never, event("Activo"))).toBe(1);
    expect(mocks.executeFlow).toHaveBeenCalledTimes(1);
  });

  it("no se cumple: no corre, no gasta la marca y queda anotado sin valores", async () => {
    const db = world({ onlyIf: onlyIf("Activo") });
    expect(await processEvent(db.client as never, event("Pausado"))).toBe(0);
    expect(mocks.executeFlow).not.toHaveBeenCalled();
    expect(db.rows("trigger_fires")).toHaveLength(0);
    const note = db.rows("analytics_events")[0] as { event_type: string; metadata: unknown };
    expect(note.event_type).toBe("flow_only_if_skipped");
    expect(JSON.stringify(note.metadata)).not.toContain("Pausado");
  });

  it("sin condiciones, corre siempre", async () => {
    const db = world({});
    expect(await processEvent(db.client as never, event("Lo que sea"))).toBe(1);
  });

  it("un campo que el evento no trae no se cumple (y no lanza)", async () => {
    const db = world({ onlyIf: { logic: "and", conditions: [{ field: "service.inventado", operator: "is", value: "x", valueType: "text" }] } });
    expect(await processEvent(db.client as never, event("Activo"))).toBe(0);
  });

  it("«alguna» alcanza con una", async () => {
    const db = world({ onlyIf: { logic: "or", conditions: [onlyIf("Activo").conditions[0], onlyIf("Pausado").conditions[0]] } });
    expect(await processEvent(db.client as never, event("Pausado"))).toBe(1);
  });
});

describe("la config", () => {
  it("lee y escribe el grupo; vacío es nada", () => {
    expect(readTriggerOnlyIf({ onlyIf: { logic: "or", conditions: [{ field: "a" }] } })).toEqual({ logic: "or", conditions: [{ field: "a" }] });
    expect(readTriggerOnlyIf({ onlyIf: { logic: "and", conditions: [] } })).toBeNull();
    expect(readTriggerOnlyIf({})).toBeNull();
    expect(writeTriggerOnlyIf({ logic: "and", conditions: [] })).toBeUndefined();
  });
  it("qué disparadores lo ofrecen", () => {
    expect(supportsTriggerOnlyIf(getTrigger("service_started"))).toBe(true);
    expect(supportsTriggerOnlyIf(getTrigger("sale_created"))).toBe(true);
    expect(supportsTriggerOnlyIf(getTrigger("booking_created"))).toBe(true);
    expect(supportsTriggerOnlyIf(getTrigger("new_contact"))).toBe(true);
    expect(supportsTriggerOnlyIf(getTrigger("webhook_received"))).toBe(false);
    expect(supportsTriggerOnlyIf(getTrigger("keyword"))).toBe(false);
    expect(supportsTriggerOnlyIf(getTrigger("email_received"))).toBe(false);
  });
});

describe("la lista del panel y el registro dicen lo mismo", () => {
  it("cada disparador del catálogo", async () => {
    const { TRIGGER_CATALOG } = await import("./trigger-catalog");
    const { triggerOffersOnlyIf } = await import("./trigger-only-if-types");
    for (const entry of TRIGGER_CATALOG as ReadonlyArray<{ type: string }>) {
      expect(triggerOffersOnlyIf(entry.type), entry.type).toBe(supportsTriggerOnlyIf(getTrigger(entry.type)));
    }
  });
});
