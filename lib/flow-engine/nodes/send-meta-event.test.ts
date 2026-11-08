import { describe, it, expect, vi, beforeEach } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { sendMetaEventNode } from "./send-meta-event";
import type { FlowExecutionContext } from "../types";
import type { MetaEventStepData } from "@/lib/meta/capi/events";

const WS = "ws-1";
const recent = () => new Date(Date.now() - 60_000).toISOString();

const ctx = (variables: Record<string, unknown>, over: Partial<FlowExecutionContext> = {}): FlowExecutionContext => ({
  triggerId: "t",
  flowId: "flow-1",
  channelId: "",
  contactId: "c1",
  conversationId: "",
  workspaceId: WS,
  incomingMessage: {},
  variables,
  ...over,
});

function world(seed: Record<string, Array<Record<string, unknown>>> = {}) {
  return memoryDb(
    {
      form_submissions: [{ id: "s1", workspace_id: WS, created_at: recent(), status: "received", meta: { meta_event_id: "lead-abc" } }],
      bookings: [
        { id: "b1", workspace_id: WS, created_at: recent(), origin: "public_page" },
        { id: "b2", workspace_id: WS, created_at: recent(), origin: "manual" },
      ],
      meta_capi_events: [],
      scheduled_jobs: [],
      ...seed,
    },
    { unique: { meta_capi_events: (a, b) => a.workspace_id === b.workspace_id && a.event_name === b.event_name && a.event_id === b.event_id } },
  );
}

async function run(db: ReturnType<typeof world>, data: MetaEventStepData, context: FlowExecutionContext) {
  const notes: Array<{ status: string; reason?: unknown }> = [];
  context.noteStep = (n) => notes.push(n as never);
  await sendMetaEventNode.execute({ supabase: db.client, node: { id: "n1", type: "action", position: { x: 0, y: 0 }, data: {} } as never, data, context, sessionId: "sess-1", runtime: { executeFlow: async () => {} } } as never);
  return notes;
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("Enviar evento a Meta", () => {
  it("necesita contacto y la API de Conversiones conectada", () => {
    expect(sendMetaEventNode.needsContact).toBe(true);
    expect(sendMetaEventNode.requires).toEqual(["meta_capi"]);
  });

  // @plantilla-desde(formularios)
  it("en un formulario: usa el código que mandó la web, la hora de la respuesta, el valor y el nombre del formulario", async () => {
    const db = world();
    const notes = await run(db, { eventName: "Lead", value: "{{answer.presupuesto}}", currency: "ARS" }, ctx({ submission: { id: "s1" }, form: { name: "Clase gratis" }, answer: { presupuesto: "1.500" } }));
    expect(notes).toEqual([]);
    const [row] = db.rows("meta_capi_events");
    expect(row).toMatchObject({ event_name: "Lead", event_id: "lead-abc", source_type: "form", source_id: "s1", flow_session_id: "sess-1", params: { value: 1500, currency: "ARS", content_name: "Clase gratis" } });
    expect(db.rows("scheduled_jobs")).toHaveLength(1);
    expect(db.rows("scheduled_jobs")[0]).toMatchObject({ type: "meta_capi_send" });
  });

  it("una respuesta marcada como spam no se manda", async () => {
    const db = world({ form_submissions: [{ id: "s1", workspace_id: WS, created_at: recent(), status: "spam", meta: {} }] });
    const notes = await run(db, { eventName: "Lead" }, ctx({ submission: { id: "s1" } }));
    expect(notes[0]).toMatchObject({ status: "skipped" });
    expect(db.rows("meta_capi_events")).toHaveLength(0);
  });
  // @plantilla-hasta(formularios)

  it("en una reunión del lead: «booking.<id>»; una que armó el equipo no se manda (salvo que se apague la opción)", async () => {
    const db = world();
    await run(db, { eventName: "Schedule" }, ctx({ event_booking_id: "b1", booking: { event_title: "Llamada" } }));
    expect(db.rows("meta_capi_events")[0]).toMatchObject({ event_id: "booking.b1", source_type: "booking", params: { content_name: "Llamada" } });

    const notes = await run(db, { eventName: "Schedule" }, ctx({ event_booking_id: "b2" }));
    expect(notes[0]).toMatchObject({ status: "skipped" });
    expect(db.rows("meta_capi_events")).toHaveLength(1);

    await run(db, { eventName: "Schedule", onlyLeadBookings: false }, ctx({ event_booking_id: "b2" }));
    expect(db.rows("meta_capi_events")).toHaveLength(2);
  });

  it("con cualquier otro disparador: el contacto, con un código por ejecución y paso", async () => {
    const db = world();
    await run(db, { eventName: "Contact" }, ctx({}));
    expect(db.rows("meta_capi_events")[0]).toMatchObject({ event_id: "flow.sess-1.n1", source_type: "contact", source_id: "c1" });
  });

  it("el mismo evento dos veces se anota una sola: el segundo se saltea", async () => {
    const db = world();
    await run(db, { eventName: "Schedule" }, ctx({ event_booking_id: "b1" }));
    const notes = await run(db, { eventName: "Schedule" }, ctx({ event_booking_id: "b1" }));
    expect(notes[0]).toMatchObject({ status: "skipped" });
    expect(db.rows("meta_capi_events")).toHaveLength(1);
  });

  it("una reunión de hace más de 7 días (después de un «Esperar» largo) se saltea", async () => {
    const db = world({ bookings: [{ id: "b1", workspace_id: WS, created_at: new Date(Date.now() - 8 * 86_400_000).toISOString(), origin: "public_page" }] });
    const notes = await run(db, { eventName: "Schedule" }, ctx({ event_booking_id: "b1" }));
    expect(notes[0]).toMatchObject({ status: "skipped" });
    expect(db.rows("meta_capi_events")).toHaveLength(0);
  });

  it("Purchase no se manda desde un paso, y un valor que no es número no viaja", async () => {
    const db = world();
    const notes = await run(db, { eventName: "Purchase" }, ctx({}));
    expect(notes[0]).toMatchObject({ status: "skipped" });
    await run(db, { eventName: "Lead", value: "mucho" }, ctx({}));
    expect(db.rows("meta_capi_events")[0].params).toEqual({});
  });

  it("una reunión de otro negocio no se toma", async () => {
    const db = world({ bookings: [{ id: "b1", workspace_id: "otro", created_at: recent(), origin: "public_page" }] });
    const notes = await run(db, { eventName: "Schedule" }, ctx({ event_booking_id: "b1" }));
    expect(notes[0]).toMatchObject({ status: "skipped" });
    expect(db.rows("meta_capi_events")).toHaveLength(0);
  });
});
