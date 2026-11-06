import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "@/lib/testing/fake-db";
import { reclassifyCall, reclassifyCallsOfBooking } from "./reclassify";

const NOW = new Date("2026-10-10T12:00:00Z");
const SERVICIO = "33333333-3333-4333-8333-333333333333";
const ONBOARDING = "44444444-4444-4444-8444-444444444444";
const cat = (id: string, parent_id: string | null, name: string, system_key: string | null) => ({ id, parent_id, name, color: null, position: 0, is_system: !!system_key, archived_at: null, system_key, description: null });
const CATEGORIES = [cat(SERVICIO, null, "Servicio", "servicio"), cat(ONBOARDING, SERVICIO, "Onboarding", null)];
const SNAPSHOT = { area_id: SERVICIO, area_name: "Servicio", type_id: ONBOARDING, type_name: "Onboarding" };

const baseCall = {
  id: "c1",
  workspace_id: "ws1",
  title: "Reunión",
  duration_seconds: 1800,
  attendees: [{ email: "ana@lead.com", is_external: true }],
  transcript: [{ timestamp: "0", speaker: { display_name: "Ana" }, text: "hola" }],
  booking_id: "b1",
  contact_id: "ct1",
  analysis_status: "needs_review",
  imported_from_history: false,
  no_show: false,
  classification_source: null,
  call_type: null,
  call_type_source: null,
};

function setup(over: { call?: Record<string, unknown>; booking?: unknown } = {}) {
  return fakeDb(
    {
      "calls:select": { data: { ...baseCall, ...over.call } },
      "calls:update": { data: [{ id: "c1" }] },
      "workspaces:select": { data: { ai_background_settings: {} } },
      "booking_categories:select": { data: CATEGORIES },
      "bookings:select": { data: { category_snapshot: over.booking === undefined ? SNAPSHOT : over.booking } },
      "scheduled_jobs:insert": { data: { id: "j1" } },
    },
    { workspace_member_profiles: { data: [] } },
  );
}

describe("reclassifyCall", () => {
  it("una grabacion que se vincula toma el area y el tipo de la reunion", async () => {
    const db = setup();
    expect(await reclassifyCall(db.client, "c1", NOW)).toBe("updated");
    expect(db.writesTo("calls")[0].values).toMatchObject({ area_id: SERVICIO, category_id: ONBOARDING, classification_source: "booking", call_type: "cliente" });
  });

  it("lo que eligio una persona no se toca", async () => {
    const db = setup({ call: { classification_source: "human", call_type: "cierre", call_type_source: "human" } });
    expect(await reclassifyCall(db.client, "c1", NOW)).toBe("kept_human");
    expect(db.writes()).toHaveLength(0);
  });

  it("una grabacion ya analizada cambia de clasificacion pero conserva su estado y no se reanaliza", async () => {
    const db = setup({ call: { analysis_status: "analyzed", call_type: "cierre" } });
    expect(await reclassifyCall(db.client, "c1", NOW)).toBe("updated");
    const values = db.writesTo("calls")[0].values as Record<string, unknown>;
    expect(values).toMatchObject({ area_id: SERVICIO, category_id: ONBOARDING });
    expect(values).not.toHaveProperty("analysis_status");
    expect(db.writesTo("scheduled_jobs")).toHaveLength(0);
  });

  it("sin reunion ni regla que decida, y sin analizar, vuelve a la cola de clasificacion", async () => {
    const db = setup({ call: { booking_id: null } });
    expect(await reclassifyCall(db.client, "c1", NOW)).toBe("requeued");
    expect(db.writesTo("calls")[0].values).toMatchObject({ area_id: null, category_id: null, analysis_status: "classifying" });
    expect(db.writesTo("scheduled_jobs")[0].values).toMatchObject({ type: "call_classify" });
  });

  it("una ya analizada sin reunion queda sin clasificar, sin volver a gastar IA", async () => {
    const db = setup({ call: { booking_id: null, analysis_status: "analyzed", call_type: "cierre" } });
    expect(await reclassifyCall(db.client, "c1", NOW)).toBe("cleared");
    expect(db.writesTo("scheduled_jobs")).toHaveLength(0);
  });

  it("nunca lanza", async () => {
    const db = fakeDb({ "calls:select": () => { throw new Error("se cayó la base"); } });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(reclassifyCall(db.client, "c1", NOW)).resolves.toBe("failed");
    spy.mockRestore();
  });
});

describe("reclassifyCallsOfBooking", () => {
  it("nunca lanza, aunque la base falle", async () => {
    const db = fakeDb({ "calls:select": () => { throw new Error("se cayó la base"); } });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(reclassifyCallsOfBooking(db.client, "b1", NOW)).resolves.toBeUndefined();
    spy.mockRestore();
  });
});
