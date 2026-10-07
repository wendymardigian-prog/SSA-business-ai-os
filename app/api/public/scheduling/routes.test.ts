/**
 * Las tres rutas publicas de agenda (F24, F26): lo que responden y, sobre
 * todo, lo que NO responden. La pagina publica no debe recibir ids internos,
 * emails del anfitrion ni la configuracion de limites.
 *
 * Google y la base estan simulados; nada sale a la red.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { schedulingWorld } from "@/lib/scheduling/testing/world";
import { resetBusyCache } from "@/lib/scheduling/data/slots-input";

let db: ReturnType<typeof schedulingWorld>;
const notifyBooking = vi.fn(async () => {});

vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => db.client }));
vi.mock("@/lib/scheduling/notifications", () => ({ notifyBooking: (...a: unknown[]) => notifyBooking(...(a as [])) }));
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (fn: () => unknown) => fn() };
});

const { GET: getSlots } = await import("./slots/route");
const { GET: getEvent } = await import("./event/route");
const { POST: postBooking } = await import("./bookings/route");

const NOW = "2026-09-30T16:00:00.000Z";
const START = "2026-10-01T16:00:00.000Z";

const slotsRequest = (query: string) => new NextRequest(`http://localhost/api/public/scheduling/slots?${query}`);
const eventRequest = (query: string) => new NextRequest(`http://localhost/api/public/scheduling/event?${query}`);
const bookingRequest = (body: unknown) =>
  new NextRequest("http://localhost/api/public/scheduling/bookings", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "1.2.3.4" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  db = schedulingWorld();
  resetBusyCache();
  notifyBooking.mockClear();
  vi.setSystemTime(new Date(NOW));
});

describe("GET /api/public/scheduling/event", () => {
  it("devuelve lo publico del evento y nada mas", async () => {
    const res = await getEvent(eventRequest("user=ana&event=llamada-de-triaje"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.event).toMatchObject({ title: "Llamada de triaje", durationMinutes: 30 });

    const text = JSON.stringify(body);
    // Nada interno: ni ids de calendario, ni el email del calendario, ni topes.
    expect(text).not.toContain("ana@ejemplo.com");
    expect(text).not.toContain("cal-1");
    expect(text).not.toContain("conn-1");
    expect(text).not.toContain("max_per_day");
    expect(text).not.toContain("destination_calendar_id");
  });

  it("un evento que no existe da 404 igual que uno inactivo", async () => {
    const missing = await getEvent(eventRequest("user=ana&event=no-existe"));
    expect(missing.status).toBe(404);

    db = schedulingWorld({ event: { status: "inactive" } });
    const inactive = await getEvent(eventRequest("user=ana&event=llamada-de-triaje"));
    expect(inactive.status).toBe(404);
    expect(await inactive.json()).toEqual({ reason: "not_found" });
  });

  it("sin usuario ni evento, 400", async () => {
    expect((await getEvent(eventRequest("user=ana"))).status).toBe(400);
  });
});

describe("GET /api/public/scheduling/slots", () => {
  it("devuelve los horarios agrupados por dia", async () => {
    const res = await getSlots(slotsRequest("user=ana&event=llamada-de-triaje&from=2026-10-01T00:00:00Z&to=2026-10-03T00:00:00Z&tz=America/Costa_Rica"));
    expect(res.status).toBe(200);
    const body = await res.json();
    const days = Object.keys(body.slots);
    expect(days).toContain("2026-10-01");
    expect(body.slots["2026-10-01"].length).toBeGreaterThan(0);
    // Solo la hora: ningun id interno.
    expect(JSON.stringify(body)).not.toContain("cal-1");
  });

  it("un rango de mas de 45 dias se rechaza", async () => {
    const res = await getSlots(slotsRequest("user=ana&event=llamada-de-triaje&from=2026-10-01T00:00:00Z&to=2026-12-15T00:00:00Z&tz=UTC"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ reason: "range_too_wide" });
  });

  it("una zona horaria inventada se rechaza", async () => {
    const res = await getSlots(slotsRequest("user=ana&event=llamada-de-triaje&from=2026-10-01T00:00:00Z&to=2026-10-03T00:00:00Z&tz=Marte/Olympus"));
    expect(res.status).toBe(400);
  });

  it("faltan parametros: 400", async () => {
    expect((await getSlots(slotsRequest("user=ana"))).status).toBe(400);
  });

  it("un evento que no existe: 404", async () => {
    const res = await getSlots(slotsRequest("user=ana&event=nada&from=2026-10-01T00:00:00Z&to=2026-10-03T00:00:00Z&tz=UTC"));
    expect(res.status).toBe(404);
  });

  it("si la persona no puede recibir agendas, 200 con el motivo y sin horarios", async () => {
    db = schedulingWorld({ connection: { status: "revoked" }, calendar: { check_conflicts: true } });
    const res = await getSlots(slotsRequest("user=ana&event=llamada-de-triaje&from=2026-10-01T00:00:00Z&to=2026-10-03T00:00:00Z&tz=UTC"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ slots: {}, unavailableReason: "temporarily_unavailable" });
  });
});

describe("POST /api/public/scheduling/bookings", () => {
  const body = {
    user: "ana",
    event: "llamada-de-triaje",
    startUtc: START,
    timezone: "America/Costa_Rica",
    responses: { name: "Juan Pérez", email: "juan@ejemplo.com" },
  };

  it("crea la agenda y devuelve el codigo publico, sin ids internos", async () => {
    const res = await postBooking(bookingRequest(body));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.uid).toHaveLength(22);
    expect(json.startUtc).toBe(START);
    expect(json).not.toHaveProperty("bookingId");
    expect(json).not.toHaveProperty("contactId");
    expect(db.rows("bookings")).toHaveLength(1);
    // El aviso al anfitrion sale despues de responder.
    expect(notifyBooking).toHaveBeenCalledWith(expect.anything(), db.rows("bookings")[0].id, "booking_created");
  });

  it("un cuerpo que no es JSON da 400", async () => {
    const res = await postBooking(
      new NextRequest("http://localhost/api/public/scheduling/bookings", { method: "POST", body: "no soy json" }),
    );
    expect(res.status).toBe(400);
  });

  it("sin horario valido, 400", async () => {
    const res = await postBooking(bookingRequest({ ...body, startUtc: "mañana" }));
    expect(res.status).toBe(400);
    expect(db.rows("bookings")).toHaveLength(0);
  });

  it("un formulario incompleto devuelve los campos con error", async () => {
    const res = await postBooking(bookingRequest({ ...body, responses: { name: "Juan" } }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.reason).toBe("invalid");
    expect(Object.keys(json.fields)).toContain("email");
  });

  it("un horario ocupado devuelve 409 y no crea una segunda agenda", async () => {
    await postBooking(bookingRequest(body));
    const res = await postBooking(bookingRequest(body));
    expect(res.status).toBe(409);
    expect(db.rows("bookings")).toHaveLength(1);
  });

  it("el campo trampa responde 200 sin crear nada ni avisar", async () => {
    const res = await postBooking(bookingRequest({ ...body, website: "http://spam.example" }));
    expect(res.status).toBe(200);
    expect((await res.json()).uid).toBe("ok");
    expect(db.rows("bookings")).toHaveLength(0);
    expect(notifyBooking).not.toHaveBeenCalled();
  });

  it("el embed queda registrado como origen", async () => {
    await postBooking(bookingRequest({ ...body, embed: "1" }));
    expect(db.rows("bookings")[0].origin).toBe("embed");
  });
});
