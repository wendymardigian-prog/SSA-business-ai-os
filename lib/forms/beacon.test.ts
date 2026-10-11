import { describe, it, expect, vi } from "vitest";
import { handleBeacon, type BeaconPorts } from "./beacon";

const SID = "3f0c1c2e-0000-4000-8000-000000000001";
const FORM = { id: "form-1", workspaceId: "ws-1", versionId: "v-1" };

function makePorts(over: Partial<BeaconPorts> = {}) {
  const events: Array<Parameters<BeaconPorts["insertEvent"]>[0]> = [];
  const seen = new Map<string, number>();
  const ports: BeaconPorts = {
    // El tope cuenta de verdad, como la tabla rate_limits.
    limit: vi.fn(async (spec) => {
      const count = (seen.get(spec.key) ?? 0) + 1;
      seen.set(spec.key, count);
      return { allowed: count <= spec.max, count, max: spec.max };
    }),
    limitKeys: { beacon: (ip) => `b:${ip}`, session: (kind, formId, sid) => `s:${kind}:${formId}:${sid}` },
    loadPublishedForm: vi.fn(async () => FORM),
    insertEvent: vi.fn(async (e) => {
      events.push(e);
    }),
    ...over,
  };
  return { ports, events };
}

const call = (ports: BeaconPorts, body: unknown, ip = "203.0.113.9") => handleBeacon(ports, { slug: "aplicacion", ip, body });

describe("handleBeacon", () => {
  it("una vista escribe un form_view sin contacto ni datos personales", async () => {
    const { ports, events } = makePorts();
    const out = await call(ports, { kind: "view", sid: SID });
    expect(out).toEqual({ status: 204, wrote: true });
    expect(events).toEqual([{ workspaceId: "ws-1", eventType: "form_view", metadata: { form_id: "form-1", version_id: "v-1" } }]);
    // Nunca la IP ni el sid.
    expect(JSON.stringify(events)).not.toContain("203.0.113.9");
    expect(JSON.stringify(events)).not.toContain(SID);
  });

  it("recargar la misma pestaña 5 veces (mismo sid) deja UNA vista; otra pestaña, dos", async () => {
    const { ports, events } = makePorts();
    for (let i = 0; i < 5; i++) await call(ports, { kind: "view", sid: SID });
    expect(events).toHaveLength(1);
    await call(ports, { kind: "view", sid: "3f0c1c2e-0000-4000-8000-000000000002" });
    expect(events).toHaveLength(2);
  });

  it("la vista y el inicio de la misma sesión cuentan por separado", async () => {
    const { ports, events } = makePorts();
    await call(ports, { kind: "view", sid: SID });
    await call(ports, { kind: "start", sid: SID });
    expect(events.map((e) => e.eventType)).toEqual(["form_view", "form_start"]);
  });

  it("una IP que manda 61 beacons en una hora: el 61 no escribe nada", async () => {
    const { ports, events } = makePorts();
    for (let i = 0; i < 61; i++) {
      const sid = `3f0c1c2e-0000-4000-8000-${String(i).padStart(12, "0")}`;
      await call(ports, { kind: "view", sid });
    }
    expect(events).toHaveLength(60);
  });

  it("sin sid válido no escribe (y no gasta tope)", async () => {
    const { ports, events } = makePorts();
    await call(ports, { kind: "view", sid: "no-es-uuid" });
    await call(ports, { kind: "view" });
    await call(ports, null);
    await call(ports, { kind: "otra", sid: SID });
    expect(events).toHaveLength(0);
    expect(ports.limit).not.toHaveBeenCalled();
  });

  it("un formulario no publicado no escribe y responde igual", async () => {
    const { ports, events } = makePorts({ loadPublishedForm: vi.fn(async () => null) });
    const out = await call(ports, { kind: "view", sid: SID });
    expect(out).toEqual({ status: 204, wrote: false });
    expect(events).toHaveLength(0);
  });
});
