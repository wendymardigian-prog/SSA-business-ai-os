/**
 * Las acciones del anfitrion sobre una agenda (F36, F37).
 *
 * Lo que se prueba acá es lo que la pantalla no puede: que un cambio de
 * estado deje el historial y el evento de automatizacion, que cancelar pase
 * por la funcion de cancelar (y no por un UPDATE pelado que dejaria el evento
 * de Google colgado), y que sin permiso no pase nada.
 *
 * Google, Resend y la IA no se tocan.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { schedulingWorld, EVENT, HOST, WS } from "@/lib/scheduling/testing/world";
import { groupOf } from "@/lib/scheduling/booking-status";

let db: ReturnType<typeof schedulingWorld>;
let allowed = true;
let scopeAll = true;
const OTRO = "user-2";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/guards", () => ({
  getPermissionAction: async (key: string) =>
    allowed ? { user: { id: HOST }, workspace: { id: WS }, supabase: db.client, can: () => true, scope: () => (scopeAll ? "all" : "own"), key } : null,
}));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => db.client }));
vi.mock("@/lib/workspace-members", () => ({
  getWorkspaceMembers: async () => [
    { userId: HOST, role: "owner", name: "Ana", email: "ana@ejemplo.com" },
    { userId: OTRO, role: "member", name: "Lucía", email: "lucia@ejemplo.com" },
  ],
}));

const {
  changeBookingStatus,
  cancelBookingAsHost,
  updateBookingDetails,
  fixBookingCategory,
  retryBookingSync,
  bookManually,
  releaseBookingSlotAsHost,
  occupyBookingSlotAsHost,
  reassignBookingHostAsHost,
} = await import("./bookings");

const NOW = new Date("2026-09-30T16:00:00.000Z");
const START = "2026-10-01T16:00:00.000Z";

function seed(over: Record<string, unknown> = {}) {
  const status = (over.status as string) ?? "scheduled";
  db = schedulingWorld({
    bookings: [
      {
        id: "bk-1",
        uid: "abcdefghijklmnopqrstuv",
        workspace_id: WS,
        event_type_id: EVENT,
        host_user_id: HOST,
        contact_id: "c-1",
        title: "Llamada de triaje",
        start_at: START,
        end_at: "2026-10-01T16:30:00.000Z",
        booker_timezone: "America/Costa_Rica",
        host_timezone: "America/Costa_Rica",
        booker_name: "Juan",
        booker_email: "juan@ejemplo.com",
        booker_phone: null,
        responses: {},
        origin: "public_page",
        location_type: "manual",
        location_text: "Zoom",
        category_id: "tipo-1",
        category_snapshot: { area_id: "area-1", area_name: "Ventas", type_id: "tipo-1", type_name: "Triaje" },
        reschedule_count: 0,
        google_event_id: "gev-1",
        google_sync_status: "synced",
        ...over,
        status,
        status_group: groupOf(status as never),
      },
    ],
    contacts: [{ id: "c-1", workspace_id: WS, email: "juan@ejemplo.com", phone: null }],
  });
}

beforeEach(() => {
  allowed = true;
  scopeAll = true;
  vi.setSystemTime(NOW);
  seed();
});

describe("changeBookingStatus", () => {
  it("confirmar deja el historial y el evento de automatizacion", async () => {
    const result = await changeBookingStatus({ bookingId: "bk-1", status: "confirmed" });
    expect(result.ok).toBe(true);

    const bk = db.rows("bookings")[0];
    expect(bk.status).toBe("confirmed");
    expect(bk.status_changed_by).toBe(HOST);

    expect(db.rows("audit_log").map((a) => a.action)).toContain("booking.status_changed");
    const evento = db.rows("automation_events").find((e) => e.event_type === "booking_status_changed");
    expect(evento?.payload).toMatchObject({ from_status: "scheduled", to_status: "confirmed", by_whom: "host" });
  });

  it("no se puede marcar no-show antes de que empiece", async () => {
    const result = await changeBookingStatus({ bookingId: "bk-1", status: "no_show" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("debía fallar");
    expect(result.error).toContain("después de la hora de inicio");
    expect(db.rows("bookings")[0].status).toBe("scheduled");
  });

  it("después de la hora, no-show si entra", async () => {
    vi.setSystemTime(new Date("2026-10-01T17:00:00.000Z"));
    const result = await changeBookingStatus({ bookingId: "bk-1", status: "no_show" });
    expect(result.ok).toBe(true);
    expect(db.rows("bookings")[0].status_group).toBe("no_show");
  });

  it("una cancelada no vuelve a activa: cancelar es final", async () => {
    seed({ status: "cancelled_other" });
    const result = await changeBookingStatus({ bookingId: "bk-1", status: "confirmed" });
    expect(result.ok).toBe(false);
  });

  it("un estado inventado se rechaza antes de tocar la base", async () => {
    const result = await changeBookingStatus({ bookingId: "bk-1", status: "realizada" });
    expect(result).toMatchObject({ ok: false });
    expect(db.rows("audit_log")).toHaveLength(0);
  });

  it("sin permiso no pasa nada", async () => {
    allowed = false;
    const result = await changeBookingStatus({ bookingId: "bk-1", status: "confirmed" });
    expect(result.ok).toBe(false);
    expect(db.rows("bookings")[0].status).toBe("scheduled");
  });
});

describe("cancelBookingAsHost", () => {
  it("cancela con motivo y manda borrar el evento de Google", async () => {
    const result = await cancelBookingAsHost({ bookingId: "bk-1", status: "cancelled_no_response", reason: "No contestó" });
    expect(result.ok).toBe(true);

    const bk = db.rows("bookings")[0];
    expect(bk.status).toBe("cancelled_no_response");
    expect(bk.cancelled_by_type).toBe("host");
    expect(bk.cancelled_by_user_id).toBe(HOST);
    expect(bk.cancellation_reason).toBe("No contestó");

    const sync = db.rows("scheduled_jobs").find((j) => j.type === "booking_google_sync");
    expect(sync?.payload).toMatchObject({ action: "delete" });
    expect(db.rows("automation_events").map((e) => e.event_type)).toContain("booking_cancelled");
  });

  it("un estado que no es de cancelación no sirve", async () => {
    const result = await cancelBookingAsHost({ bookingId: "bk-1", status: "confirmed" });
    expect(result.ok).toBe(false);
  });
});

describe("updateBookingDetails", () => {
  it("cambiar la ubicación reagenda la sincronización con Google", async () => {
    const result = await updateBookingDetails({ bookingId: "bk-1", locationText: "Oficina, piso 3" });
    expect(result.ok).toBe(true);
    expect(db.rows("bookings")[0].location_text).toBe("Oficina, piso 3");

    const sync = db.rows("scheduled_jobs").find((j) => j.type === "booking_google_sync");
    expect(sync?.payload).toMatchObject({ action: "update" });
    expect(db.rows("automation_events").map((e) => e.event_type)).toContain("booking_updated");
  });

  it("las notas internas no van a Google", async () => {
    const result = await updateBookingDetails({ bookingId: "bk-1", internalNotes: "Viene de la campaña de octubre" });
    expect(result.ok).toBe(true);
    expect(db.rows("bookings")[0].internal_notes).toBe("Viene de la campaña de octubre");
    expect(db.rows("scheduled_jobs")).toHaveLength(0);
  });

  it("sin cambios no escribe nada", async () => {
    const result = await updateBookingDetails({ bookingId: "bk-1" });
    expect(result.ok).toBe(true);
    expect(db.rows("audit_log")).toHaveLength(0);
  });
});

describe("fixBookingCategory", () => {
  it("corrige el snapshot, que es la única vez que se toca", async () => {
    db.rows("booking_categories").push({ id: "area-2", workspace_id: WS, parent_id: null, name: "Servicio", color: "#0d9488", position: 1, is_system: true, archived_at: null });
    db.rows("booking_categories").push({ id: "tipo-2", workspace_id: WS, parent_id: "area-2", name: "Onboarding", color: null, position: 0, is_system: true, archived_at: null });

    const result = await fixBookingCategory({ bookingId: "bk-1", categoryId: "tipo-2" });
    expect(result.ok).toBe(true);
    expect(db.rows("bookings")[0].category_snapshot).toMatchObject({ area_name: "Servicio", type_name: "Onboarding" });
  });

  it("una categoría que no existe se rechaza", async () => {
    const result = await fixBookingCategory({ bookingId: "bk-1", categoryId: "no-existe" });
    expect(result.ok).toBe(false);
    expect(db.rows("bookings")[0].category_snapshot).toMatchObject({ type_name: "Triaje" });
  });
});

describe("retryBookingSync", () => {
  it("vuelve a encolar el evento y limpia el error", async () => {
    seed({ google_sync_status: "failed", google_sync_error: "Google no contestó" });
    const result = await retryBookingSync({ bookingId: "bk-1" });
    expect(result.ok).toBe(true);
    expect(db.rows("bookings")[0].google_sync_status).toBe("pending");
    expect(db.rows("bookings")[0].google_sync_error).toBeNull();
    expect(db.rows("scheduled_jobs").find((j) => j.type === "booking_google_sync")?.payload).toMatchObject({ action: "update" });
  });
});

describe("releaseBookingSlotAsHost / occupyBookingSlotAsHost (Agenda v2)", () => {
  it("libera el espacio y encola el job de Google", async () => {
    const result = await releaseBookingSlotAsHost({ bookingId: "bk-1" });
    expect(result.ok).toBe(true);
    expect(db.rows("bookings")[0].slot_released_at).toBeTruthy();
    expect(db.rows("scheduled_jobs").find((j) => j.type === "booking_google_sync")?.payload).toMatchObject({ action: "release" });
  });

  it("vuelve a ocupar", async () => {
    seed({ slot_released_at: "2026-09-30T00:00:00.000Z", slot_released_by: HOST });
    const result = await occupyBookingSlotAsHost({ bookingId: "bk-1" });
    expect(result.ok).toBe(true);
    expect(db.rows("bookings")[0].slot_released_at).toBeNull();
  });

  it("sin permiso no pasa nada", async () => {
    allowed = false;
    const result = await releaseBookingSlotAsHost({ bookingId: "bk-1" });
    expect(result.ok).toBe(false);
    expect(db.rows("bookings")[0].slot_released_at).toBeFalsy();
  });
});

describe("reassignBookingHostAsHost (Agenda v2)", () => {
  beforeEach(() => {
    db.tables.scheduling_profiles.push({ id: "prof-2", workspace_id: WS, user_id: OTRO, username: "lucia", display_name: "Lucía", is_active: true, timezone: "America/Mexico_City" });
  });

  it("reasigna, con el email y el nombre resueltos del equipo", async () => {
    const result = await reassignBookingHostAsHost({ bookingId: "bk-1", newHostUserId: OTRO });
    expect(result.ok).toBe(true);
    expect(db.rows("bookings")[0].host_user_id).toBe(OTRO);
    const job = db.rows("scheduled_jobs").find((j) => j.type === "booking_google_sync");
    expect(job?.payload).toMatchObject({ action: "reassign", new_host_email: "lucia@ejemplo.com", new_host_name: "Lucía" });
  });

  it("sin alcance total (Member) no se puede reasignar", async () => {
    scopeAll = false;
    const result = await reassignBookingHostAsHost({ bookingId: "bk-1", newHostUserId: OTRO });
    expect(result.ok).toBe(false);
    expect(db.rows("bookings")[0].host_user_id).toBe(HOST);
  });

  it("sin permiso no pasa nada", async () => {
    allowed = false;
    const result = await reassignBookingHostAsHost({ bookingId: "bk-1", newHostUserId: OTRO });
    expect(result.ok).toBe(false);
  });
});

describe("bookManually", () => {
  it("agenda por el mismo camino que la página pública", async () => {
    db.tables.bookings = [];
    const result = await bookManually({
      eventTypeId: EVENT,
      startUtc: "2026-10-02T16:00:00.000Z",
      timezone: "America/Costa_Rica",
      responses: { name: "Ana Test", email: "ana@ejemplo.com" },
    });
    expect(result.ok).toBe(true);

    const bk = db.rows("bookings")[0];
    expect(bk.origin).toBe("manual");
    expect(bk.created_by).toBe(HOST);
    // Lo mismo que la pública: contacto, automatización y los dos jobs.
    expect(db.rows("contacts").some((c) => c.email === "ana@ejemplo.com")).toBe(true);
    expect(db.rows("automation_events").map((e) => e.event_type)).toContain("booking_created");
    expect(db.rows("scheduled_jobs").map((j) => j.type).sort()).toEqual(["booking_ended", "booking_google_sync"]);
  });

  it("un horario fuera del horario laboral se rechaza con un mensaje que dice qué hacer", async () => {
    db.tables.bookings = [];
    const result = await bookManually({
      eventTypeId: EVENT,
      startUtc: "2026-10-04T16:00:00.000Z",
      timezone: "America/Costa_Rica",
      responses: { name: "Ana Test", email: "ana@ejemplo.com" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("debía fallar");
    expect(result.error).toContain("no está disponible");
    expect(db.rows("bookings")).toHaveLength(0);
  });

  it("con un contacto ya elegido no se crea otro", async () => {
    db.tables.bookings = [];
    const result = await bookManually({
      eventTypeId: EVENT,
      startUtc: "2026-10-02T16:00:00.000Z",
      timezone: "America/Costa_Rica",
      responses: { name: "Juan", email: "juan@ejemplo.com" },
      contactId: "c-1",
    });
    expect(result.ok).toBe(true);
    expect(db.rows("contacts")).toHaveLength(1);
    expect(db.rows("bookings")[0].contact_id).toBe("c-1");
  });

  it("sin permiso, nada", async () => {
    allowed = false;
    db.tables.bookings = [];
    const result = await bookManually({ eventTypeId: EVENT, startUtc: "2026-10-02T16:00:00.000Z", timezone: "UTC", responses: {} });
    expect(result.ok).toBe(false);
    expect(db.rows("bookings")).toHaveLength(0);
  });
});
